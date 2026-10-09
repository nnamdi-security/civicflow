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
 * Empties every table that belongs to reports, so each test starts from a clean slate.
 *
 * Why TRUNCATE and not DELETE: several of these tables are "append-only" (a database trigger
 * refuses UPDATE and DELETE on them, so history cannot be rewritten). TRUNCATE is a different
 * command that the trigger does not block, but it needs table-owner rights, which the test
 * database has and the real app never will.
 *
 * IMPORTANT FOR FUTURE CHANGES: a table that points at `reports` through a foreign key MUST be
 * listed here too, or Postgres refuses to truncate `reports` ("Table X references reports") and
 * nearly every test fails. If you add such a table, add it to this list, and to the `clear()`
 * helpers in the end-to-end specs under tests/e2e/.
 */
export async function resetReports(db: TestConnection["db"]) {
  await db.execute(
    sql`truncate table sla_outcomes, notifications, escalations, assignments, status_events, report_media, reports`,
  );
}
