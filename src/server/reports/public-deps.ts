import { systemClock } from "../../domain/clock";
import { getDb } from "../db";
import { parseMediaEnv, parsePublicEnv } from "../env";
import { PostgresRateLimiter } from "../rate-limit/postgres-rate-limiter";
import type { PublicLookupDeps } from "./public-lookup";

/** Whether the public overdue board, and public deadlines, are switched on (ADR 0013). Off by default. */
export function overdueBoardEnabled(): boolean {
  return parsePublicEnv(process.env).overdueBoard;
}

export function getPublicLookupDeps(): PublicLookupDeps {
  const db = getDb();
  return {
    db,
    clock: systemClock,
    limiter: new PostgresRateLimiter(db, systemClock),
    secret: parseMediaEnv(process.env).AUTH_SECRET,
    showSla: overdueBoardEnabled(),
  };
}
