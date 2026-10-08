import { systemClock } from "../../../domain/clock";
import type { MediaEnv } from "../../env";
import { CloudinaryMediaStorage } from "./cloudinary-media-storage";
import { DevMediaStorage } from "./dev-media-storage";
import type { MediaStorage } from "./media-storage";

export { MediaVerificationError } from "./media-storage";
export type { MediaStorage, UploadAuthorization, UploadedAsset } from "./media-storage";
export { FakeMediaStorage } from "./fake-media-storage";
export { DevMediaStorage, isDevMediaStorage } from "./dev-media-storage";

/** Cloudinary when configured; the local dev store outside production; otherwise a hard failure. */
export function createMediaStorage(env: MediaEnv): MediaStorage {
  if (
    env.CLOUDINARY_CLOUD_NAME !== undefined &&
    env.CLOUDINARY_API_KEY !== undefined &&
    env.CLOUDINARY_API_SECRET !== undefined
  ) {
    return new CloudinaryMediaStorage({
      cloudName: env.CLOUDINARY_CLOUD_NAME,
      apiKey: env.CLOUDINARY_API_KEY,
      apiSecret: env.CLOUDINARY_API_SECRET,
      clock: systemClock,
    });
  }
  if (env.NODE_ENV === "production") {
    throw new Error("Media storage is not configured: set the CLOUDINARY_* variables");
  }
  return new DevMediaStorage({ secret: env.AUTH_SECRET });
}
