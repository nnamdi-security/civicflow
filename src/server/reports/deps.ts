import { randomBytes } from "node:crypto";
import { systemClock } from "../../domain/clock";
import { createMediaStorage } from "../adapters/media";
import type { MediaStorage } from "../adapters/media/media-storage";
import { getDb } from "../db";
import { parseMediaEnv } from "../env";
import { PostgresRateLimiter } from "../rate-limit/postgres-rate-limiter";
import type { CreateReportDeps } from "./create-report";

const globalForMedia = globalThis as unknown as { __civicflowMedia?: MediaStorage };

/** One media storage per process (the dev store and Cloudinary adapter are stateless). */
export function getMediaStorage(): MediaStorage {
  globalForMedia.__civicflowMedia ??= createMediaStorage(parseMediaEnv(process.env));
  return globalForMedia.__civicflowMedia;
}

export function getCreateReportDeps(): CreateReportDeps {
  const db = getDb();
  return {
    db,
    clock: systemClock,
    media: getMediaStorage(),
    limiter: new PostgresRateLimiter(db, systemClock),
    secret: parseMediaEnv(process.env).AUTH_SECRET,
    randomBytes: (length) => randomBytes(length),
  };
}
