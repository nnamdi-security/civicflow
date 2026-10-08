import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "@/db/client";

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
