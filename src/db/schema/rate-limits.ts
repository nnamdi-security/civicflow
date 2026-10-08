import { integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

/** Fixed-window counters (ADR 0006). `key` is a hashed identifier, never a raw email or IP. */
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true, mode: "date" }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.key, table.windowStart] })],
);
