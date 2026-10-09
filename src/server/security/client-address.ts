/**
 * Works out which network address a request really came from, for rate limiting.
 *
 * WHY THIS IS SUBTLE. A website sits behind one or more "proxies" (the hosting platform's front
 * door). Each proxy adds the address of whoever connected to it to the end of a header called
 * `X-Forwarded-For`, so the header is a list: "claimed-by-client, seen-by-proxy-1, seen-by-proxy-2".
 *
 *   - The LEFT of the list is whatever the visitor chose to write. Anyone can send
 *     `X-Forwarded-For: 1.2.3.4` and a different fake value on every request.
 *   - The RIGHT of the list was added by OUR proxies, so it can be trusted.
 *
 * Reading the left-hand value (as the first version of this code did) lets an attacker invent a
 * fresh address for every request and so escape every per-address limit (sign-in, public lookup).
 * The safe rule is: count how many proxies we trust (`hops`) and take the entry that many places
 * in from the RIGHT. With one trusted proxy that is the last entry, which that proxy wrote about
 * its direct visitor, so a visitor cannot forge it.
 *
 * `hops` must match the real deployment (see docs/runbook.md and ADR 0016): 1 for a single
 * proxy/load balancer (the usual case), 2 for a CDN in front of a load balancer, and so on.
 * With 0 the headers are ignored completely (everyone shares one bucket: safe, but unfriendly).
 *
 * This file is PURE: it only looks at the headers it is given.
 */

/** The value used when no trustworthy address can be found. */
export const UNKNOWN_ADDRESS = "unknown";

/** Longest value we accept, so a hostile header cannot stuff huge strings into rate-limit keys. */
const MAX_ADDRESS_LENGTH = 64;

/** True if the text could plausibly be an IPv4 or IPv6 address (optionally with a port). */
function looksLikeAddress(value: string): boolean {
  return value.length > 0 && value.length <= MAX_ADDRESS_LENGTH && /^[0-9a-fA-F.:[\]%]+$/.test(value);
}

export function pickClientAddress(headers: Headers, trustedProxyHops: number): string {
  if (!Number.isInteger(trustedProxyHops) || trustedProxyHops <= 0) return UNKNOWN_ADDRESS;

  const forwarded = headers
    .get("x-forwarded-for")
    ?.split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");

  if (forwarded && forwarded.length > 0) {
    // Count `hops` places in from the right. If the list is shorter than expected (fewer proxies
    // than we thought), the earliest entry is the best information we have.
    const chosen = forwarded[Math.max(forwarded.length - trustedProxyHops, 0)];
    return chosen !== undefined && looksLikeAddress(chosen) ? chosen : UNKNOWN_ADDRESS;
  }

  // Some proxies set a single `X-Real-IP` instead. It is only believed when X-Forwarded-For is
  // absent, and is subject to the same trust assumption: our proxy must overwrite it.
  const real = headers.get("x-real-ip")?.trim();
  return real !== undefined && looksLikeAddress(real) ? real : UNKNOWN_ADDRESS;
}
