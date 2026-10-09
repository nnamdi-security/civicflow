/**
 * The use case behind "Download my data" (ADR 0015).
 *
 * Order, as for every action (.claude/rules/api-and-actions.md): who is asking, are they allowed,
 * is it within the limits, then do the work. Any signed-in person may download their OWN data
 * (residents and staff alike). The person is always the one in the session; nothing in the request
 * can name someone else.
 */
import type { Db } from "../../db/client";
import type { Clock } from "../../domain/clock";
import { buildDataExport, type DataExport } from "../../domain/data-export";
import { UnauthenticatedError } from "../auth/errors";
import type { AuthenticatedActor } from "../auth/session-user";
import type { MediaStorage } from "../adapters/media/media-storage";
import { rateLimitKey, type RateLimiter } from "../rate-limit/rate-limiter";
import { findDataForExport } from "../repositories/export";

/** Downloads allowed per account per hour. The query is heavier than a normal page, and nobody needs it often. */
export const EXPORT_RATE_RULE = { limit: 5, windowMs: 60 * 60 * 1000 } as const;

/** How wide the photo links in the file are: large enough to be useful as a personal copy. */
const EXPORT_IMAGE_WIDTH = 1600;

export interface ExportDeps {
  db: Db;
  clock: Clock;
  media: MediaStorage;
  limiter: RateLimiter;
  secret: string;
}

export type ExportResult =
  | { ok: true; data: DataExport }
  | { ok: false; reason: "rate_limited" | "not_found" };

export async function exportMyData(deps: ExportDeps, actor: AuthenticatedActor | null): Promise<ExportResult> {
  if (!actor) throw new UnauthenticatedError();

  const key = rateLimitKey(deps.secret, "data-export", actor.userId);
  if (!(await deps.limiter.consume(key, EXPORT_RATE_RULE)).allowed) return { ok: false, reason: "rate_limited" };

  const source = await findDataForExport(deps.db, actor.userId, (publicId) =>
    deps.media.imageUrl(publicId, { width: EXPORT_IMAGE_WIDTH }),
  );
  if (!source) return { ok: false, reason: "not_found" };
  return { ok: true, data: buildDataExport(source, deps.clock.now()) };
}
