/**
 * Builds the picture of how the system is doing, for the health page and the health endpoint
 * (Phase 8 Part B).
 *
 * It answers three practical questions:
 *   1. Is the background worker alive? (each job's last heartbeat, judged by src/domain/operations.ts)
 *   2. Are messages piling up? (queued emails/SMS that should have gone out but have not)
 *   3. Are photo deletions piling up?
 * Everything returned is a count, a time or a word. There is no personal data, so this is safe to
 * show on the admin page and, in reduced form, on the public health endpoint.
 */
import { sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import type { Clock } from "../../domain/clock";
import {
  JOB_DESCRIPTIONS,
  JOB_EXPECTED_MINUTES,
  JOB_NAMES,
  assessJob,
  assessWorker,
  type JobHealth,
  type JobName,
  type WorkerHealth,
} from "../../domain/operations";
import { countMediaDeletions } from "../media/cleanup";
import { listHeartbeats } from "../repositories/heartbeats";

/** A queued message counts as "stuck" when it was due this long ago and still has not gone. */
export const STUCK_AFTER_MINUTES = 15;

export interface JobStatus {
  job: JobName;
  description: string;
  expectedEveryMinutes: number;
  health: JobHealth;
  lastRunAt: Date | null;
  lastError: string | null;
}

export interface NotificationBacklog {
  /** Messages waiting to be sent (including ones waiting to be retried). */
  pending: number;
  /** Messages that failed for good. */
  failed: number;
  /** Waiting messages that were due more than 15 minutes ago: a sign the sender is not running. */
  stuck: number;
  /** How long, in whole minutes, the longest-overdue waiting message has been due; null if none are due. */
  oldestDueMinutes: number | null;
}

export interface SystemHealth {
  worker: WorkerHealth;
  jobs: JobStatus[];
  notifications: NotificationBacklog;
  photoDeletions: { pending: number; failed: number };
}

async function notificationBacklog(db: Db, clock: Clock): Promise<NotificationBacklog> {
  const now = clock.now();
  const stuckBefore = new Date(now.getTime() - STUCK_AFTER_MINUTES * 60_000);
  const result = await db.execute<{ pending: number; failed: number; stuck: number; oldest_due: Date | null }>(sql`
    select
      count(*) filter (where status = 'pending')::int as pending,
      count(*) filter (where status = 'failed')::int as failed,
      count(*) filter (where status = 'pending' and next_attempt_at < ${stuckBefore})::int as stuck,
      min(next_attempt_at) filter (where status = 'pending' and next_attempt_at <= ${now}) as oldest_due
    from notifications
  `);
  const row = result.rows[0];
  const oldestDue = row?.oldest_due ? new Date(row.oldest_due) : null;
  return {
    pending: Number(row?.pending ?? 0),
    failed: Number(row?.failed ?? 0),
    stuck: Number(row?.stuck ?? 0),
    oldestDueMinutes: oldestDue ? Math.floor((now.getTime() - oldestDue.getTime()) / 60_000) : null,
  };
}

/** The full picture, for the platform-admin health page. */
export async function getSystemHealth(db: Db, clock: Clock): Promise<SystemHealth> {
  const heartbeats = await listHeartbeats(db);
  const jobs: JobStatus[] = JOB_NAMES.map((job) => {
    const beat = heartbeats.get(job) ?? null;
    return {
      job,
      description: JOB_DESCRIPTIONS[job],
      expectedEveryMinutes: JOB_EXPECTED_MINUTES[job],
      health: assessJob(job, beat, clock),
      lastRunAt: beat ? beat.lastRunAt : null,
      lastError: beat ? beat.lastError : null,
    };
  });
  return {
    worker: assessWorker(jobs.map((j) => j.health)),
    jobs,
    notifications: await notificationBacklog(db, clock),
    photoDeletions: await countMediaDeletions(db),
  };
}

/** Just the one-word worker verdict, for the public health endpoint. Never throws: "unknown" on any trouble. */
export async function getWorkerHealth(db: Db, clock: Clock): Promise<WorkerHealth> {
  try {
    const heartbeats = await listHeartbeats(db);
    return assessWorker(JOB_NAMES.map((job) => assessJob(job, heartbeats.get(job) ?? null, clock)));
  } catch {
    return "unknown";
  }
}
