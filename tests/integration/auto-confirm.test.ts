import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { agencies, categories, reports, statusEvents, users } from "@/db/schema";
import { fixedClock } from "@/domain/clock";
import { AUTO_CONFIRM_REASON } from "@/domain/reports/auto-confirm";
import type { AuthenticatedActor } from "@/server/auth/session-user";
import { listStatusHistory } from "@/server/repositories/report-workflow";
import { changeReportStatus } from "@/server/reports/change-status";
import { runAutoConfirm } from "@/server/reports/auto-confirm";
import { resetReports, setupTestDb } from "./test-db";

let conn: Awaited<ReturnType<typeof setupTestDb>>;
let agencyId: string;
let reporterId: string;
let categoryId: string;
let resident: AuthenticatedActor;

const RESOLVED = new Date("2026-03-01T09:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const SECOND = 1000;
const clockAfter = (ms: number) => fixedClock(new Date(RESOLVED.getTime() + ms));
const run = (ms: number) => runAutoConfirm({ db: conn.db, clock: clockAfter(ms) });

beforeAll(async () => {
  conn = await setupTestDb();
});

beforeEach(async () => {
  await wipe();
  const [agency] = await conn.db.insert(agencies).values({ name: "ac-agency", type: "roads" }).returning();
  const [user] = await conn.db.insert(users).values({ email: "ac@example.com" }).returning();
  const [category] = await conn.db.select().from(categories).limit(1);
  if (!agency || !user || !category) throw new Error("fixtures missing");
  agencyId = agency.id;
  reporterId = user.id;
  categoryId = category.id;
  resident = { userId: user.id, role: "resident", agencyId: null };
});

afterEach(wipe);

afterAll(async () => {
  await conn.pool.end();
});

async function wipe() {
  await resetReports(conn.db);
  await conn.db.delete(users);
  await conn.db.delete(agencies).where(sql`name like 'ac-%'`);
}

let counter = 0;
async function report(overrides: Partial<typeof reports.$inferInsert> = {}) {
  counter += 1;
  const [row] = await conn.db
    .insert(reports)
    .values({
      reference: `CF-AUTOCF${counter}`.padEnd(11, "2").slice(0, 11),
      categoryId,
      reporterId,
      description: "A large pothole on the main road",
      location: sql`ST_SetSRID(ST_MakePoint(3.3792, 6.5244), 4326)::geography` as unknown as string,
      idempotencyKey: crypto.randomUUID(),
      status: "resolved",
      agencyId,
      routedAt: RESOLVED,
      resolvedAt: RESOLVED,
      slaCycle: 1,
      ...overrides,
    })
    .returning();
  if (!row) throw new Error("report not created");
  return row;
}

const statusOf = async (id: string) => (await conn.db.select({ s: reports.status }).from(reports).where(eq(reports.id, id)))[0]?.s;

describe("runAutoConfirm: timing", () => {
  it("leaves a report alone one second before, and exactly at, 14 days", async () => {
    const r = await report();
    expect(await run(14 * DAY - SECOND)).toEqual({ confirmed: 0 });
    expect(await run(14 * DAY)).toEqual({ confirmed: 0 });
    expect(await statusOf(r.id)).toBe("resolved");
  });

  it("confirms one second after 14 days, recording an automatic system event", async () => {
    const r = await report();
    expect(await run(14 * DAY + SECOND)).toEqual({ confirmed: 1 });
    expect(await statusOf(r.id)).toBe("confirmed");

    const events = await conn.db.select().from(statusEvents).where(eq(statusEvents.reportId, r.id));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ fromStatus: "resolved", toStatus: "confirmed", actorId: null, reason: AUTO_CONFIRM_REASON });
    // Resolved time is kept as a record; no timers start.
    const [after] = await conn.db.select().from(reports).where(eq(reports.id, r.id));
    expect(after).toMatchObject({ resolvedAt: RESOLVED, ackDueAt: null, resolveDueAt: null });
  });

  it("counts from the latest resolution: a re-resolved report gets a fresh 14 days", async () => {
    const r = await report({ resolvedAt: new Date(RESOLVED.getTime() + 10 * DAY) });
    expect(await run(14 * DAY + SECOND)).toEqual({ confirmed: 0 });
    expect(await run(24 * DAY + SECOND)).toEqual({ confirmed: 1 });
    expect(await statusOf(r.id)).toBe("confirmed");
  });
});

describe("runAutoConfirm: scope", () => {
  it("touches only resolved reports", async () => {
    const routed = await report({ status: "routed", resolvedAt: null });
    const disputed = await report({ status: "disputed", resolvedAt: null });
    const confirmed = await report({ status: "confirmed" });
    const rejected = await report({ status: "rejected" });
    expect(await run(100 * DAY)).toEqual({ confirmed: 0 });
    for (const r of [routed, disputed, confirmed, rejected]) expect(await statusOf(r.id)).toBe(r.status);
  });

  it("confirms every due report and skips the ones still waiting", async () => {
    const due1 = await report();
    const due2 = await report({ resolvedAt: new Date(RESOLVED.getTime() + 2 * DAY) });
    const waiting = await report({ resolvedAt: new Date(RESOLVED.getTime() + 20 * DAY) });
    expect(await run(17 * DAY)).toEqual({ confirmed: 2 });
    expect(await statusOf(due1.id)).toBe("confirmed");
    expect(await statusOf(due2.id)).toBe("confirmed");
    expect(await statusOf(waiting.id)).toBe("resolved");
  });
});

describe("runAutoConfirm: safety", () => {
  it("does nothing on a second run", async () => {
    await report();
    await run(15 * DAY);
    expect(await run(15 * DAY)).toEqual({ confirmed: 0 });
    expect(await conn.db.select().from(statusEvents)).toHaveLength(1);
  });

  it("confirms once when two runs overlap", async () => {
    await report();
    const results = await Promise.all([run(15 * DAY), run(15 * DAY)]);
    expect(results.reduce((sum, r) => sum + r.confirmed, 0)).toBe(1);
    expect(await conn.db.select().from(statusEvents)).toHaveLength(1);
  });

  it("does not overwrite the resident's own answer", async () => {
    const r = await report();
    const clock = clockAfter(15 * DAY);
    await changeReportStatus({ db: conn.db, clock }, resident, { reportId: r.id, to: "disputed", reason: "still broken" });
    expect(await run(15 * DAY)).toEqual({ confirmed: 0 });
    expect(await statusOf(r.id)).toBe("disputed");
    const history = await listStatusHistory(conn.db, r.id);
    expect(history.map((h) => h.toStatus)).toEqual(["disputed"]);
  });
});
