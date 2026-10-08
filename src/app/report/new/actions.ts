"use server";

import { canSubmitReport } from "@/domain/permissions";
import { ForbiddenError } from "@/server/auth/errors";
import { requireActor } from "@/server/auth/guards";
import { rateLimitKey } from "@/server/rate-limit/rate-limiter";
import { PostgresRateLimiter } from "@/server/rate-limit/postgres-rate-limiter";
import { systemClock } from "@/domain/clock";
import { getDb } from "@/server/db";
import { createReport, type CreateReportResult } from "@/server/reports/create-report";
import { getCreateReportDeps, getMediaStorage } from "@/server/reports/deps";

const UPLOAD_AUTH_RULE = { limit: 30, windowMs: 60 * 60 * 1000 } as const;

export type UploadAuthorizationResult =
  | { ok: true; uploadUrl: string; fields: Record<string, string> }
  | { ok: false; reason: "rate_limited" };

/** Step 1 for each photo: the browser asks for permission to upload into its own folder. */
export async function authorizeUpload(): Promise<UploadAuthorizationResult> {
  const actor = await requireActor();
  if (!canSubmitReport(actor)) throw new ForbiddenError();

  const deps = getCreateReportDeps();
  const limiter = new PostgresRateLimiter(getDb(), systemClock);
  const key = rateLimitKey(deps.secret, "upload-auth", actor.userId);
  if (!(await limiter.consume(key, UPLOAD_AUTH_RULE)).allowed) {
    return { ok: false, reason: "rate_limited" };
  }

  const authorization = await getMediaStorage().createUploadAuthorization({ reporterId: actor.userId });
  return { ok: true, uploadUrl: authorization.uploadUrl, fields: authorization.fields };
}

/** Step 2: submit the finished form. Validation and authorization live in createReport. */
export async function submitReport(input: unknown): Promise<CreateReportResult> {
  const actor = await requireActor();
  return createReport(getCreateReportDeps(), actor, input);
}
