/**
 * The daily housekeeping job: deletes data that has no lasting purpose (ADR 0015).
 *
 * It removes:
 *   - rate-limit counters older than 7 days;
 *   - phone verification codes that have expired;
 *   - sign-in sessions and email sign-in tokens that have expired;
 *   - records of delivered or skipped notifications older than 90 days;
 *   - records of failed notifications older than 180 days.
 *
 * It NEVER touches reports, their history, the audit log, accounts, or notifications that are
 * still waiting to be sent. Those are deliberately kept.
 *
 * Properties that matter for a background job:
 *   - IDEMPOTENT: running it twice does no harm; the second run simply finds nothing to delete.
 *   - GENTLE: it deletes in small batches (a few thousand rows at a time) so it never holds a
 *     database lock for long while the site is being used.
 *   - PRIVACY-SAFE: it returns only counts, never the deleted data, so there is nothing to log
 *     that could contain personal information.
 */
import { sql, type SQL } from "drizzle-orm";
import type { Db } from "../../db/client";
import type { Clock } from "../../domain/clock";
import { RETENTION_DAYS, retentionCutoff } from "../../domain/retention";

/** Rows deleted per database statement. Small enough to be quick, large enough to make progress. */
const DEFAULT_BATCH = 5000;

export interface RetentionResult {
  rateLimits: number;
  phoneVerifications: number;
  sessions: number;
  verificationTokens: number;
  notificationsDelivered: number;
  notificationsFailed: number;
}

/**
 * Deletes rows matching `condition` from `table`, a batch at a time, until none are left.
 *
 * `table` is a fixed name chosen in THIS file (never user input), which is why it is safe to put
 * it into the SQL text with `sql.raw`. `ctid` is Postgres's built-in row address: selecting a
 * limited batch of ctids and deleting exactly those rows is the standard way to delete in chunks.
 */
async function deleteInBatches(db: Db, table: string, condition: SQL, batch: number): Promise<number> {
  let total = 0;
  for (;;) {
    const result = await db.execute(sql`
      delete from ${sql.raw(table)}
      where ctid in (select ctid from ${sql.raw(table)} where ${condition} limit ${batch})
    `);
    const deleted = result.rowCount ?? 0;
    total += deleted;
    if (deleted < batch) return total; // a short batch means we have reached the end
  }
}

export async function runRetention(db: Db, clock: Clock, batch: number = DEFAULT_BATCH): Promise<RetentionResult> {
  const now = clock.now();
  const rateLimitCutoff = retentionCutoff(RETENTION_DAYS.rateLimits, clock);
  const deliveredCutoff = retentionCutoff(RETENTION_DAYS.notificationsDelivered, clock);
  const failedCutoff = retentionCutoff(RETENTION_DAYS.notificationsFailed, clock);

  return {
    rateLimits: await deleteInBatches(db, "rate_limits", sql`window_start < ${rateLimitCutoff}`, batch),
    phoneVerifications: await deleteInBatches(db, "phone_verifications", sql`expires_at < ${now}`, batch),
    sessions: await deleteInBatches(db, "sessions", sql`expires < ${now}`, batch),
    verificationTokens: await deleteInBatches(db, "verification_tokens", sql`expires < ${now}`, batch),
    // Only finished records. 'pending' ones are still waiting to be sent and are never deleted here.
    notificationsDelivered: await deleteInBatches(
      db,
      "notifications",
      sql`status in ('sent', 'skipped') and created_at < ${deliveredCutoff}`,
      batch,
    ),
    notificationsFailed: await deleteInBatches(
      db,
      "notifications",
      sql`status = 'failed' and created_at < ${failedCutoff}`,
      batch,
    ),
  };
}
