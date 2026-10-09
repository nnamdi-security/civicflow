/**
 * Makes a background job leave a heartbeat every time it runs.
 *
 * Wrap a job's work in `withHeartbeat` and, whether the work succeeds or throws, the job's row in
 * `job_heartbeats` is updated afterwards. That is how the health page knows the worker is alive.
 *
 * Two rules:
 *   - If the job THROWS, the error is recorded (as a short code, never the message) and then
 *     RE-THROWN, so pg-boss still sees the failure and applies its normal retry behaviour.
 *   - Recording the heartbeat is "best effort": if writing it fails (for example the database
 *     blinks), that must never make a healthy job look like it failed, so such errors are ignored.
 */
import type { Db } from "../../db/client";
import type { Clock } from "../../domain/clock";
import type { JobName } from "../../domain/operations";
import { recordHeartbeat } from "../repositories/heartbeats";

export async function withHeartbeat<T>(db: Db, clock: Clock, job: JobName, work: () => Promise<T>): Promise<T> {
  let result: T;
  try {
    result = await work();
  } catch (error) {
    await recordHeartbeat(db, job, clock.now(), { status: "error", code: "job_failed" }).catch(() => undefined);
    throw error;
  }
  await recordHeartbeat(db, job, clock.now(), { status: "ok" }).catch(() => undefined);
  return result;
}
