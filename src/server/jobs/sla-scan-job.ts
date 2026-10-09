import type { PgBoss } from "pg-boss";
import type { Db } from "../../db/client";
import type { Clock } from "../../domain/clock";
import { runSlaScan, type ScanResult } from "../sla/scan";
import { withHeartbeat } from "./heartbeat";

export const SLA_SCAN_QUEUE = "sla-scan";
/** Every minute. The scan is idempotent, so overlap or a missed minute is harmless. */
export const SLA_SCAN_CRON = "* * * * *";

export interface JobDeps {
  db: Db;
  clock: Clock;
  /** Test hook: called after each scan completes. */
  onScan?: (result: ScanResult) => void;
}

/** Creates the queue, schedules the recurring scan, and starts handling it. Safe to call on every start. */
export async function registerSlaScan(boss: PgBoss, deps: JobDeps): Promise<void> {
  await boss.createQueue(SLA_SCAN_QUEUE);
  await boss.schedule(SLA_SCAN_QUEUE, SLA_SCAN_CRON);
  await boss.work(SLA_SCAN_QUEUE, async () => {
    const result = await withHeartbeat(deps.db, deps.clock, "sla-scan", () => runSlaScan(deps.db, deps.clock));
    deps.onScan?.(result);
  });
}
