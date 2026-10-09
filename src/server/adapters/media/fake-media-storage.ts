import { reporterFolder } from "../../../domain/reports/media";
import {
  MediaDeletionError,
  MediaVerificationError,
  assertValidAsset,
  type MediaStorage,
  type UploadAuthorization,
  type UploadedAsset,
} from "./media-storage";

/** In-memory fake for tests. Tests "upload" with `simulateUpload`, then submit the public id. */
export class FakeMediaStorage implements MediaStorage {
  private readonly assets = new Map<string, UploadedAsset>();
  private counter = 0;
  unavailable = false;
  /** Every photo id deleted so far, in order. Tests check this. */
  readonly deleted: string[] = [];
  private deletionFailures: Array<{ retryable: boolean }> = [];

  simulateUpload(
    reporterId: string,
    overrides: Partial<Omit<UploadedAsset, "publicId">> = {},
  ): UploadedAsset {
    this.counter += 1;
    const asset: UploadedAsset = {
      publicId: `${reporterFolder(reporterId)}/photo${this.counter}`,
      format: "jpg",
      width: 800,
      height: 600,
      bytes: 120_000,
      ...overrides,
    };
    this.assets.set(asset.publicId, asset);
    return asset;
  }

  async createUploadAuthorization(): Promise<UploadAuthorization> {
    return {
      uploadUrl: "https://fake.invalid/upload",
      fields: {},
      expiresAt: new Date(Date.now() + 60_000),
    };
  }

  async verifyAsset(params: { publicId: string; reporterId: string }): Promise<UploadedAsset> {
    if (this.unavailable) throw new MediaVerificationError("unavailable", true);
    const asset = this.assets.get(params.publicId);
    if (!asset) throw new MediaVerificationError("not_found");
    return assertValidAsset(asset, params.reporterId);
  }

  imageUrl(publicId: string, options: { width: number }): string {
    return `https://fake.invalid/w_${options.width}/${publicId}`;
  }

  /** The next deletion fails; retryable by default, like a provider outage. */
  failNextDeletion(options: { retryable?: boolean } = {}): void {
    this.deletionFailures.push({ retryable: options.retryable ?? true });
  }

  async deleteAsset(publicId: string): Promise<void> {
    const failure = this.deletionFailures.shift();
    if (failure) throw new MediaDeletionError(failure.retryable);
    // Deleting something already gone is fine (safe to repeat).
    this.assets.delete(publicId);
    this.deleted.push(publicId);
  }
}
