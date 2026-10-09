/**
 * Checks a GeoJSON file of administrative boundaries (states or local government areas) BEFORE
 * anything is written to the database (Phase 8 Part B, docs/routing.md).
 *
 * Background for beginners:
 *   - GeoJSON is a standard text format for shapes on a map. A file is a "FeatureCollection": a
 *     list of "features", each with a `geometry` (the shape) and `properties` (labels such as the
 *     name of the place).
 *   - A shape here is a Polygon (one area) or a MultiPolygon (several areas, for example a state
 *     with islands). A polygon is a list of "rings"; each ring is a closed loop of
 *     [longitude, latitude] points. NOTE THE ORDER: longitude first, then latitude. Mixing them
 *     up is the classic mistake with map data, so we check for it.
 *   - Boundaries decide where reports are routed (docs/routing.md), so a bad file would send
 *     reports to the wrong agency. That is why every rule here refuses rather than guesses.
 *
 * This file is PURE: it only looks at the data it is given. It does not read files or touch the
 * database. The database-side checks (is the shape valid? which state contains this LGA?) happen
 * later in src/server/boundaries/import.ts, using PostGIS.
 */
import type { JurisdictionLevel } from "./agency-types";
import { NIGERIA_BOUNDS } from "./reports/new-report";
import { sanitizeDescription, textLength } from "./reports/new-report";

/** How far outside Nigeria's rough bounding box a vertex may be, in degrees (borders are irregular). */
export const BOUNDARY_TOLERANCE_DEGREES = 0.5;
export const BOUNDARY_NAME_MAX = 100;

/** One boundary that passed every check, ready for the database. */
export interface BoundaryFeature {
  /** Position of the feature in the file (starting at 0), so problems can be reported precisely. */
  index: number;
  name: string;
  /** For local government areas: the name of the state they belong to, if the file says so. */
  parentName: string | null;
  geometry: { type: "Polygon" | "MultiPolygon"; coordinates: unknown };
}

export type BoundaryIssueCode =
  | "file_invalid" // not a GeoJSON FeatureCollection at all
  | "no_features" // an empty file
  | "name_missing"
  | "parent_missing" // an LGA feature without the state name, when the file was told to expect it
  | "geometry_missing"
  | "geometry_type_unsupported" // anything other than Polygon or MultiPolygon
  | "coordinates_invalid" // not numbers, or not [lon, lat] pairs
  | "ring_not_closed" // the loop does not end where it began
  | "ring_too_short" // fewer than 4 points (a triangle needs 3 corners + the closing point)
  | "outside_nigeria" // a point is nowhere near Nigeria (often swapped lat/lon or a wrong country)
  | "duplicate_in_file"; // two features with the same level, name and parent

export interface BoundaryIssue {
  /** Position of the feature, or -1 for a problem with the file as a whole. */
  index: number;
  code: BoundaryIssueCode;
}

export interface ParseOptions {
  level: JurisdictionLevel;
  /** Which property holds the place's name, for example "NAME" or "lganame". */
  nameField: string;
  /** Which property holds the parent state's name (LGAs only). Leave out to work the parent out by location. */
  parentField?: string;
}

export interface ParseResult {
  features: BoundaryFeature[];
  issues: BoundaryIssue[];
}

/** Reads a property from a feature's `properties` object, as trimmed text, or null if absent/blank. */
function readText(properties: unknown, field: string): string | null {
  if (typeof properties !== "object" || properties === null) return null;
  const value = (properties as Record<string, unknown>)[field];
  if (typeof value !== "string") return null;
  // Same cleaning as agency names: remove control characters and squash whitespace to single spaces.
  const cleaned = sanitizeDescription(value).replace(/\s+/g, " ");
  return cleaned === "" ? null : cleaned;
}

/** Is `value` a finite number? (`NaN` and `Infinity` are numbers in JavaScript but are never valid coordinates.) */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Checks one ring (a closed loop of [lon, lat] points). Returns the first problem found, or null. */
function checkRing(ring: unknown): BoundaryIssueCode | null {
  if (!Array.isArray(ring)) return "coordinates_invalid";
  if (ring.length < 4) return "ring_too_short";

  for (const point of ring) {
    // Each point must be [longitude, latitude], optionally with a third number (altitude) we ignore.
    if (!Array.isArray(point) || point.length < 2 || !isFiniteNumber(point[0]) || !isFiniteNumber(point[1])) {
      return "coordinates_invalid";
    }
    const [lon, lat] = point as [number, number];
    // Longitude is in [-180, 180] and latitude in [-90, 90] by definition; anything else is garbage.
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return "coordinates_invalid";
    // Is the point near Nigeria? Reports are only accepted inside Nigeria, so boundaries elsewhere are a mistake.
    if (
      lon < NIGERIA_BOUNDS.minLon - BOUNDARY_TOLERANCE_DEGREES ||
      lon > NIGERIA_BOUNDS.maxLon + BOUNDARY_TOLERANCE_DEGREES ||
      lat < NIGERIA_BOUNDS.minLat - BOUNDARY_TOLERANCE_DEGREES ||
      lat > NIGERIA_BOUNDS.maxLat + BOUNDARY_TOLERANCE_DEGREES
    ) {
      return "outside_nigeria";
    }
  }

  // A ring must be a closed loop: the last point equals the first.
  const first = ring[0] as number[];
  const last = ring[ring.length - 1] as number[];
  if (first[0] !== last[0] || first[1] !== last[1]) return "ring_not_closed";
  return null;
}

/** Checks one geometry. Returns the first problem found, or null if the shape is acceptable. */
function checkGeometry(geometry: unknown): BoundaryIssueCode | null {
  if (typeof geometry !== "object" || geometry === null) return "geometry_missing";
  const { type, coordinates } = geometry as { type?: unknown; coordinates?: unknown };
  if (type !== "Polygon" && type !== "MultiPolygon") return "geometry_type_unsupported";
  if (!Array.isArray(coordinates) || coordinates.length === 0) return "coordinates_invalid";

  // A Polygon is a list of rings; a MultiPolygon is a list of Polygons. Normalise to "list of polygons".
  const polygons: unknown[] = type === "Polygon" ? [coordinates] : coordinates;
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || polygon.length === 0) return "coordinates_invalid";
    for (const ring of polygon) {
      const problem = checkRing(ring);
      if (problem) return problem;
    }
  }
  return null;
}

/**
 * Parses and checks a whole GeoJSON file. It never throws for bad data: every problem is
 * collected in `issues` (so a person can fix them all in one go), and only features that passed
 * every check appear in `features`. The importer refuses to proceed if there are ANY issues.
 */
export function parseBoundaryCollection(raw: unknown, options: ParseOptions): ParseResult {
  const issues: BoundaryIssue[] = [];
  const features: BoundaryFeature[] = [];

  // The file itself must be a FeatureCollection with a list of features.
  if (
    typeof raw !== "object" ||
    raw === null ||
    (raw as { type?: unknown }).type !== "FeatureCollection" ||
    !Array.isArray((raw as { features?: unknown }).features)
  ) {
    return { features, issues: [{ index: -1, code: "file_invalid" }] };
  }
  const list = (raw as { features: unknown[] }).features;
  if (list.length === 0) return { features, issues: [{ index: -1, code: "no_features" }] };

  const seen = new Set<string>(); // to catch the same place listed twice

  list.forEach((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      issues.push({ index, code: "file_invalid" });
      return;
    }
    const { properties, geometry } = entry as { properties?: unknown; geometry?: unknown };

    const name = readText(properties, options.nameField);
    if (name === null || textLength(name) > BOUNDARY_NAME_MAX) {
      issues.push({ index, code: "name_missing" });
      return;
    }

    let parentName: string | null = null;
    if (options.level === "lga" && options.parentField) {
      parentName = readText(properties, options.parentField);
      if (parentName === null) {
        issues.push({ index, code: "parent_missing" });
        return;
      }
    }

    const geometryProblem = checkGeometry(geometry);
    if (geometryProblem) {
      issues.push({ index, code: geometryProblem });
      return;
    }

    // Identity of a place: its level, name and parent, ignoring capital letters.
    const identity = `${options.level}|${name.toLowerCase()}|${(parentName ?? "").toLowerCase()}`;
    if (seen.has(identity)) {
      issues.push({ index, code: "duplicate_in_file" });
      return;
    }
    seen.add(identity);

    const { type, coordinates } = geometry as { type: "Polygon" | "MultiPolygon"; coordinates: unknown };
    features.push({ index, name, parentName, geometry: { type, coordinates } });
  });

  return { features, issues };
}
