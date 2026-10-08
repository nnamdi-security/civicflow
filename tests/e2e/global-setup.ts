import { Pool } from "pg";

/** Clears rate-limit counters so repeated local runs do not trip the sign-in limits. */
export default async function globalSetup() {
  const url = process.env.E2E_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error("Set TEST_DATABASE_URL (or E2E_DATABASE_URL) to run the end-to-end tests.");
  }
  const pool = new Pool({ connectionString: url });
  try {
    await pool.query("delete from rate_limits");
  } finally {
    await pool.end();
  }
}
