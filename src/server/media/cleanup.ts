/**
 * Deletes queued photos from the media provider, with retries (ADR 0015).
 *
 * Two parts:
 *   - `queueMediaDeletions` is called INSIDE the transaction that erases an account, and just
 *     writes down which photos must go;
 *   - `runMediaCleanup` is run every few minutes by the worker and does the actual deleting.
 *
 * Properties that matter for a background job:
 *   - SAFE TO REPEAT: deleting a photo that is already gone counts as success, and queueing a
 *     photo twice does nothing, so a crash or a retry can never make things worse.
 *   - SAFE WITH SEVERAL WORKERS: each run first "claims" a batch of rows by pushing their due
 *     time forward (a short lease), using `FOR UPDATE SKIP LOCKED` so two workers never take the
 *     same row. If a worker dies mid-way, the lease runs out and the rows are tried again.
 *   - NO LEAKS: errors are recorded as short codes only, and the result of a run is counts only.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db, Tx } from "../../db/client";
import { mediaDeletions } from "../../db/schema";
import type { Clock } from "../../domain/clock";
// The same 1, 5, 30, 120 minute backoff as notifications: it is a generic "retry later" schedule.
import { nextAttemptAt } from "../../domain/notifications/retry";
import { MediaDeletionError, type MediaStorage } from "../adapters/media/media-storage";

/** A claimed row is hidden from other workers for this long; a crashed worker's rows come back after it. */
const LEASE_MS = 5 * 60_000;
const DEFAULT_BATCH = 50;

/**
 * Records that these photos must be deleted. Call inside the open transaction (`tx`) of whatever
 * made them unnecessary, so the request to delete them exists exactly when that change is saved.
 * Queueing a photo that is already queued is silently ignored.
 */
export async function queueMediaDeletions(tx: Tx, publicIds: string[]): Promise<void> {
  if (publicIds.length === 0) return;
  await tx
    .insert(mediaDeletions)
    .values(publicIds.map((publicId) => ({ publicId })))
    .onConflictDoNothing({ target: mediaDeletions.publicId });
}

export interface CleanupResult {
  /** Photos deleted (their queue rows are removed). */
  deleted: number;
  /** Failed this time but will be tried again. */
  retrying: number;
  /** Gave up: the provider refused, or the retries ran out. These need a person to look. */
  failed: number;
}

export interface CleanupDeps {
  db: Db;
  clock: Clock;
  storage: MediaStorage;
  batchSize?: number;
}

/** Claims due rows by moving their next-attempt time forward, and returns their ids and photo ids. */
async function claim(deps: CleanupDeps): Promise<Array<{ id: string; publicId: string; attempts: number }>> {
  const now = deps.clock.now();
  const result = await deps.db.execute<{ id: string; public_id: string; attempts: number }>(sql`
    update media_deletions m
    set next_attempt_at = ${new Date(now.getTime() + LEASE_MS)}
    where m.id in (
      select id from media_deletions
      where status = 'pending' and next_attempt_at <= ${now}
      order by next_attempt_at, id
      limit ${deps.batchSize ?? DEFAULT_BATCH}
      for update skip locked
    )
    returning m.id, m.public_id, m.attempts
  `);
  return result.rows.map((row) => ({ id: row.id, publicId: row.public_id, attempts: Number(row.attempts) }));
}

export async function runMediaCleanup(deps: CleanupDeps): Promise<CleanupResult> {
  const result: CleanupResult = { deleted: 0, retrying: 0, failed: 0 };

  for (const row of await claim(deps)) {
    try {
      await deps.storage.deleteAsset(row.publicId);
      // Gone: the row has done its job.
      await deps.db.delete(mediaDeletions).where(eq(mediaDeletions.id, row.id));
      result.deleted += 1;
      continue;
    } catch (error) {
      // A MediaDeletionError says whether retrying could help. Anything else is unexpected;
      // treat it as temporary so one odd failure does not abandon a photo.
      const retryable = error instanceof MediaDeletionError ? error.retryable : true;
      const code = error instanceof MediaDeletionError ? (retryable ? "provider_unavailable" : "rejected_by_provider") : "unexpected_error";
      const attempts = row.attempts + 1;
      const next = retryable ? nextAttemptAt(attempts, deps.clock) : null;

      if (next === null) {
        // Permanent refusal, or all retries used up. Keep the row (status 'failed') for a person to investigate.
        await deps.db
          .update(mediaDeletions)
          .set({ status: "failed", attempts, lastError: retryable ? "retries_exhausted" : code })
          .where(and(eq(mediaDeletions.id, row.id), eq(mediaDeletions.status, "pending")));
        result.failed += 1;
      } else {
        await deps.db
          .update(mediaDeletions)
          .set({ attempts, nextAttemptAt: next, lastError: code })
          .where(and(eq(mediaDeletions.id, row.id), eq(mediaDeletions.status, "pending")));
        result.retrying += 1;
      }
    }
  }
  return result;
}

/** How many photos are still waiting or have failed, for the operations page. Counts only. */
export async function countMediaDeletions(db: Db): Promise<{ pending: number; failed: number }> {
  const rows = await db
    .select({ status: mediaDeletions.status, n: sql<number>`count(*)::int` })
    .from(mediaDeletions)
    .where(inArray(mediaDeletions.status, ["pending", "failed"]))
    .groupBy(mediaDeletions.status);
  return {
    pending: Number(rows.find((r) => r.status === "pending")?.n ?? 0),
    failed: Number(rows.find((r) => r.status === "failed")?.n ?? 0),
  };
}
