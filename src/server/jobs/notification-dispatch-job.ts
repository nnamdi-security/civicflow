import type { PgBoss } from "pg-boss";
import { runDispatch, type DispatchDeps, type DispatchResult } from "../notifications/dispatch";

export const NOTIFICATION_DISPATCH_QUEUE = "notification-dispatch";
/** Every minute. Dispatch is idempotent, so overlap or a missed minute is harmless. */
export const NOTIFICATION_DISPATCH_CRON = "* * * * *";

export interface DispatchJobDeps extends DispatchDeps {
  /** Test hook: called after each run completes. */
  onDispatch?: (result: DispatchResult) => void;
}

export async function registerNotificationDispatch(boss: PgBoss, deps: DispatchJobDeps): Promise<void> {
  await boss.createQueue(NOTIFICATION_DISPATCH_QUEUE);
  await boss.schedule(NOTIFICATION_DISPATCH_QUEUE, NOTIFICATION_DISPATCH_CRON);
  await boss.work(NOTIFICATION_DISPATCH_QUEUE, async () => {
    deps.onDispatch?.(await runDispatch(deps));
  });
}
