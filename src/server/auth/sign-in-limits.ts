import { systemClock } from "../../domain/clock";
import { getDb } from "../db";
import { parseAuthEnv } from "../env";
import { PostgresRateLimiter } from "../rate-limit/postgres-rate-limiter";
import { rateLimitKey, type RateLimiter } from "../rate-limit/rate-limiter";

export const IP_RATE_RULE = { limit: 20, windowMs: 15 * 60 * 1000 } as const;

/**
 * Best-effort client address. Deployment is undecided (docs/roadmap.md), so this trusts the
 * proxy headers a typical platform sets; revisit when the hosting ADR is written.
 */
export function clientAddress(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return headers.get("x-real-ip") ?? forwarded ?? "unknown";
}

/** Returns true if this client may start another sign-in attempt. */
export async function allowSignInAttempt(
  headers: Headers,
  limiter: RateLimiter = new PostgresRateLimiter(getDb(), systemClock),
  secret: string = parseAuthEnv(process.env).AUTH_SECRET,
): Promise<boolean> {
  const key = rateLimitKey(secret, "signin-ip", clientAddress(headers));
  const { allowed } = await limiter.consume(key, IP_RATE_RULE);
  return allowed;
}
