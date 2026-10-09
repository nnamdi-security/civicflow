import { systemClock } from "../../domain/clock";
import { getDb } from "../db";
import { parseAuthEnv, parseProxyEnv } from "../env";
import { PostgresRateLimiter } from "../rate-limit/postgres-rate-limiter";
import { rateLimitKey, type RateLimiter } from "../rate-limit/rate-limiter";
import { pickClientAddress } from "../security/client-address";

export const IP_RATE_RULE = { limit: 20, windowMs: 15 * 60 * 1000 } as const;

/**
 * The visitor's network address as far as rate limiting is concerned. Reads the proxy headers
 * safely: see src/server/security/client-address.ts for why only the proxy-written (right-hand)
 * part of the forwarding header is believed, and `TRUSTED_PROXY_HOPS` for how many proxies to trust.
 */
export function clientAddress(headers: Headers): string {
  return pickClientAddress(headers, parseProxyEnv(process.env).trustedProxyHops);
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
