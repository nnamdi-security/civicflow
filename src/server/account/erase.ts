/**
 * Erasing a resident's own account (ADR 0015). This is the "right to be forgotten".
 *
 * What it does, all inside ONE database transaction (a group of changes that either ALL happen or
 * ALL are undone, so a failure halfway can never leave a half-erased person):
 *   1. blanks the free-text notes the person wrote in report histories (the history keeps its
 *      shape: that a dispute happened, and when; only their words go);
 *   2. for each report they filed: replaces the description, and blurs the exact location to the
 *      middle of its area (or a coarse grid square if it has no area);
 *   3. removes their photo records and writes each photo into the deletion queue, so a worker
 *      deletes them from the media provider (with retries);
 *   4. deletes notification records, sessions, pending sign-in links and phone codes for them;
 *   5. strips the account row of personal data and deactivates it, so nobody can sign in again;
 *   6. writes an entry to the audit log that contains no personal data.
 * Afterwards (outside the transaction) it emails the OLD address to say the account is gone.
 *
 * What it deliberately KEEPS: each report with its reference, category, status, handling agency,
 * area and status timeline. That is the public accountability record.
 *
 * Staff cannot use this (see `canEraseAccount`); admins deactivate staff instead.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db, Tx } from "../../db/client";
import {
  notifications,
  phoneVerifications,
  reportMedia,
  reports,
  sessions,
  users,
  verificationTokens,
} from "../../db/schema";
import { canEraseAccount } from "../../domain/permissions";
import { accountErasedEmail } from "../adapters/email/templates/account-erased";
import type { EmailSender } from "../adapters/email/email-sender";
import { ForbiddenError, UnauthenticatedError } from "../auth/errors";
import type { AuthenticatedActor } from "../auth/session-user";
import { queueMediaDeletions } from "../media/cleanup";
import { rateLimitKey, type RateLimiter } from "../rate-limit/rate-limiter";
import { recordAudit } from "../repositories/audit";

/** The word a person must type to confirm. Deliberately not "yes" or "ok", so it cannot be typed by accident. */
export const ERASE_CONFIRMATION_WORD = "DELETE";

/** What replaces each report's description. Long enough to satisfy the description-length rule. */
export const ERASED_DESCRIPTION = "[removed at the reporter's request]";

/** Erasure attempts allowed per account per day. Plenty for honest mistakes, little for abuse. */
export const ERASE_RATE_RULE = { limit: 3, windowMs: 24 * 60 * 60 * 1000 } as const;

export interface EraseDeps {
  db: Db;
  email: EmailSender;
  limiter: RateLimiter;
  /** Keys the rate-limit hash. */
  secret: string;
  /**
   * TEST HOOK ONLY. Runs just before the transaction commits, so a test can make it fail and
   * prove that nothing was half-erased. Production code never sets this.
   */
  beforeCommit?: (tx: Tx) => Promise<void>;
}

export type EraseResult =
  | { ok: true }
  | { ok: false; reason: "malformed" | "wrong_confirmation" | "rate_limited" | "already_erased" };

const inputSchema = z.object({ confirmation: z.string().max(50) });

/** Placeholder address for an erased account. `.invalid` is a reserved name that can never be a real address. */
function placeholderEmail(userId: string): string {
  return `erased-${userId}@erased.invalid`;
}

export async function eraseAccount(
  deps: EraseDeps,
  actor: AuthenticatedActor | null,
  raw: unknown,
): Promise<EraseResult> {
  // 1 + 2: signed in, and a resident.
  if (!actor) throw new UnauthenticatedError();
  if (!canEraseAccount(actor)) throw new ForbiddenError();

  // 3: validate the typed confirmation.
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "malformed" };
  if (parsed.data.confirmation.trim() !== ERASE_CONFIRMATION_WORD) return { ok: false, reason: "wrong_confirmation" };

  // Limit attempts. Keyed hash, so the stored counter cannot be traced back to the person.
  const key = rateLimitKey(deps.secret, "account-erase", actor.userId);
  if (!(await deps.limiter.consume(key, ERASE_RATE_RULE)).allowed) return { ok: false, reason: "rate_limited" };

  const [account] = await deps.db
    .select({ email: users.email, erasedAt: users.erasedAt })
    .from(users)
    .where(eq(users.id, actor.userId))
    .limit(1);
  if (!account || account.erasedAt !== null) return { ok: false, reason: "already_erased" };
  const oldEmail = account.email; // kept only in memory, for the confirmation email below

  const userId = actor.userId;
  const now = new Date();

  await deps.db.transaction(async (tx) => {
    // Switch on the narrow exception that lets us blank the person's notes in the append-only
    // history (migration 0013). `true` as the third argument means "only until this transaction ends".
    await tx.execute(sql`select set_config('civicflow.erasure', 'on', true)`);

    // 1. Blank the free-text notes THIS person wrote. Notes by staff on their reports are not theirs and stay.
    await tx.execute(sql`update status_events set reason = 'removed' where actor_id = ${userId} and reason is not null`);

    // 2. Their reports: replace the description and blur the location.
    //    - If the report has an area, use a point guaranteed to be INSIDE that area (ST_PointOnSurface).
    //    - Otherwise snap the exact point to a 0.1 degree grid (about 11 km), which no longer identifies a home.
    await tx.execute(sql`
      update reports r
      set description = ${ERASED_DESCRIPTION},
          location = coalesce(
            (select ST_PointOnSurface(j.geom)::geography from jurisdictions j where j.id = r.jurisdiction_id),
            ST_SnapToGrid(r.location::geometry, 0.1)::geography
          )
      where r.reporter_id = ${userId}
    `);

    // 3. Photos: remember which to delete at the provider, then drop our records of them.
    const photoRows = await tx
      .select({ publicId: reportMedia.publicId, reportId: reportMedia.reportId })
      .from(reportMedia)
      .innerJoin(reports, eq(reports.id, reportMedia.reportId))
      .where(eq(reports.reporterId, userId));
    await queueMediaDeletions(tx, photoRows.map((row) => row.publicId));
    const reportIds = [...new Set(photoRows.map((row) => row.reportId))];
    if (reportIds.length > 0) await tx.delete(reportMedia).where(inArray(reportMedia.reportId, reportIds));

    // 4. Records about messages to them, and anything that lets them sign in.
    await tx.delete(notifications).where(eq(notifications.recipientUserId, userId));
    await tx.delete(sessions).where(eq(sessions.userId, userId));
    await tx.delete(verificationTokens).where(eq(verificationTokens.identifier, oldEmail));
    await tx.delete(phoneVerifications).where(eq(phoneVerifications.userId, userId));

    // 5. The account row itself: no personal data left, and deactivated for good.
    await tx
      .update(users)
      .set({
        email: placeholderEmail(userId),
        name: null,
        image: null,
        emailVerified: null,
        phoneE164: null,
        phoneVerifiedAt: null,
        notifyEmail: false,
        notifySms: false,
        disabledAt: now,
        erasedAt: now,
      })
      .where(and(eq(users.id, userId), sql`${users.erasedAt} is null`));

    // 6. A record that this happened. It says nothing about who the person was.
    await recordAudit(tx, {
      actor: { userId, role: actor.role },
      action: "account.erased",
      targetType: "user",
      targetId: userId,
      summary: "an account was erased at the user's request",
    });

    await deps.beforeCommit?.(tx);
  });

  // Tell the old address, best effort. If the email cannot be sent, the erasure still stands: it
  // already happened, and failing here must not undo or hide that. Nothing about the address or
  // the failure is logged.
  try {
    await deps.email.send(accountErasedEmail({ to: oldEmail }));
  } catch {
    // intentionally ignored
  }
  return { ok: true };
}
