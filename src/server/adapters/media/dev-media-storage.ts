import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { systemClock, type Clock } from "../../../domain/clock";
import { MEDIA_MAX_BYTES, isOwnedPublicId, reporterFolder } from "../../../domain/reports/media";
import {
  MediaVerificationError,
  assertValidAsset,
  type MediaStorage,
  type UploadAuthorization,
  type UploadedAsset,
} from "./media-storage";

const TOKEN_TTL_MS = 10 * 60 * 1000;
export const DEV_UPLOAD_PATH = "/api/dev-media/upload";

interface DevConfig {
  /** Signs upload tokens; reuse AUTH_SECRET. */
  secret: string;
  dir?: string;
  clock?: Clock;
}

interface Sidecar {
  format: string;
  width: number;
  height: number;
  bytes: number;
}

/** Identifies PNG, JPEG and WebP by their first bytes. Never trust the file name or MIME type. */
export function sniffImageFormat(bytes: Uint8Array): "png" | "jpg" | "webp" | null {
  const startsWith = (sig: number[], offset = 0) => sig.every((b, i) => bytes[offset + i] === b);
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith([0xff, 0xd8, 0xff])) return "jpg";
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) return "webp";
  return null;
}

/**
 * Local-disk stand-in for Cloudinary so the whole report flow works without an account.
 * Development and tests only: it refuses to be created in production (ADR 0008).
 */
export class DevMediaStorage implements MediaStorage {
  private readonly dir: string;
  private readonly clock: Clock;

  constructor(private readonly config: DevConfig) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("DevMediaStorage must not be used in production");
    }
    this.dir = config.dir ?? path.join(process.cwd(), ".dev-media");
    this.clock = config.clock ?? systemClock;
  }

  async createUploadAuthorization(params: { reporterId: string }): Promise<UploadAuthorization> {
    const expiresAt = new Date(this.clock.now().getTime() + TOKEN_TTL_MS);
    const payload = Buffer.from(
      JSON.stringify({ r: params.reporterId, e: expiresAt.getTime() }),
    ).toString("base64url");
    return {
      uploadUrl: DEV_UPLOAD_PATH,
      fields: { token: `${payload}.${this.sign(payload)}` },
      expiresAt,
    };
  }

  /** Called by the dev upload route. Validates the token, then stores the file. */
  async acceptUpload(params: {
    token: string;
    bytes: Uint8Array;
    width: number;
    height: number;
  }): Promise<UploadedAsset> {
    const reporterId = this.readToken(params.token);
    if (params.bytes.byteLength === 0 || params.bytes.byteLength > MEDIA_MAX_BYTES) {
      throw new MediaVerificationError("too_large");
    }
    const format = sniffImageFormat(params.bytes);
    if (!format) throw new MediaVerificationError("format");

    const id = randomUUID();
    const publicId = `${reporterFolder(reporterId)}/${id}`;
    const asset: UploadedAsset = {
      publicId,
      format,
      width: Math.round(params.width),
      height: Math.round(params.height),
      bytes: params.bytes.byteLength,
    };
    assertValidAsset(asset, reporterId);

    const target = this.fileFor(publicId);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(`${target}.bin`, params.bytes);
    const sidecar: Sidecar = { format, width: asset.width, height: asset.height, bytes: asset.bytes };
    await writeFile(`${target}.json`, JSON.stringify(sidecar), "utf8");
    return asset;
  }

  async verifyAsset(params: { publicId: string; reporterId: string }): Promise<UploadedAsset> {
    if (!isOwnedPublicId(params.publicId, params.reporterId)) {
      throw new MediaVerificationError("not_owner");
    }
    const sidecar = await this.readSidecar(params.publicId);
    return assertValidAsset({ publicId: params.publicId, ...sidecar }, params.reporterId);
  }

  imageUrl(publicId: string): string {
    return `/api/dev-media/file?id=${encodeURIComponent(publicId)}`;
  }

  /** For the dev file route. The id must match the strict shape we generate. */
  async readFile(publicId: string): Promise<{ bytes: Buffer; format: string } | null> {
    if (!DEV_PUBLIC_ID.test(publicId)) return null;
    const sidecar = await this.readSidecar(publicId).catch(() => null);
    if (!sidecar) return null;
    return { bytes: await readFile(`${this.fileFor(publicId)}.bin`), format: sidecar.format };
  }

  private async readSidecar(publicId: string): Promise<Sidecar> {
    if (!DEV_PUBLIC_ID.test(publicId)) throw new MediaVerificationError("not_found");
    try {
      return JSON.parse(await readFile(`${this.fileFor(publicId)}.json`, "utf8")) as Sidecar;
    } catch {
      throw new MediaVerificationError("not_found");
    }
  }

  /** Maps a validated public id to a path inside the store; callers validate the shape first. */
  private fileFor(publicId: string): string {
    return path.join(this.dir, ...publicId.split("/"));
  }

  private sign(payload: string): string {
    return createHmac("sha256", this.config.secret).update(`dev-media:${payload}`).digest("base64url");
  }

  private readToken(token: string): string {
    const [payload, signature] = token.split(".");
    if (!payload || !signature) throw new MediaVerificationError("not_owner");
    const expected = Buffer.from(this.sign(payload));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new MediaVerificationError("not_owner");
    }
    const data = parseTokenPayload(payload);
    if (data.e < this.clock.now().getTime()) throw new MediaVerificationError("not_owner");
    return data.r;
  }
}

const DEV_PUBLIC_ID =
  /^civicflow\/reports\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f-]{36}$/;

function parseTokenPayload(payload: string): { r: string; e: number } {
  try {
    const data: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (
      typeof data === "object" &&
      data !== null &&
      "r" in data &&
      "e" in data &&
      typeof data.r === "string" &&
      typeof data.e === "number"
    ) {
      return { r: data.r, e: data.e };
    }
  } catch {
    // fall through
  }
  throw new MediaVerificationError("not_owner");
}
