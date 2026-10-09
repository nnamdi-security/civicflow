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
  /**
   * Permanently deletes a stored photo (used when a resident erases their account, ADR 0015).
   * SAFE TO REPEAT: if the photo is already gone, that counts as success, so a retry after a
   * partial failure can never make things worse. Throws `MediaDeletionError` on provider trouble.
   */
  deleteAsset(publicId: string): Promise<void>;
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

/**
 * A photo could not be deleted. `retryable` says whether trying again later might work (the
 * provider was down or busy) or not (the provider refused, so retrying would just repeat it).
 * Like our other adapter errors, it never carries the photo's id, URLs or the provider's reply.
 */
export class MediaDeletionError extends Error {
  constructor(readonly retryable: boolean) {
    super("Media deletion failed");
    this.name = "MediaDeletionError";
  }
}

/** Shared by every implementation so the rules cannot drift apart. */
export function assertValidAsset(asset: UploadedAsset, reporterId: string): UploadedAsset {
  const issue = findAssetIssue(asset, reporterId);
  if (issue) throw new MediaVerificationError(issue);
  return { ...asset, format: asset.format.toLowerCase() };
}
