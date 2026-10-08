import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { agencies, agencyJurisdictions, categories, jurisdictions, reports, users } from "@/db/schema";
import { pickAgency } from "@/domain/routing";
import { findRoutingInput } from "@/server/repositories/routing";
import { resetReports, setupTestDb } from "./test-db";

let conn: Awaited<ReturnType<typeof setupTestDb>>;

const wkt = (value: string) => sql`ST_Multi(ST_GeomFromText(${value}, 4326))`;
const box = (x1: number, y1: number, x2: number, y2: number) =>
  `POLYGON((${x1} ${y1}, ${x2} ${y1}, ${x2} ${y2}, ${x1} ${y2}, ${x1} ${y1}))`;

// Test geography, far from the dev seed: state 0..10, LGAs left 0..5 and right 5..10 (shared edge at x=5).
const NAMES = ["rt-state", "rt-left", "rt-right", "rt-isolated"];
const AGENCY_PREFIX = "rt-agency-";

interface Fixture {
  stateId: string;
  leftId: string;
  rightId: string;
}
let fx: Fixture;

beforeAll(async () => {
  conn = await setupTestDb();
});

afterEach(async () => {
  await resetReports(conn.db);
  await conn.db.delete(users);
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await conn.pool.end();
});

async function cleanup() {
  const rows = await conn.db.select({ id: agencies.id, name: agencies.name }).from(agencies);
  const ids = rows.filter((a) => a.name.startsWith(AGENCY_PREFIX)).map((a) => a.id);
  if (ids.length > 0) await conn.db.delete(agencies).where(inArray(agencies.id, ids));
  await conn.db.execute(sql`delete from jurisdictions where name like 'rt-%' and parent_id is not null`);
  await conn.db.execute(sql`delete from jurisdictions where name like 'rt-%'`);
}

async function jurisdiction(name: string, level: "state" | "lga", polygon: string, parentId?: string) {
  const [row] = await conn.db
    .insert(jurisdictions)
    .values({ name, level, parentId: parentId ?? null, geom: wkt(polygon) })
    .returning({ id: jurisdictions.id });
  if (!row) throw new Error("jurisdiction not created");
  return row.id;
}

async function agency(name: string, type: "roads" | "water", coverage: { jurisdictionId: string; priority?: number }[]) {
  const [row] = await conn.db.insert(agencies).values({ name: AGENCY_PREFIX + name, type }).returning({ id: agencies.id });
  if (!row) throw new Error("agency not created");
  await conn.db
    .insert(agencyJurisdictions)
    .values(coverage.map((c) => ({ agencyId: row.id, jurisdictionId: c.jurisdictionId, priority: c.priority ?? 0 })));
  return row.id;
}

async function reportAt(lon: number, lat: number, categorySlug = "roads") {
  const [user] = await conn.db.insert(users).values({ email: `rt${Math.random()}@example.com` }).returning();
  const [category] = await conn.db.select().from(categories).where(eq(categories.slug, categorySlug));
  if (!user || !category) throw new Error("fixtures missing");
  const [report] = await conn.db
    .insert(reports)
    .values({
      reference: `CF-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
      categoryId: category.id,
      reporterId: user.id,
      description: "A large pothole on the main road",
      location: sql`ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography` as unknown as string,
      idempotencyKey: crypto.randomUUID(),
    })
    .returning({ id: reports.id });
  if (!report) throw new Error("report not created");
  return report.id;
}

async function geography(): Promise<Fixture> {
  await cleanup();
  const stateId = await jurisdiction(NAMES[0]!, "state", box(100, 0, 110, 10));
  const leftId = await jurisdiction(NAMES[1]!, "lga", box(100, 0, 105, 10), stateId);
  const rightId = await jurisdiction(NAMES[2]!, "lga", box(105, 0, 110, 10), stateId);
  return { stateId, leftId, rightId };
}

describe("findRoutingInput", () => {
  it("returns no candidates for a point outside every jurisdiction", async () => {
    fx = await geography();
    await agency("state-roads", "roads", [{ jurisdictionId: fx.stateId }]);
    const input = await findRoutingInput(conn.db, await reportAt(50, 5));
    expect(input).toEqual({ candidates: [], boundary: false });
    expect(pickAgency(input)).toEqual({ kind: "triage" });
  });

  it("finds an agency covering the LGA the point is in", async () => {
    fx = await geography();
    const left = await agency("left-roads", "roads", [{ jurisdictionId: fx.leftId }]);
    await agency("right-roads", "roads", [{ jurisdictionId: fx.rightId }]);
    const input = await findRoutingInput(conn.db, await reportAt(102, 5));
    expect(input.boundary).toBe(false);
    expect(input.candidates).toEqual([
      { agencyId: left, jurisdictionId: fx.leftId, hops: 0, priority: 0 },
    ]);
  });

  it("falls back to the state agency when the LGA has none, counting one hop", async () => {
    fx = await geography();
    const state = await agency("state-roads", "roads", [{ jurisdictionId: fx.stateId }]);
    const input = await findRoutingInput(conn.db, await reportAt(102, 5));
    expect(input.candidates).toEqual([{ agencyId: state, jurisdictionId: fx.stateId, hops: 1, priority: 0 }]);
    expect(pickAgency(input)).toMatchObject({ kind: "agency", agencyId: state, viaParent: true });
  });

  it("prefers the LGA agency over the state agency", async () => {
    fx = await geography();
    await agency("state-roads", "roads", [{ jurisdictionId: fx.stateId, priority: 0 }]);
    const left = await agency("left-roads", "roads", [{ jurisdictionId: fx.leftId, priority: 9 }]);
    expect(pickAgency(await findRoutingInput(conn.db, await reportAt(102, 5)))).toMatchObject({
      agencyId: left,
      viaParent: false,
    });
  });

  it("ignores agencies of a different type than the category", async () => {
    fx = await geography();
    await agency("left-water", "water", [{ jurisdictionId: fx.leftId }]);
    const input = await findRoutingInput(conn.db, await reportAt(102, 5, "roads"));
    expect(input.candidates).toEqual([]);
    const water = await findRoutingInput(conn.db, await reportAt(102, 5, "water"));
    expect(water.candidates).toHaveLength(1);
  });

  it("flags a point on the shared edge of two LGAs as a boundary and still picks deterministically", async () => {
    fx = await geography();
    const left = await agency("left-roads", "roads", [{ jurisdictionId: fx.leftId }]);
    const right = await agency("right-roads", "roads", [{ jurisdictionId: fx.rightId }]);
    const input = await findRoutingInput(conn.db, await reportAt(105, 5));
    expect(input.boundary).toBe(true);
    expect(input.candidates.map((c) => c.agencyId).sort()).toEqual([left, right].sort());
    const lowerJurisdiction = [fx.leftId, fx.rightId].sort()[0];
    expect(pickAgency(input)).toMatchObject({ jurisdictionId: lowerJurisdiction, boundary: true });
  });

  it("lets priority choose between two agencies in the same jurisdiction", async () => {
    fx = await geography();
    await agency("slow", "roads", [{ jurisdictionId: fx.leftId, priority: 5 }]);
    const fast = await agency("fast", "roads", [{ jurisdictionId: fx.leftId, priority: 1 }]);
    expect(pickAgency(await findRoutingInput(conn.db, await reportAt(102, 5)))).toMatchObject({ agencyId: fast });
  });
});
