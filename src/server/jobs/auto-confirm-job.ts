import type { PgBoss } from "pg-boss";
import { runAutoConfirm, type AutoConfirmDeps, type AutoConfirmResult } from "../reports/auto-confirm";

export const AUTO_CONFIRM_QUEUE = "auto-confirm";
/** Hourly: confirming a day late is harmless, and the scan is idempotent. */
export const AUTO_CONFIRM_CRON = "0 * * * *";

export interface AutoConfirmJobDeps extends AutoConfirmDeps {
  /** Test hook: called after each run completes. */
  onRun?: (result: AutoConfirmResult) => void;
}

export async function registerAutoConfirm(boss: PgBoss, deps: AutoConfirmJobDeps): Promise<void> {
  await boss.createQueue(AUTO_CONFIRM_QUEUE);
  await boss.schedule(AUTO_CONFIRM_QUEUE, AUTO_CONFIRM_CRON);
  await boss.work(AUTO_CONFIRM_QUEUE, async () => {
    deps.onRun?.(await runAutoConfirm(deps));
  });
}
