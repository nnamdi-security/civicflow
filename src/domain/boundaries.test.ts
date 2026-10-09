/**
 * Unit tests for the boundary-file checks in boundaries.ts. No database and no files: each test
 * builds a tiny GeoJSON object in memory and checks which problems are reported.
 */
import { describe, expect, it } from "vitest";
import { parseBoundaryCollection, type ParseOptions } from "./boundaries";

/** A small closed square inside Nigeria, as a Polygon's rings. [longitude, latitude] order! */
const square = (west = 3, south = 6, size = 1): number[][][] => [
  [
    [west, south],
    [west + size, south],
    [west + size, south + size],
    [west, south + size],
    [west, south], // the ring closes by repeating the first point
  ],
];

const feature = (properties: unknown, geometry: unknown) => ({ type: "Feature", properties, geometry });
const collection = (...features: unknown[]) => ({ type: "FeatureCollection", features });
const polygon = (coordinates: unknown = square()) => ({ type: "Polygon", coordinates });

const lgaOptions: ParseOptions = { level: "lga", nameField: "NAME", parentField: "STATE" };
const stateOptions: ParseOptions = { level: "state", nameField: "NAME" };
const codes = (result: ReturnType<typeof parseBoundaryCollection>) => result.issues.map((i) => i.code);

describe("a valid file", () => {
  it("accepts polygons and multipolygons and tidies the names", () => {
    const result = parseBoundaryCollection(
      collection(
        feature({ NAME: "  Ikeja \n ", STATE: "Lagos" }, polygon()),
        feature({ NAME: "Epe", STATE: "Lagos" }, { type: "MultiPolygon", coordinates: [square(3, 6), square(5, 7)] }),
      ),
      lgaOptions,
    );
    expect(result.issues).toEqual([]);
    expect(result.features.map((f) => [f.index, f.name, f.parentName])).toEqual([
      [0, "Ikeja", "Lagos"],
      [1, "Epe", "Lagos"],
    ]);
  });

  it("does not need a parent name for states, or for LGAs when no parent field is given", () => {
    expect(parseBoundaryCollection(collection(feature({ NAME: "Lagos" }, polygon())), stateOptions).issues).toEqual([]);
    const noParent = parseBoundaryCollection(collection(feature({ NAME: "Ikeja" }, polygon())), { level: "lga", nameField: "NAME" });
    expect(noParent.issues).toEqual([]);
    expect(noParent.features[0]?.parentName).toBeNull();
  });
});

describe("problems with the file as a whole", () => {
  it("rejects things that are not a FeatureCollection", () => {
    for (const bad of [null, "text", 5, [], {}, { type: "Feature" }, { type: "FeatureCollection" }, { type: "FeatureCollection", features: "no" }]) {
      expect(codes(parseBoundaryCollection(bad, stateOptions))).toEqual(["file_invalid"]);
    }
  });

  it("rejects an empty collection", () => {
    expect(codes(parseBoundaryCollection(collection(), stateOptions))).toEqual(["no_features"]);
  });

  it("rejects a feature that is not an object", () => {
    expect(codes(parseBoundaryCollection(collection(null, 5), stateOptions))).toEqual(["file_invalid", "file_invalid"]);
  });
});

describe("names", () => {
  it("rejects a missing, blank or non-text name, and one that is too long", () => {
    const bad = [{}, { NAME: "" }, { NAME: "   " }, { NAME: 42 }, { NAME: "x".repeat(101) }, null];
    for (const properties of bad) {
      expect(codes(parseBoundaryCollection(collection(feature(properties, polygon())), stateOptions))).toEqual(["name_missing"]);
    }
  });

  it("rejects an LGA with no parent state when the file is expected to name one", () => {
    expect(codes(parseBoundaryCollection(collection(feature({ NAME: "Ikeja" }, polygon())), lgaOptions))).toEqual(["parent_missing"]);
  });

  it("rejects the same place listed twice, ignoring capital letters", () => {
    const result = parseBoundaryCollection(
      collection(feature({ NAME: "Lagos" }, polygon()), feature({ NAME: "LAGOS" }, polygon(square(5, 7)))),
      stateOptions,
    );
    expect(codes(result)).toEqual(["duplicate_in_file"]);
    expect(result.features).toHaveLength(1); // the first copy is kept, the repeat is reported
  });

  it("allows the same LGA name under two different states", () => {
    const result = parseBoundaryCollection(
      collection(feature({ NAME: "Ifo", STATE: "Ogun" }, polygon()), feature({ NAME: "Ifo", STATE: "Oyo" }, polygon(square(4, 8)))),
      lgaOptions,
    );
    expect(result.issues).toEqual([]);
  });
});

describe("shapes", () => {
  const props = { NAME: "Place", STATE: "Lagos" };
  const check = (geometry: unknown) => codes(parseBoundaryCollection(collection(feature(props, geometry)), lgaOptions));

  it("rejects a missing geometry and unsupported shape types", () => {
    expect(check(null)).toEqual(["geometry_missing"]);
    expect(check(undefined)).toEqual(["geometry_missing"]);
    for (const type of ["Point", "LineString", "MultiPoint", "GeometryCollection", "Banana"]) {
      expect(check({ type, coordinates: [3, 6] })).toEqual(["geometry_type_unsupported"]);
    }
  });

  it("rejects empty or malformed coordinate lists", () => {
    expect(check({ type: "Polygon", coordinates: [] })).toEqual(["coordinates_invalid"]);
    expect(check({ type: "Polygon", coordinates: "no" })).toEqual(["coordinates_invalid"]);
    expect(check({ type: "Polygon", coordinates: [[]] })).toEqual(["ring_too_short"]);
    expect(check({ type: "Polygon", coordinates: [5] })).toEqual(["coordinates_invalid"]);
  });

  it("rejects points that are not two finite numbers", () => {
    const ring = (point: unknown) => [[[3, 6], [4, 6], point, [3, 7], [3, 6]]];
    for (const point of [[4], ["4", "7"], [NaN, 7], [4, Infinity], null, "x"]) {
      expect(check({ type: "Polygon", coordinates: ring(point) })).toEqual(["coordinates_invalid"]);
    }
  });

  it("rejects longitudes and latitudes that cannot exist", () => {
    expect(check({ type: "Polygon", coordinates: square(190, 6) })).toEqual(["coordinates_invalid"]);
    expect(check({ type: "Polygon", coordinates: square(3, 95) })).toEqual(["coordinates_invalid"]);
  });

  it("rejects a ring with fewer than four points, or one that does not close", () => {
    expect(check({ type: "Polygon", coordinates: [[[3, 6], [4, 6], [3, 6]]] })).toEqual(["ring_too_short"]);
    expect(check({ type: "Polygon", coordinates: [[[3, 6], [4, 6], [4, 7], [3, 7]]] })).toEqual(["ring_not_closed"]);
  });

  it("rejects shapes outside Nigeria, such as another country or swapped latitude and longitude", () => {
    expect(check({ type: "Polygon", coordinates: square(-0.1, 51.5) })).toEqual(["outside_nigeria"]); // London
    // Swapped [lat, lon]: a point at lon 3.4, lat 6.5 written as [6.5, 3.4] puts latitude 3.4,
    // which is below Nigeria's southern edge (4.2 minus the tolerance).
    expect(check({ type: "Polygon", coordinates: square(6.0, 2.0) })).toEqual(["outside_nigeria"]);
  });

  it("allows a small overshoot past the rough bounding box, because borders are irregular", () => {
    expect(check({ type: "Polygon", coordinates: square(2.4, 6) })).toEqual([]); // 0.2 degrees west of the box
  });

  it("checks every polygon of a MultiPolygon, not just the first", () => {
    expect(check({ type: "MultiPolygon", coordinates: [square(3, 6), square(-0.1, 51.5)] })).toEqual(["outside_nigeria"]);
  });
});

describe("collecting every problem at once", () => {
  it("reports all bad features, with their positions, so they can be fixed in one go", () => {
    const result = parseBoundaryCollection(
      collection(
        feature({ NAME: "Good", STATE: "Lagos" }, polygon()),
        feature({ STATE: "Lagos" }, polygon()),
        feature({ NAME: "Bad shape", STATE: "Lagos" }, { type: "Point", coordinates: [3, 6] }),
      ),
      lgaOptions,
    );
    expect(result.features.map((f) => f.name)).toEqual(["Good"]);
    expect(result.issues).toEqual([
      { index: 1, code: "name_missing" },
      { index: 2, code: "geometry_type_unsupported" },
    ]);
  });
});
