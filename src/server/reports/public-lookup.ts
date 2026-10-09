import { z } from "zod";
import type { Db } from "../../db/client";
import type { Clock } from "../../domain/clock";
import { REFERENCE_PATTERN } from "../../domain/reports/reference";
import { toPublicReport, type PublicReport } from "../../domain/reports/public-view";
import type { RateLimiter, RateLimitRule } from "../rate-limit/rate-limiter";
import { rateLimitKey } from "../rate-limit/rate-limiter";
import { findPublicReportByReference } from "../repositories/public-reports";

/** Per client address; reference codes are hard to guess, and this keeps them hard to enumerate. */
export const LOOKUP_RATE_RULE: RateLimitRule = { limit: 30, windowMs: 10 * 60 * 1000 };

export interface PublicLookupDeps {
  db: Db;
  clock: Clock;
  limiter: RateLimiter;
  /** Keys rate-limit hashes, so stored counters cannot be reversed to a client address. */
  secret: string;
  /** Whether deadlines and overdue labels may be shown publicly (the overdue board switch). */
  showSla: boolean;
}

export type PublicLookupResult =
  | { ok: true; report: PublicReport }
  | { ok: false; reason: "not_found" | "rate_limited" };

const inputSchema = z.string().max(40);

/** Accepts what people type: any case, with spaces or a missing dash. */
export function normalizeReference(input: string): string {
  const compact = input.trim().toUpperCase().replace(/[\s-]/g, "");
  return compact.startsWith("CF") ? `CF-${compact.slice(2)}` : compact;
}

/**
 * Public tracking by reference code. No sign-in. Rate limited before any lookup; malformed and
 * unknown codes both answer `not_found`, so a miss never says whether a code was well formed.
 */
export async function lookupPublicReport(
  deps: PublicLookupDeps,
  clientAddress: string,
  rawReference: unknown,
): Promise<PublicLookupResult> {
  const key = rateLimitKey(deps.secret, "public-lookup", clientAddress);
  if (!(await deps.limiter.consume(key, LOOKUP_RATE_RULE)).allowed) return { ok: false, reason: "rate_limited" };

  const parsed = inputSchema.safeParse(rawReference);
  if (!parsed.success) return { ok: false, reason: "not_found" };
  const reference = normalizeReference(parsed.data);
  if (!REFERENCE_PATTERN.test(reference)) return { ok: false, reason: "not_found" };

  const source = await findPublicReportByReference(deps.db, reference);
  if (!source) return { ok: false, reason: "not_found" };
  return { ok: true, report: toPublicReport(source, { showSla: deps.showSla }, deps.clock) };
}
