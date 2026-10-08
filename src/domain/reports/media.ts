/** Formats accepted for report photos (provider format names). */
export const MEDIA_ALLOWED_FORMATS = ["jpg", "png", "webp", "heic"] as const;

export type MediaFormat = (typeof MEDIA_ALLOWED_FORMATS)[number];

/** Photos are resized in the browser first, so this is a generous ceiling, not a target. */
export const MEDIA_MAX_BYTES = 10 * 1024 * 1024;

export interface UploadedAsset {
  publicId: string;
  format: string;
  width: number;
  height: number;
  bytes: number;
}

export type AssetIssue = "not_owner" | "format" | "too_large" | "invalid_dimensions";

/** Every reporter uploads into their own folder; ownership is decided by this prefix. */
export function reporterFolder(reporterId: string): string {
  return `civicflow/reports/${reporterId}`;
}

/** True only for `<reporter folder>/<single safe segment>`; rejects traversal and nesting. */
export function isOwnedPublicId(publicId: string, reporterId: string): boolean {
  const prefix = `${reporterFolder(reporterId)}/`;
  if (!publicId.startsWith(prefix)) return false;
  return /^[A-Za-z0-9_-]{1,64}$/.test(publicId.slice(prefix.length));
}

export function isAllowedFormat(format: string): format is MediaFormat {
  return (MEDIA_ALLOWED_FORMATS as readonly string[]).includes(format.toLowerCase());
}

/** Checks an uploaded asset against our rules. Returns the first problem, or null. */
export function findAssetIssue(asset: UploadedAsset, reporterId: string): AssetIssue | null {
  if (!isOwnedPublicId(asset.publicId, reporterId)) return "not_owner";
  if (!isAllowedFormat(asset.format)) return "format";
  if (asset.bytes <= 0 || asset.bytes > MEDIA_MAX_BYTES) return "too_large";
  if (!(asset.width > 0 && asset.height > 0)) return "invalid_dimensions";
  return null;
}
