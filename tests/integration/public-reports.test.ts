import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  agencies,
  categories,
  escalations,
  jurisdictions,
  rateLimits,
  reportMedia,
  reports,
  statusEvents,
  users,
} from "@/db/schema";
import { fixedClock } from "@/domain/clock";
import { PostgresRateLimiter } from "@/server/rate-limit/postgres-rate-limiter";
import { findPublicReportByReference, listPubliclyOverdue } from "@/server/repositories/public-reports";
import {
  LOOKUP_RATE_RULE,
  lookupPublicReport,
  normalizeReference,
  type PublicLookupDeps,
} from "@/server/reports/public-lookup";
import { resetReports, setupTestDb } from "./test-db";

let conn: Awaited<ReturnType<typeof setupTestDb>>;
let clock: ReturnType<typeof fixedClock>;
let deps: PublicLookupDeps;
let agencyId: string;
let areaId: string;
let reporterId: string;
let categoryId: string;

const NOW = new Date("2026-03-20T09:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const PRIVATE_DESCRIPTION = "Pothole outside 12 Adeola Odeku St, call me on 08031234567";
const STAFF_NOTE = "Staff note: reporter is a repeat complainer";
const REPORTER_EMAIL = "secret.reporter@example.com";

beforeAll(async () => {
  conn = await setupTestDb();
});

beforeEach(async () => {
  clock = fixedClock(NOW);
  await wipe();
  deps = {
    db: conn.db,
    clock,
    limiter: new PostgresRateLimiter(conn.db, clock),
    secret: "s".repeat(32),
    showSla: true,
  };
  const [agency] = await conn.db.insert(agencies).values({ name: "pub-agency", type: "roads" }).returning();
  const [area] = await conn.db
    .insert(jurisdictions)
    .values({
      name: "pub-area",
      level: "lga",
      geom: sql`ST_Multi(ST_GeomFromText('POLYGON((100 0, 101 0, 101 1, 100 1, 100 0))', 4326))`,
    })
    .returning();
  const [user] = await conn.db.insert(users).values({ email: REPORTER_EMAIL }).returning();
  const [category] = await conn.db.select().from(categories).limit(1);
  if (!agency || !area || !user || !category) throw new Error("fixtures missing");
  agencyId = agency.id;
  areaId = area.id;
  reporterId = user.id;
  categoryId = category.id;
});

afterEach(wipe);

afterAll(async () => {
  await conn.pool.end();
});

async function wipe() {
  await resetReports(conn.db);
  await conn.db.delete(rateLimits);
  await conn.db.delete(users);
  await conn.db.delete(agencies).where(sql`name like 'pub-%'`);
  await conn.db.delete(jurisdictions).where(sql`name like 'pub-%'`);
}

let counter = 0;
async function report(overrides: Partial<typeof reports.$inferInsert> = {}) {
  counter += 1;
  const [row] = await conn.db
    .insert(reports)
    .values({
      reference: `CF-PUBLIC${counter}`.slice(0, 11).padEnd(11, "2"),
      categoryId,
      reporterId,
      description: PRIVATE_DESCRIPTION,
      location: sql`ST_SetSRID(ST_MakePoint(100.5, 0.5), 4326)::geography` as unknown as string,
      idempotencyKey: crypto.randomUUID(),
      status: "routed",
      agencyId,
      jurisdictionId: areaId,
      routedAt: new Date(NOW.getTime() - 10 * DAY),
      slaCycle: 1,
      // Required by the database whenever a timer is running ("reports_running_timer_has_start").
      slaStartedAt: new Date(NOW.getTime() - 10 * DAY),
      ...overrides,
    })
    .returning();
  if (!row) throw new Error("report not created");
  return row;
}

describe("findPublicReportByReference", () => {
  it("returns only the allow-listed fields and none of the private data", async () => {
    const r = await report({ reference: "CF-PUBLICAA", ackDueAt: new Date(NOW.getTime() - DAY) });
    await conn.db.insert(reportMedia).values({ reportId: r.id, publicId: "pub/photo1", format: "jpg", width: 1, height: 1, bytes: 1, position: 0 });
    await conn.db.insert(statusEvents).values([
      { reportId: r.id, fromStatus: null, toStatus: "submitted", actorId: reporterId, createdAt: new Date(NOW.getTime() - 2000) },
      { reportId: r.id, fromStatus: "submitted", toStatus: "routed", reason: STAFF_NOTE, createdAt: new Date(NOW.getTime() - 1000) },
    ]);

    const found = await findPublicReportByReference(conn.db, "CF-PUBLICAA");
    expect(Object.keys(found ?? {}).sort()).toEqual(
      ["ackDueAt", "ackLevel", "agencyName", "areaName", "categoryName", "createdAt", "reference", "resolveDueAt", "resolveLevel", "status", "timeline"].sort(),
    );
    expect(found).toMatchObject({ agencyName: "pub-agency", areaName: "pub-area", status: "routed" });
    expect(found?.timeline.map((t) => t.toStatus)).toEqual(["submitted", "routed"]);

    const text = JSON.stringify(found);
    for (const secret of [PRIVATE_DESCRIPTION, "Adeola", "08031234567", "100.5", REPORTER_EMAIL, reporterId, "pub/photo1", STAFF_NOTE, r.id]) {
      expect(text).not.toContain(secret);
    }
    expect(Object.keys(found?.timeline[0] ?? {}).sort()).toEqual(["createdAt", "toStatus"]);
  });

  it("returns null for an unknown reference", async () => {
    expect(await findPublicReportByReference(conn.db, "CF-NOSUCHAB")).toBeNull();
  });

  it("reports no agency or area for an unrouted report outside coverage", async () => {
    await report({ reference: "CF-PUBLICBB", status: "submitted", agencyId: null, jurisdictionId: null, routedAt: null });
    expect(await findPublicReportByReference(conn.db, "CF-PUBLICBB")).toMatchObject({ agencyName: null, areaName: null });
  });
});

describe("lookupPublicReport", () => {
  it("normalizes what people type", () => {
    expect(normalizeReference("cf-7k3m9qxd")).toBe("CF-7K3M9QXD");
    expect(normalizeReference("  CF 7K3M 9QXD ")).toBe("CF-7K3M9QXD");
    expect(normalizeReference("cf7k3m9qxd")).toBe("CF-7K3M9QXD");
  });

  it("finds a report and returns the public view with SLA details only when allowed", async () => {
    await report({ reference: "CF-7K3M9QXD", resolveDueAt: new Date(NOW.getTime() + DAY) });
    const withSla = await lookupPublicReport(deps, "203.0.113.5", "cf 7k3m 9qxd");
    expect(withSla).toMatchObject({ ok: true, report: { reference: "CF-7K3M9QXD", areaName: "pub-area" } });
    expect(withSla.ok && withSla.report.sla).not.toBeNull();

    const without = await lookupPublicReport({ ...deps, showSla: false }, "203.0.113.5", "CF-7K3M9QXD");
    expect(without.ok && without.report.sla).toBeNull();
    expect(JSON.stringify(without)).not.toContain(PRIVATE_DESCRIPTION);
  });

  it("answers not_found alike for unknown, malformed and non-string references", async () => {
    for (const input of ["CF-NOSUCHAB", "banana", "", "CF-0OIL1ZZZ", 42, null, "x".repeat(200)]) {
      expect(await lookupPublicReport(deps, "203.0.113.5", input)).toEqual({ ok: false, reason: "not_found" });
    }
  });

  it("rate limits per client, without storing the raw address", async () => {
    for (let i = 0; i < LOOKUP_RATE_RULE.limit; i++) {
      expect(await lookupPublicReport(deps, "203.0.113.5", "CF-NOSUCHAB")).toEqual({ ok: false, reason: "not_found" });
    }
    expect(await lookupPublicReport(deps, "203.0.113.5", "CF-NOSUCHAB")).toEqual({ ok: false, reason: "rate_limited" });
    // A different client is unaffected, and the limit lifts when the window rolls over.
    expect(await lookupPublicReport(deps, "198.51.100.7", "CF-NOSUCHAB")).toEqual({ ok: false, reason: "not_found" });
    clock.advance(LOOKUP_RATE_RULE.windowMs);
    expect(await lookupPublicReport(deps, "203.0.113.5", "CF-NOSUCHAB")).toEqual({ ok: false, reason: "not_found" });

    const keys = (await conn.db.select({ key: rateLimits.key }).from(rateLimits)).map((r) => r.key).join(" ");
    expect(keys).not.toContain("203.0.113.5");
    expect(keys).not.toContain("198.51.100.7");
  });

  it("limits even valid lookups, so a correct code cannot be hammered either", async () => {
    await report({ reference: "CF-7K3M9QXD" });
    for (let i = 0; i < LOOKUP_RATE_RULE.limit; i++) await lookupPublicReport(deps, "203.0.113.5", "CF-7K3M9QXD");
    expect(await lookupPublicReport(deps, "203.0.113.5", "CF-7K3M9QXD")).toEqual({ ok: false, reason: "rate_limited" });
  });
});

describe("listPubliclyOverdue", () => {
  const level3 = (reportId: string, timer: "acknowledge" | "resolve", slaCycle = 1) =>
    conn.db.insert(escalations).values({ reportId, timer, level: 3, slaCycle });

  it("lists only reports at level 3 with a running timer, longest overdue first, with allowed fields only", async () => {
    const older = await report({ reference: "CF-OVERDUE1", ackDueAt: new Date(NOW.getTime() - 9 * DAY) });
    const newer = await report({ reference: "CF-OVERDUE2", ackDueAt: null, resolveDueAt: new Date(NOW.getTime() - 5 * DAY) });
    const both = await report({
      reference: "CF-OVERDUE3",
      ackDueAt: new Date(NOW.getTime() - 4 * DAY),
      resolveDueAt: new Date(NOW.getTime() - 7 * DAY),
    });
    await level3(older.id, "acknowledge");
    await level3(newer.id, "resolve");
    await level3(both.id, "acknowledge");
    await level3(both.id, "resolve");

    const items = await listPubliclyOverdue(conn.db);
    expect(items.map((i) => i.reference)).toEqual(["CF-OVERDUE1", "CF-OVERDUE3", "CF-OVERDUE2"]);
    expect(items[1]?.overdueSince).toEqual(new Date(NOW.getTime() - 7 * DAY)); // earliest of the two timers
    expect(items[0]).toEqual({
      reference: "CF-OVERDUE1",
      categoryName: expect.any(String),
      agencyName: "pub-agency",
      areaName: "pub-area",
      overdueSince: new Date(NOW.getTime() - 9 * DAY),
    });
    const text = JSON.stringify(items);
    for (const secret of [PRIVATE_DESCRIPTION, "08031234567", REPORTER_EMAIL, reporterId]) expect(text).not.toContain(secret);
  });

  it("leaves out reports below level 3, closed reports, and escalations from an old cycle", async () => {
    const level2 = await report({ reference: "CF-LEVELTWO", ackDueAt: new Date(NOW.getTime() - 2 * DAY) });
    await conn.db.insert(escalations).values({ reportId: level2.id, timer: "acknowledge", level: 2, slaCycle: 1 });

    const closed = await report({ reference: "CF-CLOSEDAB", status: "confirmed", ackDueAt: null, resolveDueAt: null });
    await level3(closed.id, "acknowledge");

    const restarted = await report({ reference: "CF-RESTARTD", ackDueAt: new Date(NOW.getTime() + DAY), slaCycle: 2 });
    await level3(restarted.id, "acknowledge", 1);

    expect(await listPubliclyOverdue(conn.db)).toEqual([]);
  });

  it("honours the limit", async () => {
    for (const ref of ["CF-LIMITAAA", "CF-LIMITBBB", "CF-LIMITCCC"]) {
      const r = await report({ reference: ref, ackDueAt: new Date(NOW.getTime() - DAY) });
      await level3(r.id, "acknowledge");
    }
    expect(await listPubliclyOverdue(conn.db, 2)).toHaveLength(2);
  });
});

