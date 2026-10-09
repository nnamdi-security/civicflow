/**
 * Scrubs personal and secret data out of anything before it is logged (Phase 8 Part B).
 *
 * The project rule is "no PII in logs" (PII = personally identifiable information: names, emails,
 * phone numbers, exact locations, secrets). A rule people must remember eventually gets broken by
 * accident, for example by logging a whole error object or request that happens to contain an
 * email. So instead of relying on memory, everything passes through this function first, which
 * makes the safe thing automatic. It protects in two ways:
 *
 *   1. BY NAME: any field whose name suggests sensitive data ("email", "phone", "token",
 *      "password", "description", "location"...) has its value replaced with "[redacted]",
 *      whatever it contains.
 *   2. BY LOOK: inside any text, things that LOOK like an email address, a phone number, or a long
 *      secret-looking string are replaced with "[email]", "[phone]" or "[secret]", even in fields
 *      with innocent names (an error message, say).
 *
 * It also keeps log lines a sane size and never crashes: it handles deeply nested data, very long
 * text, errors, dates, and objects that refer to themselves.
 *
 * This is a safety net, not permission to log anything: developers should still log ids and
 * counts, not personal data.
 */

export const REDACTED = "[redacted]";

/**
 * Field names (compared in lower case, ignoring `_` and `-`) whose values are never logged.
 * Free-text fields written by people are included because they can contain anything.
 */
const SENSITIVE_KEYS = new Set([
  "email",
  "emailaddress",
  "phone",
  "phonenumber",
  "phonee164",
  "msisdn",
  "mobile",
  "name",
  "fullname",
  "username",
  "displayname",
  "password",
  "passwd",
  "secret",
  "token",
  "accesstoken",
  "refreshtoken",
  "sessiontoken",
  "idtoken",
  "authorization",
  "cookie",
  "setcookie",
  "apikey",
  "signature",
  "otp",
  "code", // verification codes; use `errorCode` / `reasonCode` for harmless codes
  "codehash",
  "hash",
  "description",
  "note",
  "reason",
  "address",
  "clientaddress",
  "ip",
  "location",
  "latitude",
  "longitude",
  "lat",
  "lon",
  "lng",
  "body",
  "message", // free-text bodies; errors are handled separately via `errorFields`
  "text",
]);

function isSensitiveKey(key: string): boolean {
  const normal = key.toLowerCase().replace(/[_-]/g, "");
  return SENSITIVE_KEYS.has(normal);
}

// ---- Patterns that make text "look like" personal data ---------------------------------------

/** name@domain.tld */
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** An international (+234...) or Nigerian national (0803...) phone number, with optional spaces or dashes. */
const PHONE = /(?:\+|\b00)?\d[\d\s().-]{8,}\d/g;
/** "Bearer abc..." as found in authorization headers. */
const BEARER = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;
/** A long unbroken run of hex digits (hashes, session tokens): 32 or more. */
const LONG_HEX = /\b[0-9a-f]{32,}\b/gi;
/** A long run of base64/URL-safe characters (tokens, keys): 40 or more. */
const LONG_TOKEN = /\b[A-Za-z0-9_-]{40,}\b/g;

/**
 * Replaces anything in `text` that looks like personal data or a secret.
 * Note this errs on the side of HIDING: an unusual id made only of digits and dashes could be
 * mistaken for a phone number. That costs a little log readability and no privacy, which is the
 * right way round.
 */
export function scrubText(text: string): string {
  return (
    text
      .replace(BEARER, "Bearer [secret]")
      .replace(EMAIL, "[email]")
      // Hex and token runs before phones, so digits inside a long secret are not mistaken for a number.
      .replace(LONG_HEX, "[secret]")
      .replace(LONG_TOKEN, "[secret]")
      .replace(PHONE, (match) => (match.replace(/\D/g, "").length >= 10 ? "[phone]" : match))
  );
}

// ---- Size limits ------------------------------------------------------------------------------

const MAX_DEPTH = 6;
const MAX_STRING = 300;
const MAX_ITEMS = 20;
const MAX_KEYS = 30;

/**
 * Returns a copy of `value` that is safe to log. It never mutates the input and never throws.
 */
export function redact(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "string") {
    const scrubbed = scrubText(value);
    return scrubbed.length > MAX_STRING ? `${scrubbed.slice(0, MAX_STRING)}…` : scrubbed;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "[invalid date]" : value.toISOString();
  if (typeof value === "function" || typeof value === "symbol") return undefined;

  if (typeof value === "object") {
    if (depth >= MAX_DEPTH) return "[truncated]";
    if (seen.has(value)) return "[circular]";
    seen.add(value);

    if (value instanceof Error) {
      // Only the kind of error and a scrubbed message. Never the stack (it can embed values) or custom fields.
      return { name: value.name, message: redact(value.message, depth + 1, seen) };
    }
    if (Array.isArray(value)) {
      const items = value.slice(0, MAX_ITEMS).map((item) => redact(item, depth + 1, seen));
      return value.length > MAX_ITEMS ? [...items, `[+${value.length - MAX_ITEMS} more]`] : items;
    }

    // Reading an object's fields can itself throw (for example a getter that fails). Logging must
    // never be the thing that crashes the code path it is describing, so fail safe.
    try {
      const output: Record<string, unknown> = {};
      const entries = Object.entries(value as Record<string, unknown>);
      for (const [key, inner] of entries.slice(0, MAX_KEYS)) {
        if (inner === undefined) continue;
        output[key] = isSensitiveKey(key) ? REDACTED : redact(inner, depth + 1, seen);
      }
      if (entries.length > MAX_KEYS) output["[more]"] = `+${entries.length - MAX_KEYS} fields`;
      return output;
    } catch {
      return "[unloggable]";
    }
  }
  return undefined;
}
