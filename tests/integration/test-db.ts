import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "@/db/client";

type TestConnection = ReturnType<typeof createDb>;

/** Connects to the test database and applies migrations. Fails fast if it is not configured. */
export async function setupTestDb() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error("TEST_DATABASE_URL is not set. Start the database with `pnpm db:up`.");
  }
  const conn = createDb(url);
  await migrate(conn.db, { migrationsFolder: "drizzle" });
  return conn;
}

/**
 * Clears report data. status_events rejects DELETE by design, so tests use TRUNCATE, which
 * only works with table-owner privileges (true for the test database, not for the app).
 */
export async function resetReports(db: TestConnection["db"]) {
  await db.execute(sql`truncate table notifications, escalations, assignments, status_events, report_media, reports`);
}
