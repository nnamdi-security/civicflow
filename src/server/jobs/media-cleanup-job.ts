/**
 * Registers the photo-deletion job with the background-job system (pg-boss).
 * The work itself is in src/server/media/cleanup.ts; this file only schedules it.
 */
import type { PgBoss } from "pg-boss";
import { runMediaCleanup, type CleanupDeps, type CleanupResult } from "../media/cleanup";
import { withHeartbeat } from "./heartbeat";

export const MEDIA_CLEANUP_QUEUE = "media-cleanup";
/** Every 5 minutes. Deleting photos is not urgent, and the job is safe to repeat. */
export const MEDIA_CLEANUP_CRON = "*/5 * * * *";

export interface MediaCleanupJobDeps extends CleanupDeps {
  /** Test hook: called with the counts after each run. */
  onRun?: (result: CleanupResult) => void;
}

export async function registerMediaCleanup(boss: PgBoss, deps: MediaCleanupJobDeps): Promise<void> {
  await boss.createQueue(MEDIA_CLEANUP_QUEUE);
  await boss.schedule(MEDIA_CLEANUP_QUEUE, MEDIA_CLEANUP_CRON);
  await boss.work(MEDIA_CLEANUP_QUEUE, async () => {
    deps.onRun?.(await withHeartbeat(deps.db, deps.clock, "media-cleanup", () => runMediaCleanup(deps)));
  });
}
