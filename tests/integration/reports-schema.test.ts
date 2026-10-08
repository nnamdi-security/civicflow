import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { categories, reportMedia, reports, statusEvents, users } from "@/db/schema";
import { resetReports, setupTestDb } from "./test-db";

let conn: Awaited<ReturnType<typeof setupTestDb>>;

beforeAll(async () => {
  conn = await setupTestDb();
});

afterEach(async () => {
  await resetReports(conn.db);
  await conn.db.delete(users);
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
