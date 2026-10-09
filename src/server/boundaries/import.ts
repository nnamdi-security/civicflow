/**
 * Imports administrative boundaries (states and local government areas) into the database
 * (Phase 8 Part B, docs/routing.md).
 *
 * Why this matters: routing decides which agency receives a report by asking the database "which
 * area contains this point?" (PostGIS, `ST_Covers`). Until real boundaries are loaded, routing
 * only works against rough sample rectangles. This importer is how the real shapes get in.
 *
 * Safety rules, because a wrong boundary sends reports to the wrong agency:
 *   1. NOTHING is saved unless EVERY feature passes. All changes happen inside one transaction
 *      (a group of database changes that either all succeed or are all undone).
 *   2. It never deletes anything. Existing places with the same identity are UPDATED; new ones are
 *      added. Reports and agency coverage are never touched.
 *   3. A "dry run" does all the work and the checks, then undoes everything, so you can see what
 *      WOULD happen first.
 *   4. It is safe to run twice: the second run finds the same places and updates them.
 *
 * The file is first checked by the pure rules in src/domain/boundaries.ts (shape of the file,
 * coordinates, names). This module then does the checks only the database can do: is each shape a
 * valid geometry, and which state does each LGA belong to?
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db, Tx } from "../../db/client";
import { jurisdictions } from "../../db/schema";
import type { JurisdictionLevel } from "../../domain/agency-types";
import { parseBoundaryCollection, type BoundaryFeature, type BoundaryIssue, type ParseOptions } from "../../domain/boundaries";

export type ImportProblemCode =
  | "geometry_invalid" // PostGIS could not turn the shape into a valid area
  | "parent_not_found" // the named state is not in the database
  | "parent_ambiguous" // the named state matches more than one row
  | "parent_not_found_by_location" // no state contains this LGA
  | "parent_ambiguous_by_location"; // more than one state contains this LGA

export interface ImportProblem {
  index: number;
  name: string;
  code: ImportProblemCode;
}

export interface ImportSummary {
  inserted: number;
  updated: number;
}

export type ImportResult =
  /** The file failed the pure checks; nothing was attempted. */
  | { status: "invalid_file"; issues: BoundaryIssue[] }
  /** The file was fine but the database found problems; nothing was saved. */
  | { status: "rejected"; problems: ImportProblem[] }
  /** A dry run: this is what WOULD have been saved. Nothing was. */
  | { status: "dry_run"; summary: ImportSummary }
  /** Saved. */
  | { status: "imported"; summary: ImportSummary };

/** Thrown inside the transaction to make Postgres undo everything, then caught just outside it. */
class RollbackSignal extends Error {
  constructor() {
    super("rollback");
    this.name = "RollbackSignal";
  }
}

/**
 * SQL that turns a GeoJSON shape into a clean database geometry:
 *   - ST_GeomFromGeoJSON reads the shape;   - ST_SetSRID marks it as WGS84 longitude/latitude;
 *   - ST_Force2D drops any altitude;        - ST_MakeValid repairs small defects such as a ring
 *     that crosses itself (a "bow-tie");     - ST_CollectionExtract(…, 3) keeps only areas (repair
 *     can leave stray lines or points);      - ST_Multi stores it as a MultiPolygon, which is what
 *     the column expects.
 */
function geometrySql(feature: BoundaryFeature) {
  return sql`ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(feature.geometry)}), 4326))), 3))`;
}

/** Is the cleaned-up shape a real, non-empty area? */
async function geometryIsUsable(tx: Tx, feature: BoundaryFeature): Promise<boolean> {
  const result = await tx.execute<{ usable: boolean }>(
    sql`select (not ST_IsEmpty(g) and ST_IsValid(g)) as usable from (select ${geometrySql(feature)} as g) as shape`,
  );
  return result.rows[0]?.usable === true;
}

/**
 * Finds the id of the state an LGA belongs to. Either by the state's NAME (when the file says
 * which state), or, if the file does not say, by LOCATION: the one state whose area contains a
 * point inside the LGA. Returns the id, or a problem code.
 */
async function resolveParent(
  tx: Tx,
  feature: BoundaryFeature,
): Promise<{ id: string } | { problem: ImportProblemCode }> {
  if (feature.parentName !== null) {
    const matches = await tx
      .select({ id: jurisdictions.id })
      .from(jurisdictions)
      .where(and(eq(jurisdictions.level, "state"), sql`lower(${jurisdictions.name}) = lower(${feature.parentName})`));
    if (matches.length === 0) return { problem: "parent_not_found" };
    if (matches.length > 1) return { problem: "parent_ambiguous" };
    return { id: matches[0]?.id ?? "" };
  }

  // No parent named: use a point guaranteed to lie INSIDE the LGA (ST_PointOnSurface), not its
  // centre, which for a crescent-shaped area could fall outside it.
  const matches = await tx.execute<{ id: string }>(sql`
    select j.id from jurisdictions j
    where j.level = 'state'
      and ST_Covers(j.geom, ST_PointOnSurface(${geometrySql(feature)}))
  `);
  if (matches.rows.length === 0) return { problem: "parent_not_found_by_location" };
  if (matches.rows.length > 1) return { problem: "parent_ambiguous_by_location" };
  return { id: matches.rows[0]?.id ?? "" };
}

/** Writes one feature: updates the place if it already exists, otherwise adds it. Returns which. */
async function upsert(tx: Tx, feature: BoundaryFeature, level: JurisdictionLevel, parentId: string | null) {
  const [existing] = await tx
    .select({ id: jurisdictions.id })
    .from(jurisdictions)
    .where(
      and(
        eq(jurisdictions.level, level),
        sql`lower(${jurisdictions.name}) = lower(${feature.name})`,
        // "same parent" must treat two missing parents as equal, which plain `=` does not.
        parentId === null ? isNull(jurisdictions.parentId) : eq(jurisdictions.parentId, parentId),
      ),
    )
    .limit(1);

  if (existing) {
    // Update the shape only. The name keeps whatever capitalisation it already has.
    await tx.update(jurisdictions).set({ geom: geometrySql(feature) as unknown as string }).where(eq(jurisdictions.id, existing.id));
    return "updated" as const;
  }
  await tx.insert(jurisdictions).values({
    name: feature.name,
    level,
    parentId,
    geom: geometrySql(feature) as unknown as string,
  });
  return "inserted" as const;
}

export interface ImportOptions extends ParseOptions {
  /** Do everything, report what would happen, then undo it. */
  dryRun: boolean;
}

/**
 * The whole job: check the file, then import it all-or-nothing.
 * `rawJson` is the already-parsed contents of the .geojson file.
 */
export async function importBoundaryFile(db: Db, rawJson: unknown, options: ImportOptions): Promise<ImportResult> {
  // Step 1: the pure checks. Refuse to continue if there is ANY issue, so a person fixes the file once.
  const parsed = parseBoundaryCollection(rawJson, options);
  if (parsed.issues.length > 0) return { status: "invalid_file", issues: parsed.issues };

  const problems: ImportProblem[] = [];
  const summary: ImportSummary = { inserted: 0, updated: 0 };

  try {
    await db.transaction(async (tx) => {
      for (const feature of parsed.features) {
        if (!(await geometryIsUsable(tx, feature))) {
          problems.push({ index: feature.index, name: feature.name, code: "geometry_invalid" });
          continue;
        }

        let parentId: string | null = null;
        if (options.level === "lga") {
          const parent = await resolveParent(tx, feature);
          if ("problem" in parent) {
            problems.push({ index: feature.index, name: feature.name, code: parent.problem });
            continue;
          }
          parentId = parent.id;
        }

        summary[await upsert(tx, feature, options.level, parentId)] += 1;
      }

      // Undo EVERYTHING if anything was wrong, and also for a dry run (which only wants the counts).
      if (problems.length > 0 || options.dryRun) throw new RollbackSignal();
    });
  } catch (error) {
    if (!(error instanceof RollbackSignal)) throw error; // a real failure: let it surface
  }

  if (problems.length > 0) return { status: "rejected", problems };
  return options.dryRun ? { status: "dry_run", summary } : { status: "imported", summary };
}
