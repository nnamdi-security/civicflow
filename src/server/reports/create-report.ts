import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../../db/client";
import type { Clock } from "../../domain/clock";
import { uniqueViolationConstraint } from "../../db/errors";
import { reportMedia, reports, statusEvents } from "../../db/schema";
import { canSubmitReport } from "../../domain/permissions";
import { validateNewReport, type ReportIssue } from "../../domain/reports/new-report";
import { generateReference } from "../../domain/reports/reference";
import { INITIAL_REPORT_STATUS } from "../../domain/reports/status";
import { ForbiddenError, UnauthenticatedError } from "../auth/errors";
import type { AuthenticatedActor } from "../auth/session-user";
import {
  MediaVerificationError,
  type MediaErrorCode,
  type MediaStorage,
  type UploadedAsset,
} from "../adapters/media/media-storage";
import type { RateLimiter } from "../rate-limit/rate-limiter";
import { rateLimitKey } from "../rate-limit/rate-limiter";
import { enqueueNotifications } from "../repositories/notifications";
import { assignReportJurisdiction } from "../repositories/report-workflow";
import { routeNewReport } from "./route-report";
import { findActiveCategory, findReportByIdempotencyKey, findUsedPublicIds } from "../repositories/reports";

export const SUBMIT_RATE_RULES = {
  hour: { limit: 5, windowMs: 60 * 60 * 1000 },
  day: { limit: 20, windowMs: 24 * 60 * 60 * 1000 },
} as const;

const MAX_REFERENCE_ATTEMPTS = 5;

export interface CreateReportDeps {
  db: Db;
  clock: Clock;
  media: MediaStorage;
  limiter: RateLimiter;
  /** Keys rate-limit hashes. */
  secret: string;
  randomBytes: (length: number) => Uint8Array;
}

const inputSchema = z.object({
  categoryId: z.uuid(),
  description: z.string().max(5000),
  lon: z.number(),
  lat: z.number(),
  photoPublicIds: z.array(z.string().min(1).max(256)).max(10),
  idempotencyKey: z.uuid(),
});

export type CreateReportResult =
  | { ok: true; created: boolean; report: { id: string; reference: string } }
  | { ok: false; reason: "malformed" }
  | { ok: false; reason: "invalid"; issues: ReportIssue[] }
  | { ok: false; reason: "rate_limited" }
  | { ok: false; reason: "category_unavailable" }
  | { ok: false; reason: "photo_rejected"; code: MediaErrorCode }
  | { ok: false; reason: "media_unavailable" };

/**
 * Submits a report. Order (see .claude/rules/api-and-actions.md): authenticate, authorize,
 * validate, rate limit, verify photos, then persist report + photos + first status event in
 * one transaction. A repeated idempotency key returns the existing report.
 */
export async function createReport(
  deps: CreateReportDeps,
  actor: AuthenticatedActor | null,
  raw: unknown,
): Promise<CreateReportResult> {
  if (!actor) throw new UnauthenticatedError();
  if (!canSubmitReport(actor)) throw new ForbiddenError();

  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "malformed" };
  const input = parsed.data;
  if (new Set(input.photoPublicIds).size !== input.photoPublicIds.length) {
    return { ok: false, reason: "malformed" };
  }

  // A double submit must not burn quota or create a second report.
  const existing = await findReportByIdempotencyKey(deps.db, actor.userId, input.idempotencyKey);
  if (existing) return { ok: true, created: false, report: existing };

  const validated = validateNewReport({
    categoryId: input.categoryId,
    description: input.description,
    lon: input.lon,
    lat: input.lat,
    photoCount: input.photoPublicIds.length,
  });
  if (!validated.ok) return { ok: false, reason: "invalid", issues: validated.issues };

  const key = rateLimitKey(deps.secret, "report-submit", actor.userId);
  if (!(await deps.limiter.consume(key, SUBMIT_RATE_RULES.hour)).allowed) {
    return { ok: false, reason: "rate_limited" };
  }
  if (!(await deps.limiter.consume(`${key}:day`, SUBMIT_RATE_RULES.day)).allowed) {
    return { ok: false, reason: "rate_limited" };
  }

  if (!(await findActiveCategory(deps.db, validated.value.categoryId))) {
    return { ok: false, reason: "category_unavailable" };
  }

  const photos: UploadedAsset[] = [];
  for (const publicId of input.photoPublicIds) {
    try {
      photos.push(await deps.media.verifyAsset({ publicId, reporterId: actor.userId }));
    } catch (error) {
      if (!(error instanceof MediaVerificationError)) throw error;
      if (error.code === "unavailable") return { ok: false, reason: "media_unavailable" };
      return { ok: false, reason: "photo_rejected", code: error.code };
    }
  }
  if ((await findUsedPublicIds(deps.db, input.photoPublicIds)).length > 0) {
    return { ok: false, reason: "photo_rejected", code: "already_used" };
  }

  for (let attempt = 0; attempt < MAX_REFERENCE_ATTEMPTS; attempt++) {
    const reference = generateReference(deps.randomBytes);
    try {
      const report = await deps.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(reports)
          .values({
            reference,
            categoryId: validated.value.categoryId,
            reporterId: actor.userId,
            description: validated.value.description,
            location: sql`ST_SetSRID(ST_MakePoint(${validated.value.lon}, ${validated.value.lat}), 4326)::geography` as unknown as string,
            status: INITIAL_REPORT_STATUS,
            idempotencyKey: input.idempotencyKey,
          })
          .returning({ id: reports.id, reference: reports.reference });
        if (!row) throw new Error("Report insert returned no row");

        await tx.insert(reportMedia).values(
          photos.map((photo, position) => ({
            reportId: row.id,
            publicId: photo.publicId,
            format: photo.format,
            width: photo.width,
            height: photo.height,
            bytes: photo.bytes,
            position,
          })),
        );
        await tx.insert(statusEvents).values({
          reportId: row.id,
          fromStatus: null,
          toStatus: INITIAL_REPORT_STATUS,
          actorId: actor.userId,
        });
        await assignReportJurisdiction(tx, row.id);
        await enqueueNotifications(tx, { reportId: row.id, event: "report_received", slaCycle: 0 });
        // ADR 0009: route in the same transaction. No match leaves it in the triage queue.
        await routeNewReport(tx, deps.clock, row.id);
        return row;
      });
      return { ok: true, created: true, report };
    } catch (error) {
      const constraint = uniqueViolationConstraint(error);
      if (constraint === "reports_reference_unique") continue;
      if (constraint === "reports_reporter_idempotency_unique") {
        const raced = await findReportByIdempotencyKey(deps.db, actor.userId, input.idempotencyKey);
        if (raced) return { ok: true, created: false, report: raced };
      }
      if (constraint === "report_media_public_id_unique") {
        return { ok: false, reason: "photo_rejected", code: "already_used" };
      }
      throw error;
    }
  }
  throw new Error("Could not allocate a unique report reference");
}
