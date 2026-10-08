import { createHash } from "node:crypto";
import { z } from "zod";
import { MEDIA_ALLOWED_FORMATS, reporterFolder } from "../../../domain/reports/media";
import type { Clock } from "../../../domain/clock";
import {
  MediaVerificationError,
  assertValidAsset,
  type MediaStorage,
  type UploadAuthorization,
  type UploadedAsset,
} from "./media-storage";

const TIMEOUT_MS = 10_000;
const AUTHORIZATION_TTL_MS = 10 * 60 * 1000;

interface CloudinaryConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  clock: Clock;
  /** Injectable for tests; defaults to the global fetch. */
  fetchFn?: typeof fetch;
}

/**
 * Cloudinary signing: sort params alphabetically, join as `k=v&...`, append the API secret,
 * SHA-1 hex. `file`, `cloud_name`, `resource_type` and `api_key` are never signed.
 */
export function signCloudinaryParams(params: Record<string, string>, apiSecret: string): string {
  const toSign = Object.keys(params)
    .filter((key) => !["file", "cloud_name", "resource_type", "api_key"].includes(key))
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
  return createHash("sha1").update(`${toSign}${apiSecret}`).digest("hex");
}

const resourceSchema = z.object({
  public_id: z.string(),
  format: z.string(),
  width: z.number(),
  height: z.number(),
  bytes: z.number(),
});

export class CloudinaryMediaStorage implements MediaStorage {
  private readonly fetchFn: typeof fetch;

  constructor(private readonly config: CloudinaryConfig) {
    this.fetchFn = config.fetchFn ?? fetch;
  }

  async createUploadAuthorization(params: { reporterId: string }): Promise<UploadAuthorization> {
    const now = this.config.clock.now();
    const signed: Record<string, string> = {
      allowed_formats: MEDIA_ALLOWED_FORMATS.join(","),
      folder: reporterFolder(params.reporterId),
      timestamp: String(Math.floor(now.getTime() / 1000)),
      // Strip embedded metadata (including EXIF GPS) from the stored original. To be verified
      // against a live Cloudinary account before launch (ADR 0008).
      transformation: "fl_strip_profile",
    };
    return {
      uploadUrl: `https://api.cloudinary.com/v1_1/${this.config.cloudName}/image/upload`,
      fields: {
        ...signed,
        api_key: this.config.apiKey,
        signature: signCloudinaryParams(signed, this.config.apiSecret),
      },
      expiresAt: new Date(now.getTime() + AUTHORIZATION_TTL_MS),
    };
  }

  async verifyAsset(params: { publicId: string; reporterId: string }): Promise<UploadedAsset> {
    // Reject foreign or malformed ids before any network call.
    const early = assertShape(params.publicId, params.reporterId);
    if (early) throw early;

    const path = params.publicId.split("/").map(encodeURIComponent).join("/");
    const credentials = Buffer.from(`${this.config.apiKey}:${this.config.apiSecret}`).toString(
      "base64",
    );

    let response: Response;
    try {
      response = await this.fetchFn(
        `https://api.cloudinary.com/v1_1/${this.config.cloudName}/resources/image/upload/${path}`,
        {
          headers: { Authorization: `Basic ${credentials}` },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
      );
    } catch {
      throw new MediaVerificationError("unavailable", true);
    }

    if (response.status === 404) throw new MediaVerificationError("not_found");
    if (!response.ok) {
      throw new MediaVerificationError("unavailable", response.status >= 500 || response.status === 429);
    }

    const parsed = resourceSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new MediaVerificationError("unavailable");

    return assertValidAsset(
      {
        publicId: parsed.data.public_id,
        format: parsed.data.format,
        width: parsed.data.width,
        height: parsed.data.height,
        bytes: parsed.data.bytes,
      },
      params.reporterId,
    );
  }

  imageUrl(publicId: string, options: { width: number }): string {
    const path = publicId.split("/").map(encodeURIComponent).join("/");
    return `https://res.cloudinary.com/${this.config.cloudName}/image/upload/f_auto,q_auto,c_limit,w_${options.width}/${path}`;
  }
}

function assertShape(publicId: string, reporterId: string): MediaVerificationError | null {
  try {
    assertValidAsset({ publicId, format: "jpg", width: 1, height: 1, bytes: 1 }, reporterId);
    return null;
  } catch (error) {
    return error instanceof MediaVerificationError ? error : new MediaVerificationError("not_owner");
  }
}
