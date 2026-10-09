import { and, eq, isNull } from "drizzle-orm";
import type { Db, Tx } from "../../db/client";
import { notifications, reports, users } from "../../db/schema";
import {
  NOTIFICATION_RULES,
  discriminatorFor,
  type NotificationEvent,
  type RecipientKind,
} from "../../domain/notifications/events";
import type { SlaTimer } from "../../domain/sla";

export interface EnqueueRequest {
  reportId: string;
  event: NotificationEvent;
  slaCycle: number;
  /** Which timer an escalation is about; becomes part of the dedupe key. */
  timer?: SlaTimer;
}

async function recipientsFor(
  db: Db | Tx,
  kind: RecipientKind,
  report: { reporterId: string; agencyId: string | null },
): Promise<string[]> {
  switch (kind) {
    case "reporter":
      return [report.reporterId];
    case "agency_admins": {
      if (report.agencyId === null) return [];
      const rows = await db
        .select({ id: users.id })
        .from(users)
        // `isNull(disabledAt)` skips deactivated accounts: they must not be notified (ADR 0014).
        .where(and(eq(users.role, "agency_admin"), eq(users.agencyId, report.agencyId), isNull(users.disabledAt)));
      return rows.map((row) => row.id);
    }
    case "platform_admins": {
      const rows = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.role, "platform_admin"), isNull(users.disabledAt)));
      return rows.map((row) => row.id);
    }
  }
}

/**
 * Queues the messages an event calls for (docs/integrations.md), one row per recipient user and
 * channel. Call inside the transaction that causes the event, so a rolled-back change leaves
 * nothing behind. Repeating a call queues nothing new. Opt-outs and missing phones are checked at
 * send time, so a preference change still applies to messages already queued. Returns how many
 * rows were newly queued.
 */
export async function enqueueNotifications(tx: Tx, request: EnqueueRequest): Promise<number> {
  const [report] = await tx
    .select({ reporterId: reports.reporterId, agencyId: reports.agencyId })
    .from(reports)
    .where(eq(reports.id, request.reportId))
    .limit(1);
  if (!report) return 0;

  const rows: Array<typeof notifications.$inferInsert> = [];
  for (const intent of NOTIFICATION_RULES[request.event]) {
    for (const recipientUserId of await recipientsFor(tx, intent.recipient, report)) {
      rows.push({
        reportId: request.reportId,
        event: request.event,
        channel: intent.channel,
        recipientUserId,
        slaCycle: request.slaCycle,
        discriminator: discriminatorFor(request.event, request.timer),
      });
    }
  }
  if (rows.length === 0) return 0;

  const inserted = await tx.insert(notifications).values(rows).onConflictDoNothing().returning({ id: notifications.id });
  return inserted.length;
}
