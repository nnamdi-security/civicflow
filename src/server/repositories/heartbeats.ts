/**
 * Reading and writing job heartbeats (see src/db/schema/job-heartbeats.ts for why they exist).
 */
import type { Db } from "../../db/client";
import { jobHeartbeats } from "../../db/schema";
import type { Heartbeat, JobName } from "../../domain/operations";

/**
 * Records that a job just ran. An "upsert": inserts the job's row the first time, and updates it
 * on every later run (`onConflictDoUpdate` means "if a row for this job already exists, change
 * it instead of failing").
 */
export async function recordHeartbeat(
  db: Db,
  job: JobName,
  now: Date,
  outcome: { status: "ok" } | { status: "error"; code: string },
): Promise<void> {
  const values = {
    job,
    lastRunAt: now,
    lastStatus: outcome.status,
    lastError: outcome.status === "error" ? outcome.code : null,
  };
  await db.insert(jobHeartbeats).values(values).onConflictDoUpdate({ target: jobHeartbeats.job, set: values });
}

export interface HeartbeatRow extends Heartbeat {
  job: string;
  lastError: string | null;
}

/** Every job's latest heartbeat, keyed by job name. Jobs that have never run have no entry. */
export async function listHeartbeats(db: Db): Promise<Map<string, HeartbeatRow>> {
  const rows = await db.select().from(jobHeartbeats);
  return new Map(
    rows.map((row) => [
      row.job,
      {
        job: row.job,
        lastRunAt: row.lastRunAt,
        lastStatus: row.lastStatus === "error" ? "error" : "ok",
        lastError: row.lastError,
      },
    ]),
  );
}
