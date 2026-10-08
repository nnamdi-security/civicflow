import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { agencies, notifications, reports, statusEvents, users } from "../../db/schema";
import type { Clock } from "../../domain/clock";
import {
  NOTIFICATION_RULES,
  type NotificationChannel,
  type NotificationEvent,
  type RecipientKind,
} from "../../domain/notifications/events";
import { nextAttemptAt } from "../../domain/notifications/retry";
import { renderEmail, renderSms, reportUrl, type MessageContext } from "../../domain/notifications/templates";
import type { SlaTimer } from "../../domain/sla";
import { EmailDeliveryError, type EmailSender } from "../adapters/email/email-sender";
import { SmsDeliveryError, type SmsSender } from "../adapters/sms/sms-sender";

export interface DispatchDeps {
  db: Db;
  clock: Clock;
  email: EmailSender;
  /** Null when SMS is switched off (ADR 0012): SMS rows are skipped, not failed. */
  sms: SmsSender | null;
  /** Public base URL used in message links. */
  baseUrl: string;
  /** Rows claimed per run. */
  batchSize?: number;
}

export interface DispatchResult {
  sent: number;
  /** Failed but will be tried again. */
  retrying: number;
  /** Gave up: permanent error or retries used up. */
  failed: number;
  skipped: number;
}

/** A claimed row is invisible to other dispatchers for this long, so a crash is retried afterwards. */
const LEASE_MS = 5 * 60_000;
const DEFAULT_BATCH = 50;

interface Pending {
  id: string;
  event: NotificationEvent;
  channel: NotificationChannel;
  discriminator: string;
  attempts: number;
  reportId: string;
  reference: string;
  agencyName: string | null;
  email: string;
  phone: string | null;
  phoneVerified: boolean;
  notifyEmail: boolean;
  notifySms: boolean;
}

type Outcome =
  | { kind: "sent" }
  | { kind: "skipped"; reason: string }
  | { kind: "failed"; code: string }
  | { kind: "retry"; code: string };

function recipientKind(event: NotificationEvent, channel: NotificationChannel): RecipientKind {
  const intent = NOTIFICATION_RULES[event].find((i) => i.channel === channel);
  // Rows are only created from the rules, so this always exists; fail closed on a stale row.
  if (!intent) throw new Error("No rule for queued notification");
  return intent.recipient;
}

async function claim(deps: DispatchDeps): Promise<string[]> {
  const now = deps.clock.now();
  const result = await deps.db.execute<{ id: string }>(sql`
    update notifications n
    set next_attempt_at = ${new Date(now.getTime() + LEASE_MS)}
    where n.id in (
      select id from notifications
      where status = 'pending' and next_attempt_at <= ${now}
      order by next_attempt_at, id
      limit ${deps.batchSize ?? DEFAULT_BATCH}
      for update skip locked
    )
    returning n.id
  `);
  return result.rows.map((row) => row.id);
}

async function load(db: Db, id: string): Promise<Pending | null> {
  const [row] = await db
    .select({
      id: notifications.id,
      event: notifications.event,
      channel: notifications.channel,
      discriminator: notifications.discriminator,
      attempts: notifications.attempts,
      reportId: notifications.reportId,
      reference: reports.reference,
      agencyName: agencies.name,
      email: users.email,
      phone: users.phoneE164,
      phoneVerifiedAt: users.phoneVerifiedAt,
      notifyEmail: users.notifyEmail,
      notifySms: users.notifySms,
    })
    .from(notifications)
    .innerJoin(reports, eq(reports.id, notifications.reportId))
    .innerJoin(users, eq(users.id, notifications.recipientUserId))
    .leftJoin(agencies, eq(agencies.id, reports.agencyId))
    .where(and(eq(notifications.id, id), eq(notifications.status, "pending")))
    .limit(1);
  if (!row) return null;
  return { ...row, phoneVerified: row.phoneVerifiedAt !== null };
}

async function rejectionReason(db: Db, reportId: string): Promise<string | null> {
  const [row] = await db
    .select({ reason: statusEvents.reason })
    .from(statusEvents)
    .where(and(eq(statusEvents.reportId, reportId), eq(statusEvents.toStatus, "rejected")))
    .orderBy(desc(statusEvents.createdAt))
    .limit(1);
  return row?.reason ?? null;
}

function failureOutcome(error: unknown): Outcome {
  if (error instanceof EmailDeliveryError || error instanceof SmsDeliveryError) {
    return error.retryable ? { kind: "retry", code: "provider_unavailable" } : { kind: "failed", code: "rejected_by_provider" };
  }
  // Unknown errors are treated as transient; the code never carries the error text.
  return { kind: "retry", code: "unexpected_error" };
}

async function deliver(deps: DispatchDeps, pending: Pending): Promise<Outcome> {
  const kind = recipientKind(pending.event, pending.channel);

  if (pending.channel === "email") {
    // Residents may switch off their report emails; staff escalation emails are operational.
    if (kind === "reporter" && !pending.notifyEmail) return { kind: "skipped", reason: "email_opted_out" };
  } else {
    if (deps.sms === null) return { kind: "skipped", reason: "sms_disabled" };
    if (!pending.notifySms || !pending.phoneVerified || pending.phone === null) {
      return { kind: "skipped", reason: "sms_not_enabled" };
    }
  }

  const timer: SlaTimer | null =
    pending.discriminator === "acknowledge" || pending.discriminator === "resolve" ? pending.discriminator : null;
  const context: MessageContext = {
    reference: pending.reference,
    url: reportUrl(deps.baseUrl, kind, pending.reportId),
    agencyName: pending.agencyName,
    reason: pending.event === "report_rejected" ? await rejectionReason(deps.db, pending.reportId) : null,
    timer,
  };

  try {
    if (pending.channel === "email") {
      await deps.email.send({ to: pending.email, ...renderEmail(pending.event, context), idempotencyKey: pending.id });
    } else {
      const text = renderSms(pending.event, context);
      if (text === null || deps.sms === null || pending.phone === null) {
        return { kind: "skipped", reason: "sms_not_enabled" };
      }
      await deps.sms.send({ to: pending.phone, text });
    }
    return { kind: "sent" };
  } catch (error) {
    return failureOutcome(error);
  }
}

async function record(deps: DispatchDeps, pending: Pending, outcome: Outcome): Promise<keyof DispatchResult> {
  const attempts = pending.attempts + 1;
  const where = and(eq(notifications.id, pending.id), eq(notifications.status, "pending"));

  switch (outcome.kind) {
    case "sent":
      await deps.db
        .update(notifications)
        .set({ status: "sent", attempts, sentAt: deps.clock.now(), lastError: null })
        .where(where);
      return "sent";
    case "skipped":
      await deps.db.update(notifications).set({ status: "skipped", skippedReason: outcome.reason }).where(where);
      return "skipped";
    case "failed":
      await deps.db.update(notifications).set({ status: "failed", attempts, lastError: outcome.code }).where(where);
      return "failed";
    case "retry": {
      const next = nextAttemptAt(attempts, deps.clock);
      if (next === null) {
        await deps.db
          .update(notifications)
          .set({ status: "failed", attempts, lastError: "retries_exhausted" })
          .where(where);
        return "failed";
      }
      await deps.db
        .update(notifications)
        .set({ attempts, nextAttemptAt: next, lastError: outcome.code })
        .where(where);
      return "retrying";
    }
  }
}

/**
 * Sends due notifications (ADR 0011). Rows are claimed with a short lease so overlapping runs or
 * two workers never take the same row; a row is sent at most once per run and recorded after.
 * Safe to repeat: sent, skipped and failed rows are never picked up again.
 */
export async function runDispatch(deps: DispatchDeps): Promise<DispatchResult> {
  const result: DispatchResult = { sent: 0, retrying: 0, failed: 0, skipped: 0 };
  for (const id of await claim(deps)) {
    const pending = await load(deps.db, id);
    if (!pending) continue;
    const outcome = await deliver(deps, pending);
    result[await record(deps, pending, outcome)] += 1;
  }
  return result;
}
