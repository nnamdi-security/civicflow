/**
 * What "healthy" means for the background jobs (Phase 8 Part B).
 *
 * CivicFlow runs several jobs in a separate "worker" process: scanning for overdue reports,
 * sending notifications, confirming old resolved reports, tidying old data, deleting photos.
 * If that process stops, the website keeps working, but deadlines stop being enforced and nobody
 * gets any email or SMS. Nothing on the website would show it. So each job leaves a "heartbeat"
 * (the time it last ran and whether it worked), and these pure rules turn heartbeats into a
 * plain verdict that the health page and the health endpoint can show.
 *
 * Pure: no database and no real clock, only the values given. Easy to test at the boundaries.
 */
import type { Clock } from "./clock";

/** Every job the worker runs. Names match the queue names in src/server/jobs/. */
export const JOB_NAMES = ["sla-scan", "notification-dispatch", "auto-confirm", "retention", "media-cleanup"] as const;
export type JobName = (typeof JOB_NAMES)[number];

/** How often each job is meant to run, in minutes (see the cron schedules in src/server/jobs/). */
export const JOB_EXPECTED_MINUTES: Readonly<Record<JobName, number>> = {
  "sla-scan": 1,
  "notification-dispatch": 1,
  "auto-confirm": 60,
  retention: 24 * 60,
  "media-cleanup": 5,
};

/** A job is "late" when it has not run for this many times its normal interval. Generous, to avoid false alarms. */
export const LATE_AFTER_INTERVALS = 3;

/** A human description of each job, for the health page. */
export const JOB_DESCRIPTIONS: Readonly<Record<JobName, string>> = {
  "sla-scan": "Checks for overdue reports and escalates them",
  "notification-dispatch": "Sends queued emails and text messages",
  "auto-confirm": "Confirms resolved reports nobody answered",
  retention: "Removes old technical records",
  "media-cleanup": "Deletes photos of erased accounts",
};

/** What a job last reported. `null` (no heartbeat) means it has never run. */
export interface Heartbeat {
  lastRunAt: Date;
  lastStatus: "ok" | "error";
}

/**
 * The verdict for one job:
 *   - never_run: no heartbeat at all (a fresh install, or the worker has never started);
 *   - failing:   its last run ended in an error;
 *   - late:      it has not run for more than 3 times its normal interval;
 *   - ok:        it ran recently and worked.
 * "Failing" is checked before "late", because a job that errors every time also looks late.
 */
export type JobHealth = "ok" | "failing" | "late" | "never_run";

export function assessJob(job: JobName, heartbeat: Heartbeat | null, clock: Clock): JobHealth {
  if (heartbeat === null) return "never_run";
  if (heartbeat.lastStatus === "error") return "failing";
  const allowedMs = JOB_EXPECTED_MINUTES[job] * LATE_AFTER_INTERVALS * 60_000;
  // Strictly more than allowed: exactly at the limit is still fine.
  return clock.now().getTime() - heartbeat.lastRunAt.getTime() > allowedMs ? "late" : "ok";
}

/**
 * One word for the whole worker, used by the public health endpoint:
 *   - unknown:  no job has ever run (nothing to judge yet);
 *   - ok:       every job is ok;
 *   - degraded: at least one job is late, failing or has never run while others have.
 */
export type WorkerHealth = "ok" | "degraded" | "unknown";

export function assessWorker(healths: readonly JobHealth[]): WorkerHealth {
  if (healths.every((h) => h === "never_run")) return "unknown";
  return healths.every((h) => h === "ok") ? "ok" : "degraded";
}
