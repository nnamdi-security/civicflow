/**
 * Unit tests for deleting stored photos (ADR 0015): used when a resident erases their account.
 *
 * Three implementations share one promise, and these tests hold each to it:
 *   - deleting a photo that exists removes it;
 *   - deleting one that is already gone is NOT an error (so a retry after a half-finished attempt
 *     is always safe);
 *   - when the provider is in trouble the error says whether retrying could help, and never
 *     contains the photo's id, an address or the provider's reply.
 */
import { access, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fixedClock } from "@/domain/clock";
import { reporterFolder } from "@/domain/reports/media";
import { CloudinaryMediaStorage, signCloudinaryParams } from "./cloudinary-media-storage";
import { DevMediaStorage } from "./dev-media-storage";
import { FakeMediaStorage } from "./fake-media-storage";
import { MediaDeletionError } from "./media-storage";

const REPORTER = "11111111-1111-4111-8111-111111111111";
const SECRET = "s".repeat(32);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const exists = (file: string) => access(file).then(() => true, () => false);

describe("CloudinaryMediaStorage.deleteAsset", () => {
  const clock = fixedClock(new Date("2026-01-01T00:00:00Z"));
  const make = (fetchFn: typeof fetch) =>
    new CloudinaryMediaStorage({ cloudName: "demo", apiKey: "key", apiSecret: "secret", clock, fetchFn });
  const publicId = `${reporterFolder(REPORTER)}/photo1`;
  const reply = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

  it("sends a signed destroy request that also purges cached copies", async () => {
    const fetchFn = reply({ result: "ok" });
    await make(fetchFn as unknown as typeof fetch).deleteAsset(publicId);

    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.cloudinary.com/v1_1/demo/image/destroy");
    expect(init.method).toBe("POST");
    const sent = new URLSearchParams(init.body as URLSearchParams);
    expect(sent.get("public_id")).toBe(publicId);
    expect(sent.get("invalidate")).toBe("true");
    expect(sent.get("api_key")).toBe("key");
    expect(sent.get("timestamp")).toBe(String(Math.floor(clock.now().getTime() / 1000)));
    // The signature covers exactly the signed fields, and the secret itself is never sent.
    expect(sent.get("signature")).toBe(
      signCloudinaryParams({ invalidate: "true", public_id: publicId, timestamp: sent.get("timestamp") ?? "" }, "secret"),
    );
    expect(init.body?.toString()).not.toContain("secret");
  });

  it("treats 'not found' as success, because the photo is already gone", async () => {
    await expect(make(reply({ result: "not found" }) as unknown as typeof fetch).deleteAsset(publicId)).resolves.toBeUndefined();
  });

  it("marks server trouble and rate limits retryable, and refusals not", async () => {
    for (const [status, retryable] of [
      [500, true],
      [503, true],
      [429, true],
      [401, false],
      [403, false],
      [400, false],
    ] as const) {
      const error = await make(reply({ error: { message: "secret detail" } }, status) as unknown as typeof fetch)
        .deleteAsset(publicId)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(MediaDeletionError);
      expect((error as MediaDeletionError).retryable).toBe(retryable);
    }
  });

  it("treats an unexpected reply as a permanent failure rather than guessing it worked", async () => {
    for (const body of [{ result: "error" }, { result: 5 }, {}, null]) {
      const error = await make(reply(body) as unknown as typeof fetch).deleteAsset(publicId).catch((e: unknown) => e);
      expect(error).toMatchObject({ name: "MediaDeletionError", retryable: false });
    }
    const unreadable = vi.fn(async () => new Response("<html>oops</html>", { status: 200 }));
    expect(await make(unreadable as unknown as typeof fetch).deleteAsset(publicId).catch((e: unknown) => e)).toMatchObject({
      retryable: false,
    });
  });

  it("maps network failures to a retryable error, leaking nothing", async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError(`connect ECONNREFUSED api.cloudinary.com for ${publicId}`);
    });
    const error = (await make(fetchFn as unknown as typeof fetch).deleteAsset(publicId).catch((e: unknown) => e)) as MediaDeletionError;
    expect(error).toBeInstanceOf(MediaDeletionError);
    expect(error.retryable).toBe(true);
    expect(error.message).not.toContain("ECONNREFUSED");
    expect(error.message).not.toContain(publicId);
  });
});

describe("DevMediaStorage.deleteAsset", () => {
  async function storeWithPhoto() {
    const dir = await mkdtemp(path.join(os.tmpdir(), "dev-media-"));
    const storage = new DevMediaStorage({ secret: SECRET, dir, clock: fixedClock(new Date("2026-01-01T00:00:00Z")) });
    const { fields } = await storage.createUploadAuthorization({ reporterId: REPORTER });
    const asset = await storage.acceptUpload({ token: fields.token ?? "", bytes: PNG, width: 640, height: 480 });
    return { dir, storage, asset };
  }

  it("removes the photo and its description file", async () => {
    const { dir, storage, asset } = await storeWithPhoto();
    const base = path.join(dir, ...asset.publicId.split("/"));
    expect(await exists(`${base}.bin`)).toBe(true);
    await storage.deleteAsset(asset.publicId);
    expect(await exists(`${base}.bin`)).toBe(false);
    expect(await exists(`${base}.json`)).toBe(false);
    expect(await storage.readFile(asset.publicId)).toBeNull();
  });

  it("is safe to repeat", async () => {
    const { storage, asset } = await storeWithPhoto();
    await storage.deleteAsset(asset.publicId);
    await expect(storage.deleteAsset(asset.publicId)).resolves.toBeUndefined();
  });

  it("ignores ids of the wrong shape, so a crafted id can never reach other files", async () => {
    const { dir, storage, asset } = await storeWithPhoto();
    for (const hostile of ["../../etc/passwd", "../outside", `${asset.publicId}/../..`, "", "civicflow/reports/x/y"]) {
      await expect(storage.deleteAsset(hostile)).resolves.toBeUndefined();
    }
    // The real photo is untouched by all of those.
    expect(await exists(`${path.join(dir, ...asset.publicId.split("/"))}.bin`)).toBe(true);
  });
});

describe("FakeMediaStorage.deleteAsset", () => {
  it("removes the photo and records the deletion", async () => {
    const fake = new FakeMediaStorage();
    const asset = fake.simulateUpload(REPORTER);
    await fake.deleteAsset(asset.publicId);
    expect(fake.deleted).toEqual([asset.publicId]);
    await expect(fake.verifyAsset({ publicId: asset.publicId, reporterId: REPORTER })).rejects.toMatchObject({ code: "not_found" });
  });

  it("is safe to repeat and can be told to fail once, retryable or not", async () => {
    const fake = new FakeMediaStorage();
    const asset = fake.simulateUpload(REPORTER);
    fake.failNextDeletion();
    fake.failNextDeletion({ retryable: false });
    const first = (await fake.deleteAsset(asset.publicId).catch((e: unknown) => e)) as MediaDeletionError;
    const second = (await fake.deleteAsset(asset.publicId).catch((e: unknown) => e)) as MediaDeletionError;
    expect([first.retryable, second.retryable]).toEqual([true, false]);
    await fake.deleteAsset(asset.publicId);
    await expect(fake.deleteAsset(asset.publicId)).resolves.toBeUndefined();
  });
});
