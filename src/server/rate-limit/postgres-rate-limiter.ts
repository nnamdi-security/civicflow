import { lt, sql } from "drizzle-orm";
import type { Clock } from "../../domain/clock";
import type { Db } from "../../db/client";
import { rateLimits } from "../../db/schema";
import type { RateLimiter, RateLimitResult, RateLimitRule } from "./rate-limiter";

/** Fixed-window limiter backed by PostgreSQL, so limits hold across instances (ADR 0006). */
export class PostgresRateLimiter implements RateLimiter {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  async consume(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
    const nowMs = this.clock.now().getTime();
    const windowStart = new Date(Math.floor(nowMs / rule.windowMs) * rule.windowMs);

    const [row] = await this.db
      .insert(rateLimits)
      .values({ key, windowStart, count: 1 })
      .onConflictDoUpdate({
        target: [rateLimits.key, rateLimits.windowStart],
        set: { count: sql`${rateLimits.count} + 1` },
      })
      .returning({ count: rateLimits.count });

    const count = row?.count ?? Number.POSITIVE_INFINITY;
    return { allowed: count <= rule.limit, remaining: Math.max(0, rule.limit - count) };
  }

  /** Deletes windows that started before `olderThan`. Wired to a pg-boss job in Phase 5. */
  async purge(olderThan: Date): Promise<void> {
    await this.db.delete(rateLimits).where(lt(rateLimits.windowStart, olderThan));
  }
}
