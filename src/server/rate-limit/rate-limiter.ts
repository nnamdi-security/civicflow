import { createHmac } from "node:crypto";

export interface RateLimitRule {
  /** Maximum allowed hits per window. */
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
}

export interface RateLimiter {
  /** Counts one hit against `key` and reports whether it is within the rule. */
  consume(key: string, rule: RateLimitRule): Promise<RateLimitResult>;
}

/**
 * Keys never contain raw emails or IPs (ADR 0006): they are keyed hashes, so stored rows
 * cannot be reversed to PII without the secret.
 */
export function rateLimitKey(secret: string, scope: string, value: string): string {
  const digest = createHmac("sha256", secret).update(`${scope}:${value}`).digest("hex");
  return `${scope}:${digest}`;
}
