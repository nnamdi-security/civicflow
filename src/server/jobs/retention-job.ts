/**
 * Registers the daily housekeeping job with the background-job system (pg-boss).
 * The job itself is in src/server/retention/run.ts; this file only schedules it.
 */
import type { PgBoss } from "pg-boss";
import type { Db } from "../../db/client";
import type { Clock } from "../../domain/clock";
import { runRetention, type RetentionResult } from "../retention/run";
import { withHeartbeat } from "./heartbeat";

export const RETENTION_QUEUE = "retention";
/** Every day at 03:00 UTC (04:00 in Nigeria), when the site is quiet. "0 3 * * *" is cron for that. */
export const RETENTION_CRON = "0 3 * * *";

export interface RetentionJobDeps {
  db: Db;
  clock: Clock;
  /** Test hook: called with the counts after each run. */
  onRun?: (result: RetentionResult) => void;
}

export async function registerRetention(boss: PgBoss, deps: RetentionJobDeps): Promise<void> {
  await boss.createQueue(RETENTION_QUEUE);
  await boss.schedule(RETENTION_QUEUE, RETENTION_CRON);
  await boss.work(RETENTION_QUEUE, async () => {
    deps.onRun?.(await withHeartbeat(deps.db, deps.clock, "retention", () => runRetention(deps.db, deps.clock)));
  });
}
