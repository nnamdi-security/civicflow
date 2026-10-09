/**
 * Integration tests for the boundary importer (Phase 8 Part B). They run the real importer
 * against a real PostgreSQL + PostGIS database with small, invented GeoJSON files.
 *
 * What these tests protect, in plain terms:
 *   1. a good file loads states and LGAs and links each LGA to the right state;
 *   2. a file with ANY problem saves NOTHING (all-or-nothing);
 *   3. running the import twice never creates duplicates;
 *   4. a dry run never saves anything;
 *   5. the importer never deletes or alters unrelated data;
 *   6. imported boundaries really do drive report routing.
 *
 * All place names start with "bnd-" so clean-up can find them. Coordinates are in the north-east of
 * Nigeria, away from the other tests' sample areas.
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { agencies, agencyJurisdictions, categories, jurisdictions, reports, users } from "@/db/schema";
import { importBoundaryFile } from "@/server/boundaries/import";
import { pickAgency } from "@/domain/routing";
import { findRoutingInput } from "@/server/repositories/routing";
import { resetReports, setupTestDb } from "./test-db";

let conn: Awaited<ReturnType<typeof setupTestDb>>;

beforeAll(async () => {
  conn = await setupTestDb();
});

beforeEach(cleanup);
afterEach(cleanup);

afterAll(async () => {
  await conn.pool.end();
});

/** Removes everything these tests create. Children (LGAs) go before parents (states). */
async function cleanup() {
  await resetReports(conn.db);
  await conn.db.delete(users);
  await conn.db.delete(agencyJurisdictions);
  await conn.db.delete(agencies).where(sql`name like 'bnd-%'`);
  await conn.db.delete(jurisdictions).where(sql`name like 'bnd-%' and level = 'lga'`);
  await conn.db.delete(jurisdictions).where(sql`name like 'bnd-%'`);
}

// ---- Helpers that build small GeoJSON files in memory ----------------------------------------

/** A closed square ring. [longitude, latitude] order. */
const box = (west: number, south: number, east: number, north: number): number[][][] => [
  [[west, south], [east, south], [east, north], [west, north], [west, south]],
];
const feature = (properties: Record<string, string>, coordinates: number[][][]) => ({
  type: "Feature",
  properties,
  geometry: { type: "Polygon", coordinates },
});
const collection = (...features: unknown[]) => ({ type: "FeatureCollection", features });

// Two neighbouring "states" side by side (west one covers lon 11-12, east one covers lon 12-13),
// and "LGAs" inside them. All between latitude 11 and 13.
const states = () =>
  collection(
    feature({ NAME: "bnd-west-state" }, box(11, 11, 12, 13)),
    feature({ NAME: "bnd-east-state" }, box(12, 11, 13, 13)),
  );
const lgas = () =>
  collection(
    feature({ NAME: "bnd-lga-one", STATE: "bnd-west-state" }, box(11.2, 11.2, 11.8, 11.8)),
    feature({ NAME: "bnd-lga-two", STATE: "bnd-east-state" }, box(12.2, 11.2, 12.8, 11.8)),
  );

const asStates = { level: "state", nameField: "NAME", dryRun: false } as const;
const asLgas = { level: "lga", nameField: "NAME", parentField: "STATE", dryRun: false } as const;

const rows = () => conn.db.select().from(jurisdictions).where(sql`name like 'bnd-%'`);

describe("importing states then LGAs", () => {
  it("adds the states, then the LGAs linked to the right state by name", async () => {
    expect(await importBoundaryFile(conn.db, states(), asStates)).toEqual({ status: "imported", summary: { inserted: 2, updated: 0 } });
    expect(await importBoundaryFile(conn.db, lgas(), asLgas)).toEqual({ status: "imported", summary: { inserted: 2, updated: 0 } });

    const all = await rows();
    const idOf = (name: string) => all.find((r) => r.name === name)?.id;
    expect(all.map((r) => [r.name, r.level]).sort()).toEqual([
      ["bnd-east-state", "state"],
      ["bnd-lga-one", "lga"],
      ["bnd-lga-two", "lga"],
      ["bnd-west-state", "state"],
    ]);
    // Each LGA points at its own state, and states have no parent.
    expect(all.find((r) => r.name === "bnd-lga-one")?.parentId).toBe(idOf("bnd-west-state"));
    expect(all.find((r) => r.name === "bnd-lga-two")?.parentId).toBe(idOf("bnd-east-state"));
    expect(all.find((r) => r.name === "bnd-west-state")?.parentId).toBeNull();
  });

  it("stores real shapes: a point inside is covered, a point outside is not", async () => {
    await importBoundaryFile(conn.db, states(), asStates);
    const covers = async (lon: number, lat: number) =>
      (await conn.db.execute<{ hit: boolean }>(sql`
        select exists (
          select 1 from jurisdictions
          where name = 'bnd-west-state' and ST_Covers(geom, ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326))
        ) as hit`)).rows[0]?.hit;
    expect(await covers(11.5, 12)).toBe(true);
    expect(await covers(12.5, 12)).toBe(false); // that is in the east state
  });

  it("works out each LGA's state by LOCATION when the file does not name it", async () => {
    await importBoundaryFile(conn.db, states(), asStates);
    const withoutParent = collection(feature({ NAME: "bnd-lga-one" }, box(11.2, 11.2, 11.8, 11.8)));
    expect(await importBoundaryFile(conn.db, withoutParent, { level: "lga", nameField: "NAME", dryRun: false })).toMatchObject({
      status: "imported",
    });
    const all = await rows();
    expect(all.find((r) => r.name === "bnd-lga-one")?.parentId).toBe(all.find((r) => r.name === "bnd-west-state")?.id);
  });

  it("allows the same LGA name under two different states", async () => {
    await importBoundaryFile(conn.db, states(), asStates);
    const same = collection(
      feature({ NAME: "bnd-twin", STATE: "bnd-west-state" }, box(11.2, 11.2, 11.8, 11.8)),
      feature({ NAME: "bnd-twin", STATE: "bnd-east-state" }, box(12.2, 11.2, 12.8, 11.8)),
    );
    expect(await importBoundaryFile(conn.db, same, asLgas)).toMatchObject({ status: "imported", summary: { inserted: 2 } });
    expect((await rows()).filter((r) => r.name === "bnd-twin")).toHaveLength(2);
  });
});

describe("running it again", () => {
  it("updates the same places instead of duplicating them, and really changes the shape", async () => {
    await importBoundaryFile(conn.db, states(), asStates);
    const before = (await rows()).length;

    // The same two states, but the west one is now bigger (it reaches latitude 13.5).
    const redrawn = collection(
      feature({ NAME: "bnd-west-state" }, box(11, 11, 12, 13.5)),
      feature({ NAME: "bnd-east-state" }, box(12, 11, 13, 13)),
    );
    expect(await importBoundaryFile(conn.db, redrawn, asStates)).toEqual({ status: "imported", summary: { inserted: 0, updated: 2 } });
    expect(await rows()).toHaveLength(before); // no duplicates

    const area = await conn.db.execute<{ top: number }>(
      sql`select ST_YMax(geom) as top from jurisdictions where name = 'bnd-west-state'`,
    );
    expect(Number(area.rows[0]?.top)).toBeCloseTo(13.5, 5);
  });

  it("matches existing places ignoring capital letters, and keeps the stored name", async () => {
    await importBoundaryFile(conn.db, states(), asStates);
    const shouting = collection(feature({ NAME: "BND-WEST-STATE" }, box(11, 11, 12, 13)));
    expect(await importBoundaryFile(conn.db, shouting, asStates)).toMatchObject({ summary: { inserted: 0, updated: 1 } });
    expect((await rows()).map((r) => r.name)).toContain("bnd-west-state");
    expect((await rows()).filter((r) => r.level === "state")).toHaveLength(2);
  });
});

describe("a dry run", () => {
  it("reports what would happen and saves nothing", async () => {
    const result = await importBoundaryFile(conn.db, states(), { ...asStates, dryRun: true });
    expect(result).toEqual({ status: "dry_run", summary: { inserted: 2, updated: 0 } });
    expect(await rows()).toHaveLength(0);
  });

  it("counts updates correctly for places that already exist, and still changes nothing", async () => {
    await importBoundaryFile(conn.db, states(), asStates);
    const bigger = collection(feature({ NAME: "bnd-west-state" }, box(11, 11, 12, 14)));
    expect(await importBoundaryFile(conn.db, bigger, { ...asStates, dryRun: true })).toEqual({
      status: "dry_run",
      summary: { inserted: 0, updated: 1 },
    });
    const top = await conn.db.execute<{ top: number }>(sql`select ST_YMax(geom) as top from jurisdictions where name = 'bnd-west-state'`);
    expect(Number(top.rows[0]?.top)).toBeCloseTo(13, 5); // unchanged
  });
});

describe("all-or-nothing", () => {
  it("saves nothing from a file that fails the basic checks", async () => {
    const bad = collection(feature({ NAME: "bnd-fine" }, box(11, 11, 12, 13)), feature({}, box(12, 11, 13, 13)));
    const result = await importBoundaryFile(conn.db, bad, asStates);
    expect(result).toEqual({ status: "invalid_file", issues: [{ index: 1, code: "name_missing" }] });
    expect(await rows()).toHaveLength(0); // even the good feature was not saved
  });

  it("saves nothing when one LGA names a state that does not exist", async () => {
    await importBoundaryFile(conn.db, states(), asStates);
    const mixed = collection(
      feature({ NAME: "bnd-lga-good", STATE: "bnd-west-state" }, box(11.2, 11.2, 11.8, 11.8)),
      feature({ NAME: "bnd-lga-lost", STATE: "bnd-no-such-state" }, box(12.2, 11.2, 12.8, 11.8)),
    );
    expect(await importBoundaryFile(conn.db, mixed, asLgas)).toEqual({
      status: "rejected",
      problems: [{ index: 1, name: "bnd-lga-lost", code: "parent_not_found" }],
    });
    expect((await rows()).filter((r) => r.level === "lga")).toHaveLength(0);
  });

  it("rejects an LGA that no state contains, and one that sits in two overlapping states", async () => {
    await importBoundaryFile(conn.db, states(), asStates);
    const nowhere = collection(feature({ NAME: "bnd-island" }, box(11.2, 5.2, 11.8, 5.8))); // far south of both states
    expect(await importBoundaryFile(conn.db, nowhere, { level: "lga", nameField: "NAME", dryRun: false })).toMatchObject({
      status: "rejected",
      problems: [{ code: "parent_not_found_by_location" }],
    });

    // Add a third state that OVERLAPS the west state, so a point there is in two states at once.
    await importBoundaryFile(conn.db, collection(feature({ NAME: "bnd-overlap-state" }, box(11.1, 11.1, 11.9, 12.9))), asStates);
    const doubled = collection(feature({ NAME: "bnd-doubled" }, box(11.3, 11.3, 11.7, 11.7)));
    expect(await importBoundaryFile(conn.db, doubled, { level: "lga", nameField: "NAME", dryRun: false })).toMatchObject({
      status: "rejected",
      problems: [{ code: "parent_ambiguous_by_location" }],
    });
  });

  it("refuses a second state with the same name, ignoring capital letters (the database identity rule)", async () => {
    // A place is identified by level + name + parent. Two states have no parent, so their names must differ.
    await importBoundaryFile(conn.db, states(), asStates);
    await expect(
      conn.db.insert(jurisdictions).values({
        name: "BND-WEST-STATE",
        level: "state",
        geom: sql`ST_Multi(ST_GeomFromText('POLYGON((11 11, 12 11, 12 13, 11 13, 11 11))', 4326))`,
      }),
    ).rejects.toThrow();
  });
});

describe("geometry repair and refusal", () => {
  const isValid = async (name: string) =>
    (await conn.db.execute<{ ok: boolean }>(sql`select ST_IsValid(geom) as ok from jurisdictions where name = ${name}`)).rows[0]?.ok;

  it("repairs a bow-tie (a ring that crosses itself) into a valid shape", async () => {
    // Corners in the order SW, NE, SE, NW make the outline cross itself in the middle.
    const bowTie = collection({
      type: "Feature",
      properties: { NAME: "bnd-bowtie" },
      geometry: { type: "Polygon", coordinates: [[[11, 11], [12, 12], [12, 11], [11, 12], [11, 11]]] },
    });
    expect(await importBoundaryFile(conn.db, bowTie, asStates)).toMatchObject({ status: "imported" });
    expect(await isValid("bnd-bowtie")).toBe(true);
  });

  it("refuses a flat shape with no area, saving nothing", async () => {
    // Three points on one straight line enclose no area at all.
    const flat = collection({
      type: "Feature",
      properties: { NAME: "bnd-flat" },
      geometry: { type: "Polygon", coordinates: [[[11, 11], [12, 11], [13, 11], [11, 11]]] },
    });
    expect(await importBoundaryFile(conn.db, flat, asStates)).toMatchObject({
      status: "rejected",
      problems: [{ name: "bnd-flat", code: "geometry_invalid" }],
    });
    expect(await rows()).toHaveLength(0);
  });

  it("stores MultiPolygon files (a state with an island) as one place", async () => {
    const withIsland = collection({
      type: "Feature",
      properties: { NAME: "bnd-archipelago" },
      geometry: { type: "MultiPolygon", coordinates: [box(11, 11, 11.5, 11.5), box(12, 12, 12.5, 12.5)] },
    });
    expect(await importBoundaryFile(conn.db, withIsland, asStates)).toMatchObject({ summary: { inserted: 1 } });
    const parts = await conn.db.execute<{ n: number }>(sql`select ST_NumGeometries(geom) as n from jurisdictions where name = 'bnd-archipelago'`);
    expect(Number(parts.rows[0]?.n)).toBe(2);
  });
});

describe("what the importer leaves alone", () => {
  it("never deletes or changes unrelated places, agencies or coverage", async () => {
    const [other] = await conn.db
      .insert(jurisdictions)
      .values({ name: "bnd-unrelated", level: "state", geom: sql`ST_Multi(ST_GeomFromText('POLYGON((11 5, 12 5, 12 6, 11 6, 11 5))', 4326))` })
      .returning();
    const [agency] = await conn.db.insert(agencies).values({ name: "bnd-agency", type: "roads" }).returning();
    await conn.db.insert(agencyJurisdictions).values({ agencyId: agency?.id ?? "", jurisdictionId: other?.id ?? "", priority: 4 });

    await importBoundaryFile(conn.db, states(), asStates);

    expect((await rows()).map((r) => r.name)).toContain("bnd-unrelated");
    const coverage = await conn.db.select().from(agencyJurisdictions).where(eq(agencyJurisdictions.agencyId, agency?.id ?? ""));
    expect(coverage).toEqual([{ agencyId: agency?.id, jurisdictionId: other?.id, priority: 4 }]);
  });
});

describe("imported boundaries drive routing", () => {
  it("routes a report inside an imported LGA to the agency covering its state (parent fallback)", async () => {
    await importBoundaryFile(conn.db, states(), asStates);
    await importBoundaryFile(conn.db, lgas(), asLgas);
    const westState = (await rows()).find((r) => r.name === "bnd-west-state");
    const [agency] = await conn.db.insert(agencies).values({ name: "bnd-state-roads", type: "roads" }).returning();
    await conn.db.insert(agencyJurisdictions).values({ agencyId: agency?.id ?? "", jurisdictionId: westState?.id ?? "", priority: 0 });

    // A report at (11.5, 11.5) is inside "bnd-lga-one", which is inside "bnd-west-state".
    const [user] = await conn.db.insert(users).values({ email: "bnd-reporter@example.com" }).returning();
    const [category] = await conn.db.select().from(categories).where(eq(categories.slug, "roads"));
    const [report] = await conn.db
      .insert(reports)
      .values({
        reference: "CF-BNDROUTE2",
        categoryId: category?.id ?? "",
        reporterId: user?.id ?? "",
        description: "A large pothole on the main road",
        location: sql`ST_SetSRID(ST_MakePoint(11.5, 11.5), 4326)::geography` as unknown as string,
        idempotencyKey: crypto.randomUUID(),
      })
      .returning();

    const decision = pickAgency(await findRoutingInput(conn.db, report?.id ?? ""));
    expect(decision).toMatchObject({ kind: "agency", agencyId: agency?.id, viaParent: true });
  });
});
