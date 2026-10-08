import { createDb } from "../db/client";
import { parseEnv } from "./env";

type Connection = ReturnType<typeof createDb>;

// Reused across hot reloads in development so pools do not pile up.
const globalForDb = globalThis as unknown as { __civicflowDb?: Connection };

/** Shared application database connection, created on first use. */
export function getDb() {
  globalForDb.__civicflowDb ??= createDb(parseEnv(process.env).DATABASE_URL);
  return globalForDb.__civicflowDb.db;
}
