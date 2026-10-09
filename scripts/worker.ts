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
import { errorFields, logger } from "../src/server/logging/logger";

/**
 * The background worker: a separate, long-running process that runs the scheduled jobs (SLA scan,
 * notification dispatch, auto-confirm, retention, photo cleanup). The website works without it,
 * but deadlines are not enforced and no messages are sent while it is stopped.
 *
 * Usage: pnpm worker   (needs DATABASE_URL, AUTH_SECRET, and the same email/media settings as the web app).
 * Run it exactly where it can reach the database.
 *
 * Logging: this process is unattended, so its output ends up in a log system. It therefore uses
 * the structured logger, which writes one JSON line per event and automatically strips anything
 * that looks like personal data (src/server/logging). Log counts and kinds of events, never people.
 */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const { db, pool } = createDb(url);
  const boss = new PgBoss(url);
  boss.on("error", (error: Error) => logger.error("worker.queue_error", errorFields(error)));

  await boss.start();
  await registerSlaScan(boss, {
    db,
    clock: systemClock,
    onScan: (result) => {
      if (result.recorded > 0) logger.info("sla_scan.recorded", { escalations: result.recorded });
    },
  });
  await registerAutoConfirm(boss, {
    db,
    clock: systemClock,
    onRun: (result) => {
      if (result.confirmed > 0) logger.info("auto_confirm.confirmed", { reports: result.confirmed });
    },
  });
  await registerRetention(boss, {
    db,
    clock: systemClock,
    onRun: (result) => {
      // Counts only, never the deleted data.
      const total = Object.values(result).reduce((sum, n) => sum + n, 0);
      if (total > 0) logger.info("retention.removed", { total, ...result });
    },
  });
  await registerMediaCleanup(boss, {
    db,
    clock: systemClock,
    storage: createMediaStorage(parseMediaEnv(process.env)),
    onRun: (result) => {
      if (result.deleted + result.retrying + result.failed > 0) logger.info("media_cleanup.finished", { ...result });
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
      if (total > 0) logger.info("notification_dispatch.finished", { ...result });
    },
  });
  logger.info("worker.started", {
    jobs: ["sla-scan", "notification-dispatch", "auto-confirm", "retention", "media-cleanup"],
    smsEnabled: sms !== null,
  });

  const shutdown = async () => {
    logger.info("worker.stopping");
    await boss.stop();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error: unknown) => {
  logger.error("worker.failed_to_start", errorFields(error));
  process.exit(1);
});
