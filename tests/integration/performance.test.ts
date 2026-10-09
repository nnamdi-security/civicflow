/**
 * Integration tests for the performance dashboards (ADR 0014).
 *
 * "Integration" means these use a REAL PostgreSQL database (not a pretend one), so we can trust
 * that the SQL really counts correctly. We insert small, hand-made sets of data, run the same
 * function the web page calls, and check the numbers. Everything is invented test data.
 *
 * What these tests protect:
 *   1. the arithmetic (percentages, medians, counts);
 *   2. the time WINDOW (an outcome one second outside the window must not be counted);
 *   3. the PRIVACY BOUNDARY (an agency admin must never see another agency's figures).
 */
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { agencies, categories, reports, slaOutcomes, statusEvents, users } from "@/db/schema";
import { fixedClock } from "@/domain/clock";
import { windowStart, type AgencyPerformance } from "@/domain/performance";
import { agencyScopeFor } from "@/domain/permissions";
import { ForbiddenError, UnauthenticatedError } from "@/server/auth/errors";
import type { AuthenticatedActor } from "@/server/auth/session-user";
import { getPerformanceDashboard } from "@/server/performance/dashboard";
import { findAgencyPerformance } from "@/server/repositories/performance";
import { resetReports, setupTestDb } from "./test-db";

let conn: Awaited<ReturnType<typeof setupTestDb>>;
let agencyA: string; // the agency most tests look at
let agencyB: string; // a second agency, used to prove data does not leak across agencies
let agencyC: string; // an agency with no data at all
let categoryId: string;
let reporterId: string;
let platformAdmin: AuthenticatedActor;
let adminA: AuthenticatedActor;
let officerA: AuthenticatedActor;
let resident: AuthenticatedActor;

// "Now" for every test. Using a fixed clock means the results never depend on when the test runs.
const NOW = new Date("2026-04-30T12:00:00Z");
const clock = fixedClock(NOW);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const SECOND = 1000;
const deps = () => ({ db: conn.db, clock });

beforeAll(async () => {
  conn = await setupTestDb();
});

beforeEach(async () => {
  await wipe();
  // Three agencies, and one person of each kind who might open the dashboard.
  const rows = await conn.db
    .insert(agencies)
    .values([
      { name: "perf-agency-a", type: "roads" },
      { name: "perf-agency-b", type: "roads" },
      { name: "perf-agency-c", type: "roads" },
    ])
    .returning();
  const [a, b, c] = rows.sort((x, y) => x.name.localeCompare(y.name));
  const staff = await conn.db
    .insert(users)
    .values([
      { email: "perf-platform@example.com", role: "platform_admin" },
      { email: "perf-admin-a@example.com", role: "agency_admin", agencyId: a?.id },
      { email: "perf-officer-a@example.com", role: "agency_officer", agencyId: a?.id },
      { email: "perf-resident@example.com" },
    ])
    .returning();
  const [category] = await conn.db.select().from(categories).limit(1);
  if (!a || !b || !c || !category) throw new Error("fixtures missing");
  agencyA = a.id;
  agencyB = b.id;
  agencyC = c.id;
  categoryId = category.id;

  const byEmail = (email: string): AuthenticatedActor => {
    const row = staff.find((u) => u.email === email);
    if (!row) throw new Error("user missing");
    return { userId: row.id, role: row.role, agencyId: row.agencyId };
  };
  platformAdmin = byEmail("perf-platform@example.com");
  adminA = byEmail("perf-admin-a@example.com");
  officerA = byEmail("perf-officer-a@example.com");
  resident = byEmail("perf-resident@example.com");
  reporterId = resident.userId;
});

afterEach(wipe);

afterAll(async () => {
  await conn.pool.end();
});

/** Removes everything these tests create, so each test starts clean. */
async function wipe() {
  await resetReports(conn.db);
  await conn.db.delete(users);
  await conn.db.delete(agencies).where(sql`name like 'perf-%'`);
}

let counter = 0;

/** Creates a report held by `agencyId`. `timers` lets a test give it running deadlines. */
async function report(agencyId: string, timers: Partial<typeof reports.$inferInsert> = {}) {
  counter += 1;
  const [row] = await conn.db
    .insert(reports)
    .values({
      reference: `CF-PERF${String(counter).padStart(4, "0")}`.slice(0, 11),
      categoryId,
      reporterId,
      description: "A large pothole on the main road",
      location: sql`ST_SetSRID(ST_MakePoint(3.3792, 6.5244), 4326)::geography` as unknown as string,
      idempotencyKey: crypto.randomUUID(),
      status: "routed",
      agencyId,
      routedAt: new Date(NOW.getTime() - 40 * DAY),
      slaCycle: 1,
      // A running timer must have a start time (a database rule).
      slaStartedAt: new Date(NOW.getTime() - 40 * DAY),
      ...timers,
    })
    .returning();
  if (!row) throw new Error("report not created");
  return row;
}

/**
 * Records that `agencyId` finished a timer. `tookMinutes` is how long it took, and `finishedAgo`
 * is how long before NOW it finished. Each outcome needs its own report (one outcome per
 * report/timer/cycle), so this creates one.
 */
async function outcome(
  agencyId: string,
  options: { timer?: "acknowledge" | "resolve"; met?: boolean; tookMinutes?: number; finishedAgo?: number },
) {
  const { timer = "acknowledge", met = true, tookMinutes = 60, finishedAgo = DAY } = options;
  const r = await report(agencyId, { ackDueAt: null, resolveDueAt: null });
  const stoppedAt = new Date(NOW.getTime() - finishedAgo);
  await conn.db.insert(slaOutcomes).values({
    reportId: r.id,
    agencyId,
    timer,
    slaCycle: 1,
    startedAt: new Date(stoppedAt.getTime() - tookMinutes * MINUTE),
    dueAt: new Date(stoppedAt.getTime() + (met ? HOUR : -HOUR)),
    stoppedAt,
    met,
  });
  return r;
}

/** Finds one agency's figures in a result, failing the test clearly if it is missing. */
function forAgency(result: { agencies: AgencyPerformance[] }, id: string): AgencyPerformance {
  const found = result.agencies.find((a) => a.agencyId === id);
  if (!found) throw new Error("agency missing from the result");
  return found;
}

describe("the arithmetic", () => {
  it("counts on-time percentages and totals for each timer separately", async () => {
    // Agency A acknowledged four reports (3 on time) and resolved two (both on time).
    for (const met of [true, true, true, false]) await outcome(agencyA, { timer: "acknowledge", met });
    for (const met of [true, true]) await outcome(agencyA, { timer: "resolve", met });

    const result = await findAgencyPerformance(conn.db, { kind: "all" }, 30, clock);
    const a = forAgency(result, agencyA);
    expect(a.acknowledge).toMatchObject({ total: 4, met: 3, onTimePercent: 75, lowSample: true });
    expect(a.resolve).toMatchObject({ total: 2, met: 2, onTimePercent: 100 });
  });

  it("reports the median time taken, using the middle value (odd count)", async () => {
    // Times taken: 10, 60 and 300 minutes. The middle one is 60 - NOT the average (123).
    for (const tookMinutes of [10, 60, 300]) await outcome(agencyA, { tookMinutes });
    const a = forAgency(await findAgencyPerformance(conn.db, { kind: "all" }, 30, clock), agencyA);
    expect(a.acknowledge.medianMinutes).toBe(60);
  });

  it("averages the two middle values when the count is even", async () => {
    // Times taken: 10, 20, 40, 100 minutes. The two middle values are 20 and 40, so the median is 30.
    for (const tookMinutes of [10, 20, 40, 100]) await outcome(agencyA, { tookMinutes });
    const a = forAgency(await findAgencyPerformance(conn.db, { kind: "all" }, 30, clock), agencyA);
    expect(a.acknowledge.medianMinutes).toBe(30);
  });

  it("shows zeros and 'no data' (null), not errors, for an agency with nothing recorded", async () => {
    const result = await findAgencyPerformance(conn.db, { kind: "all" }, 30, clock);
    expect(forAgency(result, agencyC)).toMatchObject({
      acknowledge: { total: 0, met: 0, onTimePercent: null, medianMinutes: null, lowSample: true },
      resolve: { total: 0, onTimePercent: null },
      openReports: 0,
      openOverdue: 0,
      resolutions: 0,
      disputes: 0,
      disputeRatePercent: null,
    });
  });

  it("lists agencies by name", async () => {
    const result = await findAgencyPerformance(conn.db, { kind: "all" }, 30, clock);
    expect(result.agencies.map((a) => a.agencyName)).toEqual(["perf-agency-a", "perf-agency-b", "perf-agency-c"]);
  });
});

describe("the time window", () => {
  it("includes an outcome exactly at the start of the window and excludes one a second earlier", async () => {
    const start = windowStart(30, clock);
    // One outcome finishing exactly at the first instant of the window, one a second before it.
    await outcome(agencyA, { finishedAgo: NOW.getTime() - start.getTime() });
    await outcome(agencyA, { finishedAgo: NOW.getTime() - start.getTime() + SECOND });
    const a = forAgency(await findAgencyPerformance(conn.db, { kind: "all" }, 30, clock), agencyA);
    expect(a.acknowledge.total).toBe(1);
  });

  it("uses a longer window when asked, so older outcomes appear", async () => {
    await outcome(agencyA, { finishedAgo: 60 * DAY }); // 60 days ago: outside 30 days, inside 90
    const thirty = forAgency(await findAgencyPerformance(conn.db, { kind: "all" }, 30, clock), agencyA);
    const ninety = forAgency(await findAgencyPerformance(conn.db, { kind: "all" }, 90, clock), agencyA);
    expect([thirty.acknowledge.total, ninety.acknowledge.total]).toEqual([0, 1]);
  });
});

describe("open and overdue reports", () => {
  it("counts reports with a running timer, and those already past a deadline", async () => {
    await report(agencyA, { ackDueAt: new Date(NOW.getTime() + HOUR) }); // running, not late
    await report(agencyA, { ackDueAt: new Date(NOW.getTime() - HOUR) }); // running, late
    await report(agencyA, { ackDueAt: null, resolveDueAt: new Date(NOW.getTime() - DAY) }); // resolve timer, late
    await report(agencyA, { ackDueAt: null, resolveDueAt: null, status: "confirmed" }); // closed: not counted
    const a = forAgency(await findAgencyPerformance(conn.db, { kind: "all" }, 30, clock), agencyA);
    expect(a.openReports).toBe(3);
    expect(a.openOverdue).toBe(2);
  });

  it("does not call a report overdue exactly at its deadline", async () => {
    await report(agencyA, { ackDueAt: NOW }); // due this very instant
    const a = forAgency(await findAgencyPerformance(conn.db, { kind: "all" }, 30, clock), agencyA);
    expect(a.openReports).toBe(1);
    expect(a.openOverdue).toBe(0); // overdue only starts one instant AFTER the deadline
  });

  it("counts only the agency's own reports", async () => {
    await report(agencyA, { ackDueAt: new Date(NOW.getTime() - HOUR) });
    await report(agencyB, { ackDueAt: new Date(NOW.getTime() - HOUR) });
    const result = await findAgencyPerformance(conn.db, { kind: "all" }, 30, clock);
    expect([forAgency(result, agencyA).openOverdue, forAgency(result, agencyB).openOverdue]).toEqual([1, 1]);
  });
});

describe("disputes", () => {
  it("computes the dispute rate from disputes and resolutions in the window", async () => {
    // Four resolutions, one of which the resident then disputed.
    const reportsResolved = [];
    for (let i = 0; i < 4; i++) reportsResolved.push(await outcome(agencyA, { timer: "resolve" }));
    await conn.db.insert(statusEvents).values({
      reportId: reportsResolved[0]?.id ?? "",
      fromStatus: "resolved",
      toStatus: "disputed",
      reason: "still broken",
      createdAt: new Date(NOW.getTime() - DAY),
    });
    const a = forAgency(await findAgencyPerformance(conn.db, { kind: "all" }, 30, clock), agencyA);
    expect(a).toMatchObject({ resolutions: 4, disputes: 1, disputeRatePercent: 25 });
  });

  it("ignores disputes outside the window and disputes about other agencies' reports", async () => {
    const mine = await outcome(agencyA, { timer: "resolve" });
    const theirs = await outcome(agencyB, { timer: "resolve" });
    await conn.db.insert(statusEvents).values([
      { reportId: mine.id, fromStatus: "resolved", toStatus: "disputed", reason: "old", createdAt: new Date(NOW.getTime() - 60 * DAY) },
      { reportId: theirs.id, fromStatus: "resolved", toStatus: "disputed", reason: "other", createdAt: new Date(NOW.getTime() - DAY) },
    ]);
    const result = await findAgencyPerformance(conn.db, { kind: "all" }, 30, clock);
    expect(forAgency(result, agencyA).disputes).toBe(0);
    expect(forAgency(result, agencyB).disputes).toBe(1);
  });
});

describe("records start date", () => {
  it("reports when the first outcome was recorded, and null when there are none", async () => {
    expect((await findAgencyPerformance(conn.db, { kind: "all" }, 30, clock)).recordsSince).toBeNull();
    const first = await outcome(agencyA, {});
    const [row] = await conn.db.select({ createdAt: slaOutcomes.createdAt }).from(slaOutcomes);
    expect(first.id).toBeTruthy();
    expect((await findAgencyPerformance(conn.db, { kind: "all" }, 30, clock)).recordsSince).toEqual(row?.createdAt);
  });
});

// -------------------------------------------------------------------------------------------
// The privacy boundary. These are the most important tests in this file.
// -------------------------------------------------------------------------------------------
describe("who can see which agency", () => {
  beforeEach(async () => {
    // Give BOTH agencies data, so a leak would be visible.
    await outcome(agencyA, {});
    await outcome(agencyB, {});
  });

  it("lets a platform admin see every agency", async () => {
    const dashboard = await getPerformanceDashboard(deps(), platformAdmin, "30");
    expect(dashboard.agencies.map((a) => a.agencyId).sort()).toEqual([agencyA, agencyB, agencyC].sort());
  });

  it("shows an agency admin ONLY their own agency", async () => {
    const dashboard = await getPerformanceDashboard(deps(), adminA, "30");
    expect(dashboard.agencies.map((a) => a.agencyId)).toEqual([agencyA]);
    // And nothing from agency B is hiding anywhere in the response.
    expect(JSON.stringify(dashboard)).not.toContain("perf-agency-b");
    expect(JSON.stringify(dashboard)).not.toContain(agencyB);
  });

  it("enforces the limit inside the query itself, even if a page forgot to check", async () => {
    // We bypass the use case and call the query directly with an agency-only scope.
    const result = await findAgencyPerformance(conn.db, agencyScopeFor(adminA), 30, clock);
    expect(result.agencies.map((a) => a.agencyId)).toEqual([agencyA]);
  });

  it("returns nothing for the 'none' scope", async () => {
    expect(await findAgencyPerformance(conn.db, { kind: "none" }, 30, clock)).toEqual({ agencies: [], recordsSince: null });
  });

  it("refuses officers and residents, and people who are not signed in", async () => {
    await expect(getPerformanceDashboard(deps(), officerA, "30")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getPerformanceDashboard(deps(), resident, "30")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getPerformanceDashboard(deps(), null, "30")).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("falls back to 30 days for an invalid window instead of failing", async () => {
    for (const bad of ["7", "abc", "", undefined, "30; drop table reports"]) {
      expect((await getPerformanceDashboard(deps(), platformAdmin, bad)).days).toBe(30);
    }
    expect((await getPerformanceDashboard(deps(), platformAdmin, "90")).days).toBe(90);
  });
});
