export const DESCRIPTION_MIN = 10;
export const DESCRIPTION_MAX = 1000;
export const PHOTOS_MIN = 1;
export const PHOTOS_MAX = 3;

/** Generous bounding box around Nigeria (lon/lat). Precise boundaries come with routing. */
export const NIGERIA_BOUNDS = { minLon: 2.6, maxLon: 14.7, minLat: 4.2, maxLat: 13.95 } as const;

export interface NewReportInput {
  categoryId: string;
  description: string;
  lon: number;
  lat: number;
  photoCount: number;
}

export interface ValidNewReport {
  categoryId: string;
  description: string;
  lon: number;
  lat: number;
}

export type ReportIssueCode =
  | "description_too_short"
  | "description_too_long"
  | "location_invalid"
  | "location_outside_nigeria"
  | "photos_missing"
  | "photos_too_many";

export interface ReportIssue {
  field: "description" | "location" | "photos";
  code: ReportIssueCode;
}

export type NewReportResult =
  | { ok: true; value: ValidNewReport }
  | { ok: false; issues: ReportIssue[] };

/**
 * Normalizes free text: NFC, no control characters (newlines and tabs become spaces/newlines
 * only), runs of blank lines collapsed, trimmed. Output is plain text; rendering escapes it.
 */
export function sanitizeDescription(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    // Drop control, format (zero-width, bidi) and line/paragraph-separator characters, but keep
    // newlines and the joiners (ZWNJ/ZWJ) that emoji sequences and some scripts rely on.
    .replace(/(?![\n\u200C\u200D])[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Length in code points, matching PostgreSQL's char_length. */
export function textLength(value: string): number {
  return [...value].length;
}

export function isWithinNigeria(lon: number, lat: number): boolean {
  return (
    lon >= NIGERIA_BOUNDS.minLon &&
    lon <= NIGERIA_BOUNDS.maxLon &&
    lat >= NIGERIA_BOUNDS.minLat &&
    lat <= NIGERIA_BOUNDS.maxLat
  );
}

export function validateNewReport(input: NewReportInput): NewReportResult {
  const issues: ReportIssue[] = [];

  const description = sanitizeDescription(input.description);
  const length = textLength(description);
  if (length < DESCRIPTION_MIN) issues.push({ field: "description", code: "description_too_short" });
  if (length > DESCRIPTION_MAX) issues.push({ field: "description", code: "description_too_long" });

  if (!Number.isFinite(input.lon) || !Number.isFinite(input.lat)) {
    issues.push({ field: "location", code: "location_invalid" });
  } else if (!isWithinNigeria(input.lon, input.lat)) {
    // Also catches latitude/longitude entered the wrong way round.
    issues.push({ field: "location", code: "location_outside_nigeria" });
  }

  if (input.photoCount < PHOTOS_MIN) issues.push({ field: "photos", code: "photos_missing" });
  if (input.photoCount > PHOTOS_MAX) issues.push({ field: "photos", code: "photos_too_many" });

  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    value: { categoryId: input.categoryId, description, lon: input.lon, lat: input.lat },
  };
}
