import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fixedClock } from "@/domain/clock";
import { rateLimits } from "@/db/schema";
import { PostgresRateLimiter } from "@/server/rate-limit/postgres-rate-limiter";
import { rateLimitKey } from "@/server/rate-limit/rate-limiter";
import { setupTestDb } from "./test-db";

let conn: Awaited<ReturnType<typeof setupTestDb>>;
const rule = { limit: 3, windowMs: 60_000 };
const start = new Date("2026-01-01T00:00:00Z");

beforeAll(async () => {
  conn = await setupTestDb();
});

beforeEach(async () => {
  await conn.db.delete(rateLimits);
});

afterAll(async () => {
  await conn.pool.end();
});

describe("PostgresRateLimiter", () => {
  it("allows up to the limit then blocks within the same window", async () => {
    const limiter = new PostgresRateLimiter(conn.db, fixedClock(start));
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await limiter.consume("k", rule));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[2]?.remaining).toBe(0);
  });

  it("resets when the window rolls over", async () => {
    const clock = fixedClock(start);
    const limiter = new PostgresRateLimiter(conn.db, clock);
    for (let i = 0; i < 4; i++) await limiter.consume("k", rule);
    clock.advance(rule.windowMs);
    expect((await limiter.consume("k", rule)).allowed).toBe(true);
  });

  it("keeps keys independent", async () => {
    const limiter = new PostgresRateLimiter(conn.db, fixedClock(start));
    for (let i = 0; i < 4; i++) await limiter.consume("a", rule);
    expect((await limiter.consume("b", rule)).allowed).toBe(true);
  });

  it("counts correctly under concurrent hits", async () => {
    const limiter = new PostgresRateLimiter(conn.db, fixedClock(start));
    const results = await Promise.all(Array.from({ length: 6 }, () => limiter.consume("k", rule)));
    expect(results.filter((r) => r.allowed)).toHaveLength(3);
  });

  it("purges old windows only", async () => {
    const clock = fixedClock(start);
    const limiter = new PostgresRateLimiter(conn.db, clock);
    await limiter.consume("old", rule);
    clock.advance(10 * rule.windowMs);
    await limiter.consume("new", rule);
    await limiter.purge(new Date(clock.now().getTime() - rule.windowMs));
    const rows = await conn.db.select().from(rateLimits);
    expect(rows.map((r) => r.key)).toEqual(["new"]);
  });
});

describe("rateLimitKey", () => {
  it("never contains the raw value and depends on the secret", () => {
    const key = rateLimitKey("secret-one", "email", "user@example.com");
    expect(key).not.toContain("user@example.com");
    expect(key).not.toBe(rateLimitKey("secret-two", "email", "user@example.com"));
    expect(key.startsWith("email:")).toBe(true);
  });
});
