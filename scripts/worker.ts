import { PgBoss } from "pg-boss";
import { createDb } from "../src/db/client";
import { systemClock } from "../src/domain/clock";
import { createEmailSender } from "../src/server/adapters/email";
import { createMediaStorage } from "../src/server/adapters/media";
import { createSmsSender } from "../src/server/adapters/sms";
import { parseAppEnv, parseEmailEnv, parseMediaEnv, parseSmsEnv } from "../src/server/env";
import { registerAutoConfirm } from "../src/server/jobs/auto-confirm-job";
import { registerMediaCleanup } from "../src/server/jobs/media-cleanup-job";
import { registerRetention } from "../src/server/jobs/retention-job";
import { registerNotificationDispatch } from "../src/server/jobs/notification-dispatch-job";
import { registerSlaScan } from "../src/server/jobs/sla-scan-job";

// Usage: pnpm worker   (needs DATABASE_URL). A long-running process: run exactly where the app can reach the database.
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const { db, pool } = createDb(url);
  const boss = new PgBoss(url);
  boss.on("error", (error: Error) => console.error("pg-boss error:", error.message));

  await boss.start();
  await registerSlaScan(boss, {
    db,
    clock: systemClock,
    onScan: (result) => {
      if (result.recorded > 0) console.log(`SLA scan recorded ${result.recorded} escalation(s)`);
    },
  });
  await registerAutoConfirm(boss, {
    db,
    clock: systemClock,
    onRun: (result) => {
      if (result.confirmed > 0) console.log(`Auto-confirmed ${result.confirmed} resolved report(s)`);
    },
  });
  await registerRetention(boss, {
    db,
    clock: systemClock,
    onRun: (result) => {
      // Counts only, never the deleted data.
      const total = Object.values(result).reduce((sum, n) => sum + n, 0);
      if (total > 0) console.log(`Retention removed ${total} old record(s)`);
    },
  });
  await registerMediaCleanup(boss, {
    db,
    clock: systemClock,
    storage: createMediaStorage(parseMediaEnv(process.env)),
    onRun: (result) => {
      if (result.deleted + result.retrying + result.failed > 0) {
        console.log(`Photo cleanup: ${result.deleted} deleted, ${result.retrying} retrying, ${result.failed} failed`);
      }
    },
  });
  const sms = createSmsSender(parseSmsEnv(process.env));
  await registerNotificationDispatch(boss, {
    db,
    clock: systemClock,
    email: createEmailSender(parseEmailEnv(process.env)),
    sms,
    baseUrl: parseAppEnv(process.env).baseUrl,
    onDispatch: (result) => {
      const total = result.sent + result.retrying + result.failed + result.skipped;
      if (total > 0) {
        console.log(
          `Notifications: ${result.sent} sent, ${result.retrying} retrying, ${result.failed} failed, ${result.skipped} skipped`,
        );
      }
    },
  });
  console.log(`Worker started: SLA scan and notification dispatch run every minute, auto-confirm hourly, retention daily, photo cleanup every 5 minutes${sms ? "" : " (SMS disabled)"}.`);

  const shutdown = async () => {
    await boss.stop();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Worker failed");
  process.exit(1);
});
