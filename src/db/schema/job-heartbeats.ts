/**
 * One row per background job, saying when it last ran and whether that run worked.
 *
 * Why: the background worker is a separate process. If it stops, the website keeps working but
 * deadlines stop being enforced and no email or SMS is sent, and nothing on the website shows it.
 * Each job updates its own row every time it runs (a "heartbeat"), and the health page and health
 * endpoint read these rows to tell whether the worker is alive (src/domain/operations.ts).
 *
 * It holds only a job name, a time, "ok" or "error", and a short machine code. No personal data.
 */
import { check, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const jobHeartbeats = pgTable(
  "job_heartbeats",
  {
    /** The job's name, for example "sla-scan". One row per job. */
    job: text("job").primaryKey(),
    lastRunAt: timestamp("last_run_at", { withTimezone: true, mode: "date" }).notNull(),
    /** "ok" or "error". */
    lastStatus: text("last_status").notNull(),
    /** A short code such as "job_failed" when the last run errored; never an error message. */
    lastError: text("last_error"),
  },
  (table) => [check("job_heartbeats_status", sql`${table.lastStatus} in ('ok', 'error')`)],
);
