import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { agencies, assignments, categories, escalations, reportMedia, reports, slaPolicies, statusEvents, users } from "@/db/schema";
import { resetReports, setupTestDb } from "./test-db";

let conn: Awaited<ReturnType<typeof setupTestDb>>;

beforeAll(async () => {
  conn = await setupTestDb();
});

afterEach(async () => {
  await resetReports(conn.db);
  await conn.db.delete(users);
  await conn.db.delete(agencies).where(eq(agencies.name, "Schema test agency"));
});

afterAll(async () => {
  await conn.pool.end();
});

async function createReport(overrides: Partial<typeof reports.$inferInsert> = {}) {
  const [user] = await conn.db.insert(users).values({ email: `r${Math.random()}@example.com` }).returning();
  const [category] = await conn.db.select().from(categories).limit(1);
  if (!user || !category) throw new Error("fixtures missing");
  const [report] = await conn.db
    .insert(reports)
    .values({
      reference: `CF-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
      categoryId: category.id,
      reporterId: user.id,
      description: "A large pothole on the main road",
      location: sql`ST_SetSRID(ST_MakePoint(3.3792, 6.5244), 4326)::geography` as unknown as string,
      idempotencyKey: crypto.randomUUID(),
      ...overrides,
    })
    .returning();
  if (!report) throw new Error("report not created");
  return { report, user, category };
}

describe("categories", () => {
  it("ships the six launch categories", async () => {
    const rows = await conn.db.select({ slug: categories.slug }).from(categories);
    expect(rows.map((r) => r.slug).sort()).toEqual(
      ["drainage", "power", "roads", "streetlights", "waste", "water"],
    );
  });
});

describe("reports", () => {
  it("defaults to the submitted status", async () => {
    const { report } = await createReport();
    expect(report.status).toBe("submitted");
  });

  it("stores the point in lon/lat order", async () => {
    const { report } = await createReport();
    const result = await conn.db.execute<{ lon: number; lat: number }>(
      sql`select ST_X(location::geometry) as lon, ST_Y(location::geometry) as lat from reports where id = ${report.id}`,
    );
    expect(result.rows[0]?.lon).toBeCloseTo(3.3792, 4);
    expect(result.rows[0]?.lat).toBeCloseTo(6.5244, 4);
  });

  it("has a GiST index on location", async () => {
    const result = await conn.db.execute<{ indexdef: string }>(
      sql`select indexdef from pg_indexes where indexname = 'reports_location_gist'`,
    );
    expect(result.rows[0]?.indexdef).toContain("USING gist");
  });

  it("rejects too-short and too-long descriptions", async () => {
    await expect(createReport({ description: "short" })).rejects.toThrow();
    await expect(createReport({ description: "x".repeat(1001) })).rejects.toThrow();
  });

  it("rejects a repeated idempotency key for the same reporter", async () => {
    const { report, user, category } = await createReport();
    await expect(
      conn.db.insert(reports).values({
        reference: "CF-DUPLICAT",
        categoryId: category.id,
        reporterId: user.id,
        description: "Another long enough description",
        location: sql`ST_SetSRID(ST_MakePoint(3.4, 6.5), 4326)::geography` as unknown as string,
        idempotencyKey: report.idempotencyKey,
      }),
    ).rejects.toThrow();
  });
});

describe("report_media", () => {
  it("allows at most positions 0 to 2 and one photo per position", async () => {
    const { report } = await createReport();
    const photo = (position: number, publicId: string) => ({
      reportId: report.id,
      publicId,
      format: "jpg",
      width: 800,
      height: 600,
      bytes: 1000,
      position,
    });
    await conn.db.insert(reportMedia).values(photo(0, "a"));
    await expect(conn.db.insert(reportMedia).values(photo(0, "b"))).rejects.toThrow();
    await expect(conn.db.insert(reportMedia).values(photo(3, "c"))).rejects.toThrow();
  });
});

describe("status_events", () => {
  it("accepts inserts but rejects updates and deletes", async () => {
    const { report } = await createReport();
    const [event] = await conn.db
      .insert(statusEvents)
      .values({ reportId: report.id, fromStatus: null, toStatus: "submitted" })
      .returning();
    if (!event) throw new Error("event not created");

    await expect(
      conn.db.update(statusEvents).set({ reason: "edited" }).where(eq(statusEvents.id, event.id)),
    ).rejects.toThrow();
    await expect(
      conn.db.delete(statusEvents).where(eq(statusEvents.id, event.id)),
    ).rejects.toThrow();
  });
});

async function createAgency() {
  const [agency] = await conn.db.insert(agencies).values({ name: "Schema test agency", type: "roads" }).returning();
  if (!agency) throw new Error("agency not created");
  return agency;
}

describe("routed reports need an agency", () => {
  it("rejects a routed report with no agency", async () => {
    const { report } = await createReport();
    await expect(
      conn.db.update(reports).set({ status: "routed" }).where(eq(reports.id, report.id)),
    ).rejects.toThrow();
  });

  it("accepts a routed report with an agency, and a rejected one without", async () => {
    const agency = await createAgency();
    const routed = await createReport({ status: "routed", agencyId: agency.id, routedAt: new Date() });
    expect(routed.report.agencyId).toBe(agency.id);
    const rejected = await createReport({ status: "rejected" });
    expect(rejected.report.agencyId).toBeNull();
  });
});

describe("assignments", () => {
  it("accepts inserts but rejects updates and deletes", async () => {
    const agency = await createAgency();
    const { report } = await createReport();
    const [row] = await conn.db
      .insert(assignments)
      .values({ reportId: report.id, agencyId: agency.id, reason: "auto-routed" })
      .returning();
    if (!row) throw new Error("assignment not created");

    await expect(
      conn.db.update(assignments).set({ reason: "edited" }).where(eq(assignments.id, row.id)),
    ).rejects.toThrow();
    await expect(conn.db.delete(assignments).where(eq(assignments.id, row.id))).rejects.toThrow();
  });
});

describe("sla_policies", () => {
  it("ships the provisional placeholder policy for every category (docs/sla-and-escalation.md)", async () => {
    const rows = await conn.db
      .select({ slug: categories.slug, ack: slaPolicies.ackMinutes, resolve: slaPolicies.resolveMinutes })
      .from(slaPolicies)
      .innerJoin(categories, eq(categories.id, slaPolicies.categoryId));
    const hours = (h: number) => h * 60;
    const days = (d: number) => d * 24 * 60;
    expect(Object.fromEntries(rows.map((r) => [r.slug, [r.ack, r.resolve]]))).toEqual({
      roads: [hours(24), days(14)],
      drainage: [hours(24), days(7)],
      water: [hours(12), days(3)],
      power: [hours(12), days(3)],
      waste: [hours(24), days(5)],
      streetlights: [hours(48), days(14)],
    });
  });

  it("rejects non-positive durations", async () => {
    const [category] = await conn.db.select().from(categories).limit(1);
    if (!category) throw new Error("category missing");
    await expect(
      conn.db.update(slaPolicies).set({ ackMinutes: 0 }).where(eq(slaPolicies.categoryId, category.id)),
    ).rejects.toThrow();
  });
});

describe("escalations", () => {
  async function insertEscalation(reportId: string, overrides: Partial<typeof escalations.$inferInsert> = {}) {
    const [row] = await conn.db
      .insert(escalations)
      .values({ reportId, timer: "acknowledge", level: 1, slaCycle: 1, ...overrides })
      .returning();
    if (!row) throw new Error("escalation not created");
    return row;
  }

  it("accepts inserts but rejects updates and deletes", async () => {
    const { report } = await createReport();
    const row = await insertEscalation(report.id);
    await expect(
      conn.db.update(escalations).set({ level: 2 }).where(eq(escalations.id, row.id)),
    ).rejects.toThrow();
    await expect(conn.db.delete(escalations).where(eq(escalations.id, row.id))).rejects.toThrow();
  });

  it("allows each level once per report, timer and cycle, but again in a new cycle", async () => {
    const { report } = await createReport();
    await insertEscalation(report.id);
    await expect(insertEscalation(report.id)).rejects.toThrow();
    await insertEscalation(report.id, { slaCycle: 2 });
    await insertEscalation(report.id, { timer: "resolve" });
    await insertEscalation(report.id, { level: 2 });
  });

  it("rejects levels outside 1 to 3", async () => {
    const { report } = await createReport();
    await expect(insertEscalation(report.id, { level: 0 })).rejects.toThrow();
    await expect(insertEscalation(report.id, { level: 4 })).rejects.toThrow();
  });
});

describe("report SLA columns", () => {
  it("start with no running timers in cycle 0", async () => {
    const { report } = await createReport();
    expect(report).toMatchObject({ ackDueAt: null, resolveDueAt: null, slaCycle: 0 });
  });
});
