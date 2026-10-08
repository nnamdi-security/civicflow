import { findAssetIssue, type AssetIssue, type UploadedAsset } from "../../../domain/reports/media";

export type { UploadedAsset } from "../../../domain/reports/media";

/** What the browser needs to upload one file directly to the provider. */
export interface UploadAuthorization {
  uploadUrl: string;
  /** Form fields to send with the file, in addition to the file itself. */
  fields: Record<string, string>;
  expiresAt: Date;
}

/** Callers depend on this interface, never on a vendor (ADR 0008). */
export interface MediaStorage {
  /** Authorizes uploads into the reporter's own folder. Call only after authenticating. */
  createUploadAuthorization(params: { reporterId: string }): Promise<UploadAuthorization>;
  /** Looks the asset up at the provider and enforces our rules. Throws MediaVerificationError. */
  verifyAsset(params: { publicId: string; reporterId: string }): Promise<UploadedAsset>;
  /** Delivery URL for a stored photo, sized for low-bandwidth screens. */
  imageUrl(publicId: string, options: { width: number }): string;
}

export type MediaErrorCode = AssetIssue | "not_found" | "unavailable" | "already_used";

/** Never carries vendor payloads, URLs, or file names. */
export class MediaVerificationError extends Error {
  constructor(
    readonly code: MediaErrorCode,
    readonly retryable = false,
  ) {
    super(`Media verification failed: ${code}`);
    this.name = "MediaVerificationError";
  }
}

/** Shared by every implementation so the rules cannot drift apart. */
export function assertValidAsset(asset: UploadedAsset, reporterId: string): UploadedAsset {
  const issue = findAssetIssue(asset, reporterId);
  if (issue) throw new MediaVerificationError(issue);
  return { ...asset, format: asset.format.toLowerCase() };
}
