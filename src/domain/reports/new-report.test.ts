import { describe, expect, it } from "vitest";
import {
  DESCRIPTION_MAX,
  DESCRIPTION_MIN,
  NIGERIA_BOUNDS,
  PHOTOS_MAX,
  isWithinNigeria,
  sanitizeDescription,
  validateNewReport,
  type NewReportInput,
} from "./new-report";
import { REFERENCE_PATTERN, generateReference } from "./reference";

const valid: NewReportInput = {
  categoryId: "c1",
  description: "A large pothole on the main road",
  lon: 3.3792,
  lat: 6.5244,
  photoCount: 1,
};

function codes(input: Partial<NewReportInput>) {
  const result = validateNewReport({ ...valid, ...input });
  return result.ok ? [] : result.issues.map((i) => i.code);
}

describe("validateNewReport", () => {
  it("accepts a valid report and returns the sanitized description", () => {
    const result = validateNewReport({ ...valid, description: "  Pothole near the market  " });
    expect(result).toEqual({
      ok: true,
      value: { categoryId: "c1", description: "Pothole near the market", lon: 3.3792, lat: 6.5244 },
    });
  });

  it("enforces description length at the boundaries", () => {
    expect(codes({ description: "x".repeat(DESCRIPTION_MIN - 1) })).toEqual(["description_too_short"]);
    expect(codes({ description: "x".repeat(DESCRIPTION_MIN) })).toEqual([]);
    expect(codes({ description: "x".repeat(DESCRIPTION_MAX) })).toEqual([]);
    expect(codes({ description: "x".repeat(DESCRIPTION_MAX + 1) })).toEqual(["description_too_long"]);
  });

  it("measures length after sanitizing, so padding and control characters do not count", () => {
    expect(codes({ description: `${" ".repeat(20)}short` })).toEqual(["description_too_short"]);
    expect(codes({ description: "a\u0000b\u0000c\u0000d\u0000e\u0000f\u0000g\u0000h\u0000" })).toEqual([
      "description_too_short",
    ]);
  });

  it("counts code points, not UTF-16 units", () => {
    // 5 emoji = 10 UTF-16 units but 5 code points
    expect(codes({ description: "😀".repeat(5) })).toEqual(["description_too_short"]);
    expect(codes({ description: "😀".repeat(10) })).toEqual([]);
  });

  it("accepts points on the bounding box edges and rejects just outside", () => {
    const { minLon, maxLon, minLat, maxLat } = NIGERIA_BOUNDS;
    expect(codes({ lon: minLon, lat: minLat })).toEqual([]);
    expect(codes({ lon: maxLon, lat: maxLat })).toEqual([]);
    expect(codes({ lon: minLon - 0.001 })).toEqual(["location_outside_nigeria"]);
    expect(codes({ lat: maxLat + 0.001 })).toEqual(["location_outside_nigeria"]);
  });

  it("rejects swapped latitude and longitude for a Lagos point", () => {
    expect(codes({ lon: 6.5244, lat: 3.3792 })).toEqual(["location_outside_nigeria"]);
  });

  it("rejects non-finite coordinates", () => {
    expect(codes({ lon: Number.NaN })).toEqual(["location_invalid"]);
    expect(codes({ lat: Number.POSITIVE_INFINITY })).toEqual(["location_invalid"]);
  });

  it("requires one to three photos", () => {
    expect(codes({ photoCount: 0 })).toEqual(["photos_missing"]);
    expect(codes({ photoCount: PHOTOS_MAX })).toEqual([]);
    expect(codes({ photoCount: PHOTOS_MAX + 1 })).toEqual(["photos_too_many"]);
  });

  it("reports every problem at once", () => {
    expect(codes({ description: "", lon: 0, lat: 0, photoCount: 0 })).toEqual([
      "description_too_short",
      "location_outside_nigeria",
      "photos_missing",
    ]);
  });
});

describe("isWithinNigeria", () => {
  it("contains Lagos, Abuja and Kano", () => {
    expect(isWithinNigeria(3.38, 6.52)).toBe(true);
    expect(isWithinNigeria(7.49, 9.06)).toBe(true);
    expect(isWithinNigeria(8.52, 12.0)).toBe(true);
  });

  it("excludes Accra and London", () => {
    expect(isWithinNigeria(-0.2, 5.6)).toBe(false);
    expect(isWithinNigeria(-0.13, 51.5)).toBe(false);
  });
});

describe("sanitizeDescription", () => {
  it("strips control and invisible characters but keeps newlines", () => {
    expect(sanitizeDescription("a\u0000b​c\nd‮e")).toBe("abc\nde");
  });

  it("normalizes line endings and collapses long blank runs", () => {
    expect(sanitizeDescription("a\r\n\r\n\r\n\r\nb")).toBe("a\n\nb");
  });

  it("keeps HTML as plain text; escaping is the renderer's job", () => {
    expect(sanitizeDescription("<b>bold</b>")).toBe("<b>bold</b>");
  });
});

describe("generateReference", () => {
  const bytes = (values: number[]) => () => Uint8Array.from(values);

  it("produces CF- plus eight characters from the unambiguous alphabet", () => {
    const ref = generateReference(bytes([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]));
    expect(ref).toMatch(REFERENCE_PATTERN);
    expect(ref).toBe("CF-ABCDEFGH");
  });

  it("skips biased bytes instead of wrapping them", () => {
    // 256 % 30 = 16, so bytes >= 240 are rejected
    const ref = generateReference(bytes([255, 250, 240, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
    expect(ref).toBe("CF-AAAAAAAA");
  });

  it("matches the pattern for real random bytes", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateReference((n) => crypto.getRandomValues(new Uint8Array(n)))).toMatch(
        REFERENCE_PATTERN,
      );
    }
  });
});
