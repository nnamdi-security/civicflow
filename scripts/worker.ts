import { PgBoss } from "pg-boss";
import { createDb } from "../src/db/client";
import { systemClock } from "../src/domain/clock";
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
  console.log("Worker started: SLA scan runs every minute.");

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
