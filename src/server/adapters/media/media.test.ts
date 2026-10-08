import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fixedClock } from "@/domain/clock";
import { MEDIA_MAX_BYTES, findAssetIssue, isOwnedPublicId, reporterFolder } from "@/domain/reports/media";
import { parseMediaEnv } from "../../env";
import { CloudinaryMediaStorage, signCloudinaryParams } from "./cloudinary-media-storage";
import { DevMediaStorage, sniffImageFormat } from "./dev-media-storage";
import { FakeMediaStorage } from "./fake-media-storage";
import { createMediaStorage } from "./index";
import { MediaVerificationError } from "./media-storage";

const REPORTER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const SECRET = "s".repeat(32);

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

describe("ownership and asset rules", () => {
  const asset = (publicId: string, over = {}) => ({
    publicId,
    format: "jpg",
    width: 800,
    height: 600,
    bytes: 1000,
    ...over,
  });
  const mine = `${reporterFolder(REPORTER)}/abc123`;

  it("accepts a single safe segment inside the reporter's own folder", () => {
    expect(isOwnedPublicId(mine, REPORTER)).toBe(true);
  });

  it("rejects another reporter's folder, nesting, traversal and empty names", () => {
    expect(isOwnedPublicId(`${reporterFolder(OTHER)}/abc`, REPORTER)).toBe(false);
    expect(isOwnedPublicId(`${reporterFolder(REPORTER)}/a/b`, REPORTER)).toBe(false);
    expect(isOwnedPublicId(`${reporterFolder(REPORTER)}/..`, REPORTER)).toBe(false);
    expect(isOwnedPublicId(`${reporterFolder(REPORTER)}/`, REPORTER)).toBe(false);
    expect(isOwnedPublicId(`${reporterFolder(REPORTER)}x/abc`, REPORTER)).toBe(false);
  });

  it("flags format, size and dimension problems", () => {
    expect(findAssetIssue(asset(mine), REPORTER)).toBeNull();
    expect(findAssetIssue(asset(mine, { format: "gif" }), REPORTER)).toBe("format");
    expect(findAssetIssue(asset(mine, { format: "PNG" }), REPORTER)).toBeNull();
    expect(findAssetIssue(asset(mine, { bytes: MEDIA_MAX_BYTES }), REPORTER)).toBeNull();
    expect(findAssetIssue(asset(mine, { bytes: MEDIA_MAX_BYTES + 1 }), REPORTER)).toBe("too_large");
    expect(findAssetIssue(asset(mine, { bytes: 0 }), REPORTER)).toBe("too_large");
    expect(findAssetIssue(asset(mine, { width: 0 }), REPORTER)).toBe("invalid_dimensions");
    expect(findAssetIssue(asset(`${reporterFolder(OTHER)}/x`), REPORTER)).toBe("not_owner");
  });
});

describe("FakeMediaStorage", () => {
  it("verifies an owned upload", async () => {
    const fake = new FakeMediaStorage();
    const asset = fake.simulateUpload(REPORTER);
    await expect(fake.verifyAsset({ publicId: asset.publicId, reporterId: REPORTER })).resolves.toMatchObject({
      publicId: asset.publicId,
    });
  });

  it("rejects unknown, foreign and badly formatted uploads", async () => {
    const fake = new FakeMediaStorage();
    const foreign = fake.simulateUpload(OTHER);
    const gif = fake.simulateUpload(REPORTER, { format: "gif" });
    const code = async (publicId: string) =>
      (await fake.verifyAsset({ publicId, reporterId: REPORTER }).catch((e: unknown) => e)) as MediaVerificationError;

    expect((await code(`${reporterFolder(REPORTER)}/missing`)).code).toBe("not_found");
    expect((await code(foreign.publicId)).code).toBe("not_owner");
    expect((await code(gif.publicId)).code).toBe("format");
  });
});

describe("signCloudinaryParams", () => {
  it("matches the example in Cloudinary's signature documentation", () => {
    const signature = signCloudinaryParams(
      {
        eager: "w_400,h_300,c_pad|w_260,h_200,c_crop",
        public_id: "sample_image",
        timestamp: "1315060510",
      },
      "abcd",
    );
    expect(signature).toBe("bfd09f95f331f558cbd1320e67aa8d488770583e");
  });

  it("ignores file, api_key, cloud_name and resource_type", () => {
    const base = { folder: "f", timestamp: "1" };
    expect(
      signCloudinaryParams({ ...base, file: "x", api_key: "k", cloud_name: "c", resource_type: "image" }, "s"),
    ).toBe(signCloudinaryParams(base, "s"));
  });
});

describe("CloudinaryMediaStorage", () => {
  const clock = fixedClock(new Date("2026-01-01T00:00:00Z"));
  const make = (fetchFn: typeof fetch) =>
    new CloudinaryMediaStorage({ cloudName: "demo", apiKey: "key", apiSecret: "secret", clock, fetchFn });

  it("signs an upload scoped to the reporter's folder with allowed formats", async () => {
    const auth = await make(vi.fn() as unknown as typeof fetch).createUploadAuthorization({ reporterId: REPORTER });
    expect(auth.uploadUrl).toBe("https://api.cloudinary.com/v1_1/demo/image/upload");
    expect(auth.fields.folder).toBe(reporterFolder(REPORTER));
    expect(auth.fields.allowed_formats).toBe("jpg,png,webp,heic");
    expect(auth.fields.api_key).toBe("key");
    expect(auth.fields.signature).toMatch(/^[0-9a-f]{40}$/);
    expect(auth.fields.signature).not.toContain("secret");
    expect(auth.expiresAt.getTime()).toBeGreaterThan(clock.now().getTime());
  });

  it("verifies an owned asset through the Admin API", async () => {
    const publicId = `${reporterFolder(REPORTER)}/photo1`;
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ public_id: publicId, format: "jpg", width: 800, height: 600, bytes: 5000 })),
    );
    const asset = await make(fetchFn as unknown as typeof fetch).verifyAsset({ publicId, reporterId: REPORTER });
    expect(asset).toMatchObject({ publicId, format: "jpg", bytes: 5000 });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/resources/image/upload/civicflow/reports/");
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^Basic /);
  });

  it("rejects a foreign public id without calling the provider", async () => {
    const fetchFn = vi.fn();
    const error = await make(fetchFn as unknown as typeof fetch)
      .verifyAsset({ publicId: `${reporterFolder(OTHER)}/photo1`, reporterId: REPORTER })
      .catch((e: unknown) => e);
    expect((error as MediaVerificationError).code).toBe("not_owner");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("maps provider failures to our error type without leaking payloads", async () => {
    const publicId = `${reporterFolder(REPORTER)}/photo1`;
    const run = async (response: () => Promise<Response>) =>
      (await make(vi.fn(response) as unknown as typeof fetch)
        .verifyAsset({ publicId, reporterId: REPORTER })
        .catch((e: unknown) => e)) as MediaVerificationError;

    expect((await run(async () => new Response("", { status: 404 }))).code).toBe("not_found");
    const server = await run(async () => new Response("secret-body", { status: 503 }));
    expect(server).toMatchObject({ code: "unavailable", retryable: true });
    expect(server.message).not.toContain("secret-body");
    const network = await run(async () => {
      throw new TypeError("connect ECONNREFUSED api.cloudinary.com");
    });
    expect(network).toMatchObject({ code: "unavailable", retryable: true });
    expect(network.message).not.toContain("ECONNREFUSED");
    expect((await run(async () => new Response("not json"))).code).toBe("unavailable");
  });

  it("builds small, auto-format delivery URLs", () => {
    const url = make(vi.fn() as unknown as typeof fetch).imageUrl(`${reporterFolder(REPORTER)}/photo1`, { width: 640 });
    expect(url).toBe(
      `https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,c_limit,w_640/civicflow/reports/${REPORTER}/photo1`,
    );
  });
});

describe("sniffImageFormat", () => {
  it("identifies PNG, JPEG and WebP by magic bytes", () => {
    expect(sniffImageFormat(PNG)).toBe("png");
    expect(sniffImageFormat(JPEG)).toBe("jpg");
    expect(sniffImageFormat(WEBP)).toBe("webp");
  });

  it("rejects everything else, including text and scripts", () => {
    expect(sniffImageFormat(new TextEncoder().encode("<script>alert(1)</script>"))).toBeNull();
    expect(sniffImageFormat(new TextEncoder().encode("GIF89a"))).toBeNull();
    expect(sniffImageFormat(new Uint8Array())).toBeNull();
  });
});

describe("DevMediaStorage", () => {
  async function store() {
    const dir = await mkdtemp(path.join(os.tmpdir(), "dev-media-"));
    const clock = fixedClock(new Date("2026-01-01T00:00:00Z"));
    return { storage: new DevMediaStorage({ secret: SECRET, dir, clock }), clock };
  }

  it("accepts an authorized upload and verifies it afterwards", async () => {
    const { storage } = await store();
    const { fields } = await storage.createUploadAuthorization({ reporterId: REPORTER });
    const asset = await storage.acceptUpload({ token: fields.token ?? "", bytes: PNG, width: 640, height: 480 });
    expect(asset.publicId.startsWith(`${reporterFolder(REPORTER)}/`)).toBe(true);
    await expect(storage.verifyAsset({ publicId: asset.publicId, reporterId: REPORTER })).resolves.toMatchObject({
      format: "png",
      width: 640,
    });
    expect((await storage.readFile(asset.publicId))?.format).toBe("png");
  });

  it("will not verify an asset for a different reporter", async () => {
    const { storage } = await store();
    const { fields } = await storage.createUploadAuthorization({ reporterId: REPORTER });
    const asset = await storage.acceptUpload({ token: fields.token ?? "", bytes: JPEG, width: 10, height: 10 });
    const error = await storage.verifyAsset({ publicId: asset.publicId, reporterId: OTHER }).catch((e: unknown) => e);
    expect((error as MediaVerificationError).code).toBe("not_owner");
  });

  it("rejects forged, tampered and expired tokens", async () => {
    const { storage, clock } = await store();
    const { fields } = await storage.createUploadAuthorization({ reporterId: REPORTER });
    const token = fields.token ?? "";
    const accept = async (t: string) =>
      (await storage.acceptUpload({ token: t, bytes: PNG, width: 1, height: 1 }).catch((e: unknown) => e)) as MediaVerificationError;

    expect((await accept("garbage")).code).toBe("not_owner");
    const [payload] = token.split(".");
    expect((await accept(`${payload}.forged`)).code).toBe("not_owner");
    clock.advance(11 * 60 * 1000);
    expect((await accept(token)).code).toBe("not_owner");
  });

  it("rejects non-image bytes and oversized files", async () => {
    const { storage } = await store();
    const { fields } = await storage.createUploadAuthorization({ reporterId: REPORTER });
    const token = fields.token ?? "";
    const text = new TextEncoder().encode("<html>not an image</html>");
    expect(((await storage.acceptUpload({ token, bytes: text, width: 1, height: 1 }).catch((e: unknown) => e)) as MediaVerificationError).code).toBe("format");
    const big = new Uint8Array(MEDIA_MAX_BYTES + 1);
    expect(((await storage.acceptUpload({ token, bytes: big, width: 1, height: 1 }).catch((e: unknown) => e)) as MediaVerificationError).code).toBe("too_large");
  });

  it("never serves paths outside its store", async () => {
    const { storage } = await store();
    expect(await storage.readFile("../../etc/passwd")).toBeNull();
    expect(await storage.readFile(`${reporterFolder(REPORTER)}/../../secret`)).toBeNull();
  });
});

describe("createMediaStorage", () => {
  it("uses Cloudinary when all three variables are set", () => {
    const env = parseMediaEnv({
      AUTH_SECRET: SECRET,
      CLOUDINARY_CLOUD_NAME: "c",
      CLOUDINARY_API_KEY: "k",
      CLOUDINARY_API_SECRET: "s",
    });
    expect(createMediaStorage(env)).toBeInstanceOf(CloudinaryMediaStorage);
  });

  it("uses the dev store outside production without Cloudinary", () => {
    expect(createMediaStorage(parseMediaEnv({ AUTH_SECRET: SECRET }))).toBeInstanceOf(DevMediaStorage);
  });

  it("refuses to start in production without Cloudinary", () => {
    const env = parseMediaEnv({ AUTH_SECRET: SECRET, NODE_ENV: "production" });
    expect(() => createMediaStorage(env)).toThrow("Media storage is not configured");
  });

  it("rejects a partial Cloudinary configuration", () => {
    expect(() => parseMediaEnv({ AUTH_SECRET: SECRET, CLOUDINARY_CLOUD_NAME: "c" })).toThrow(
      "CLOUDINARY_CLOUD_NAME",
    );
  });
});
