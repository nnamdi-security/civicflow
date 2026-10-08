import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  agencies,
  agencyJurisdictions,
  assignments,
  categories,
  jurisdictions,
  rateLimits,
  reports,
  statusEvents,
  users,
} from "@/db/schema";
import { fixedClock } from "@/domain/clock";
import { FakeMediaStorage } from "@/server/adapters/media";
import { ForbiddenError, UnauthenticatedError } from "@/server/auth/errors";
import type { AuthenticatedActor } from "@/server/auth/session-user";
import { PostgresRateLimiter } from "@/server/rate-limit/postgres-rate-limiter";
import {
  listReportsForScope,
  listStatusHistory,
  listTriageReports,
  findReportForScope,
} from "@/server/repositories/report-workflow";
import { changeReportStatus } from "@/server/reports/change-status";
import { createReport, type CreateReportDeps } from "@/server/reports/create-report";
import { reassignReport } from "@/server/reports/reassign-report";
import { agencyScopeFor } from "@/domain/permissions";
import { resetReports, setupTestDb } from "./test-db";

let conn: Awaited<ReturnType<typeof setupTestDb>>;
let deps: CreateReportDeps;
let media: FakeMediaStorage;
const clock = fixedClock(new Date("2026-03-01T09:00:00Z"));

let stateId: string;
let agencyA: string;
let agencyB: string;
let categoryId: string;
let resident: AuthenticatedActor;
let otherResident: AuthenticatedActor;
let officerA: AuthenticatedActor;
let adminA: AuthenticatedActor;
let officerB: AuthenticatedActor;
let adminB: AuthenticatedActor;
let platform: AuthenticatedActor;

// Inside Nigeria's submission bounds, away from the dev sample data. The test jurisdiction covers 9..10.
const IN_COVERAGE = { lon: 9.5, lat: 9.5 };
const OUTSIDE = { lon: 13, lat: 13 };
const box = "POLYGON((9 9, 10 9, 10 10, 9 10, 9 9))";

beforeAll(async () => {
  conn = await setupTestDb();
});

async function wipe() {
  await resetReports(conn.db);
  await conn.db.delete(rateLimits);
  await conn.db.delete(users);
  await conn.db.delete(agencies).where(sql`name like 'wf-%'`);
  await conn.db.delete(jurisdictions).where(sql`name like 'wf-%'`);
}

beforeEach(async () => {
  await wipe();
  const [state] = await conn.db
    .insert(jurisdictions)
    .values({ name: "wf-state", level: "state", geom: sql`ST_Multi(ST_GeomFromText(${box}, 4326))` })
    .returning();
  const [a, b] = await conn.db
    .insert(agencies)
    .values([
      { name: "wf-agency-a", type: "roads" },
      { name: "wf-agency-b", type: "roads" },
    ])
    .returning();
  if (!state || !a || !b) throw new Error("fixtures missing");
  stateId = state.id;
  agencyA = a.id;
  agencyB = b.id;
  await conn.db.insert(agencyJurisdictions).values({ agencyId: agencyA, jurisdictionId: stateId, priority: 0 });

  const rows = await conn.db
    .insert(users)
    .values([
      { email: "res@example.com" },
      { email: "res2@example.com" },
      { email: "oa@example.com", role: "agency_officer", agencyId: agencyA },
      { email: "aa@example.com", role: "agency_admin", agencyId: agencyA },
      { email: "ob@example.com", role: "agency_officer", agencyId: agencyB },
      { email: "ab@example.com", role: "agency_admin", agencyId: agencyB },
      { email: "pa@example.com", role: "platform_admin" },
    ])
    .returning();
  const byEmail = (email: string): AuthenticatedActor => {
    const row = rows.find((r) => r.email === email);
    if (!row) throw new Error("user missing");
    return { userId: row.id, role: row.role, agencyId: row.agencyId };
  };
  resident = byEmail("res@example.com");
  otherResident = byEmail("res2@example.com");
  officerA = byEmail("oa@example.com");
  adminA = byEmail("aa@example.com");
  officerB = byEmail("ob@example.com");
  adminB = byEmail("ab@example.com");
  platform = byEmail("pa@example.com");

  const [category] = await conn.db.select().from(categories).where(eq(categories.slug, "roads"));
  if (!category) throw new Error("category missing");
  categoryId = category.id;

  media = new FakeMediaStorage();
  deps = {
    db: conn.db,
    clock,
    media,
    limiter: new PostgresRateLimiter(conn.db, clock),
    secret: "s".repeat(32),
    randomBytes: (n) => randomBytes(n),
  };
});

afterEach(wipe);

afterAll(async () => {
  await conn.pool.end();
});

async function submit(point = IN_COVERAGE, as: AuthenticatedActor = resident) {
  const result = await createReport(deps, as, {
    categoryId,
    description: "A large pothole on the main road near the market",
    lon: point.lon,
    lat: point.lat,
    photoPublicIds: [media.simulateUpload(as.userId).publicId],
    idempotencyKey: crypto.randomUUID(),
  });
  if (!result.ok) throw new Error(`submit failed: ${result.reason}`);
  return result.report.id;
}

const to = (reportId: string, status: string, reason?: string) => ({ reportId, to: status, reason });
const statusOf = async (id: string) =>
  (await conn.db.select({ s: reports.status }).from(reports).where(eq(reports.id, id)))[0]?.s;

/** Brings a fresh routed report to `resolved`. */
async function resolvedReport() {
  const id = await submit();
  for (const status of ["acknowledged", "in_progress", "resolved"]) {
    expect(await changeReportStatus(deps, officerA, to(id, status))).toMatchObject({ ok: true });
  }
  return id;
}

describe("routing at submission", () => {
  it("routes a report inside coverage to its agency, with assignment, events and routed_at", async () => {
    const id = await submit();
    const [report] = await conn.db.select().from(reports).where(eq(reports.id, id));
    expect(report).toMatchObject({ status: "routed", agencyId: agencyA });
    expect(report?.routedAt).toEqual(clock.now());

    const rows = await conn.db.select().from(assignments).where(eq(assignments.reportId, id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ agencyId: agencyA, assignedBy: null, reason: "auto-routed" });

    const history = await listStatusHistory(conn.db, id);
    expect(history.map((h) => [h.fromStatus, h.toStatus])).toEqual([
      [null, "submitted"],
      ["submitted", "routed"],
    ]);
    const events = await conn.db.select().from(statusEvents).where(eq(statusEvents.reportId, id));
    expect(events.find((e) => e.toStatus === "routed")?.actorId).toBeNull();
  });

  it("leaves a report outside every jurisdiction in the triage queue", async () => {
    const id = await submit(OUTSIDE);
    const [report] = await conn.db.select().from(reports).where(eq(reports.id, id));
    expect(report).toMatchObject({ status: "submitted", agencyId: null, routedAt: null });
    expect(await conn.db.select().from(assignments)).toHaveLength(0);
    expect((await listTriageReports(conn.db)).map((r) => r.id)).toEqual([id]);
  });
});

describe("changeReportStatus", () => {
  it("lets the assigned agency's officer walk the happy path and records every event", async () => {
    const id = await resolvedReport();
    expect(await changeReportStatus(deps, resident, to(id, "confirmed"))).toEqual({ ok: true, status: "confirmed" });
    const history = await listStatusHistory(conn.db, id);
    expect(history.map((h) => h.toStatus)).toEqual([
      "submitted",
      "routed",
      "acknowledged",
      "in_progress",
      "resolved",
      "confirmed",
    ]);
  });

  it("requires a sign-in", async () => {
    const id = await submit();
    await expect(changeReportStatus(deps, null, to(id, "acknowledged"))).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("answers not_found for another agency's staff and for strangers, changing nothing", async () => {
    const id = await submit();
    for (const who of [officerB, adminB, otherResident]) {
      expect(await changeReportStatus(deps, who, to(id, "acknowledged"))).toEqual({ ok: false, reason: "not_found" });
    }
    expect(await statusOf(id)).toBe("routed");
  });

  it("denies the reporter a staff move and staff the resident's verdict", async () => {
    const id = await submit();
    expect(await changeReportStatus(deps, resident, to(id, "acknowledged"))).toEqual({ ok: false, reason: "forbidden" });
    const resolved = await resolvedReport();
    expect(await changeReportStatus(deps, officerA, to(resolved, "confirmed"))).toEqual({ ok: false, reason: "forbidden" });
  });

  it("rejects moves outside the table and the routed target", async () => {
    const id = await submit();
    expect(await changeReportStatus(deps, officerA, to(id, "resolved"))).toEqual({ ok: false, reason: "not_allowed" });
    expect(await changeReportStatus(deps, platform, to(id, "routed"))).toEqual({ ok: false, reason: "malformed" });
  });

  it("requires a reason to reject and stores it", async () => {
    const id = await submit();
    expect(await changeReportStatus(deps, officerA, to(id, "rejected"))).toEqual({ ok: false, reason: "reason_required" });
    expect(await changeReportStatus(deps, officerA, to(id, "rejected", " duplicate of CF-1 "))).toMatchObject({ ok: true });
    const history = await listStatusHistory(conn.db, id);
    expect(history.at(-1)).toMatchObject({ toStatus: "rejected", reason: "duplicate of CF-1" });
  });

  it("lets a resident dispute and staff reopen", async () => {
    const id = await resolvedReport();
    expect(await changeReportStatus(deps, resident, to(id, "disputed", "still broken"))).toMatchObject({ ok: true });
    expect(await changeReportStatus(deps, officerA, to(id, "in_progress"))).toMatchObject({ ok: true });
  });

  it("lets only one of two concurrent identical moves win", async () => {
    const id = await submit();
    const results = await Promise.all([
      changeReportStatus(deps, officerA, to(id, "acknowledged")),
      changeReportStatus(deps, adminA, to(id, "acknowledged")),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const history = await listStatusHistory(conn.db, id);
    expect(history.filter((h) => h.toStatus === "acknowledged")).toHaveLength(1);
  });
});

describe("reassignReport", () => {
  it("lets a platform admin route a triaged report, recording the assignment and event", async () => {
    const id = await submit(OUTSIDE);
    expect(await reassignReport({ db: conn.db, clock }, platform, { reportId: id, agencyId: agencyB })).toEqual({ ok: true });
    const [report] = await conn.db.select().from(reports).where(eq(reports.id, id));
    expect(report).toMatchObject({ status: "routed", agencyId: agencyB });
    expect(report?.routedAt).toEqual(clock.now());
    const [assignment] = await conn.db.select().from(assignments).where(eq(assignments.reportId, id));
    expect(assignment).toMatchObject({ agencyId: agencyB, assignedBy: platform.userId, reason: "reassigned" });
    expect(await listTriageReports(conn.db)).toHaveLength(0);
  });

  it("moves a report between agencies, returning it to routed and keeping history", async () => {
    const id = await submit();
    await changeReportStatus(deps, officerA, to(id, "acknowledged"));
    const result = await reassignReport({ db: conn.db, clock }, adminA, { reportId: id, agencyId: agencyB, reason: "wrong LGA" });
    expect(result).toEqual({ ok: true });
    const [report] = await conn.db.select().from(reports).where(eq(reports.id, id));
    expect(report).toMatchObject({ status: "routed", agencyId: agencyB });
    const rows = await conn.db.select().from(assignments).where(eq(assignments.reportId, id));
    expect(rows.map((r) => r.agencyId).sort()).toEqual([agencyA, agencyB].sort());
    expect((await listStatusHistory(conn.db, id)).at(-1)).toMatchObject({
      fromStatus: "acknowledged",
      toStatus: "routed",
      reason: "reassigned: wrong LGA",
    });
    // Agency A has lost access.
    expect(await changeReportStatus(deps, officerA, to(id, "in_progress"))).toEqual({ ok: false, reason: "not_found" });
  });

  it("throws Forbidden for officers and residents, and not_found for another agency's admin", async () => {
    const id = await submit();
    const body = { reportId: id, agencyId: agencyB };
    await expect(reassignReport({ db: conn.db, clock }, officerA, body)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(reassignReport({ db: conn.db, clock }, resident, body)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await reassignReport({ db: conn.db, clock }, adminB, body)).toEqual({ ok: false, reason: "not_found" });
    expect(await statusOf(id)).toBe("routed");
  });

  it("does not let an agency admin touch triage, and rejects bad targets", async () => {
    const triaged = await submit(OUTSIDE);
    expect(await reassignReport({ db: conn.db, clock }, adminA, { reportId: triaged, agencyId: agencyA })).toEqual({
      ok: false,
      reason: "not_found",
    });
    const id = await submit();
    expect(await reassignReport({ db: conn.db, clock }, adminA, { reportId: id, agencyId: agencyA })).toEqual({
      ok: false,
      reason: "same_agency",
    });
    expect(await reassignReport({ db: conn.db, clock }, adminA, { reportId: id, agencyId: crypto.randomUUID() })).toEqual({
      ok: false,
      reason: "unknown_agency",
    });
  });

  it("refuses to reassign a resolved report", async () => {
    const id = await resolvedReport();
    expect(await reassignReport({ db: conn.db, clock }, platform, { reportId: id, agencyId: agencyB })).toEqual({
      ok: false,
      reason: "not_allowed",
    });
  });
});

describe("agency scoping in queries", () => {
  it("shows each agency only its own reports, platform admins everything, residents nothing", async () => {
    const mine = await submit();
    const triaged = await submit(OUTSIDE);
    await reassignReport({ db: conn.db, clock }, platform, { reportId: triaged, agencyId: agencyB });

    const ids = async (actor: AuthenticatedActor) =>
      (await listReportsForScope(conn.db, agencyScopeFor(actor))).map((r) => r.id).sort();
    expect(await ids(officerA)).toEqual([mine]);
    expect(await ids(officerB)).toEqual([triaged]);
    expect(await ids(platform)).toEqual([mine, triaged].sort());
    expect(await ids(resident)).toEqual([]);

    expect(await findReportForScope(conn.db, mine, agencyScopeFor(officerB))).toBeNull();
    expect(await findReportForScope(conn.db, mine, agencyScopeFor(officerA))).toMatchObject({ id: mine, agencyName: "wf-agency-a" });
  });
});
