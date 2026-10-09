/**
 * Builds the Content Security Policy (CSP) header (Phase 8 Part B, docs/security-privacy.md).
 *
 * What a CSP is: a header the server sends with every page that tells the browser exactly which
 * places it may load things from (scripts, images, network requests...). If an attacker ever
 * manages to slip a malicious <script> into a page, the browser refuses to run it because it is
 * not on the list. It is a safety net behind our other defences (we already escape all text).
 *
 * The most important directive is `script-src`. We use a NONCE: a random value, different for
 * every request, that the server puts in the header AND on its own legitimate script tags. Only
 * scripts carrying the matching nonce run. An attacker cannot guess a value that changes on every
 * request. (`'strict-dynamic'` lets those trusted scripts load their own helpers.)
 *
 * This file is a PURE function: it only builds a string from the options it is given. That makes
 * the policy easy to read and easy to test. src/proxy.ts calls it once per request.
 */

export interface CspOptions {
  /** The random per-request value that marks our own scripts as trusted. */
  nonce: string;
  /** True while running `next dev`. Development needs a few extra permissions (see below). */
  isDevelopment: boolean;
  /** True in a production deployment (served over HTTPS). */
  isProduction: boolean;
  /** True when Cloudinary photo hosting is configured, so its addresses must be allowed. */
  usesCloudinary: boolean;
}

/** Joins the parts of one directive into text, for example `img-src 'self' data:`. */
function directive(name: string, ...values: string[]): string {
  return [name, ...values].join(" ");
}

/**
 * The policy as one header value. Each line below is one directive; the comments explain why
 * each address is allowed. Everything not listed is blocked (`default-src 'self'`).
 */
export function buildContentSecurityPolicy(options: CspOptions): string {
  const { nonce, isDevelopment, isProduction, usesCloudinary } = options;

  const directives: string[] = [
    // Anything not covered by a more specific rule below may only come from our own site.
    directive("default-src", "'self'"),

    // SCRIPTS: the strictest rule. Our own files, plus scripts bearing this request's nonce.
    // In development only, Next.js/React use `eval` for readable error messages, so allow it there.
    directive("script-src", "'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(isDevelopment ? ["'unsafe-eval'"] : [])),

    // STYLES: our own stylesheet, plus inline styles. We deliberately allow inline styles
    // (without a nonce): injected CSS is far less dangerous than injected scripts, and this keeps
    // the map library (Leaflet) and Next.js's own styling working. Scripts stay strict.
    directive("style-src", "'self'", "'unsafe-inline'"),

    // IMAGES: our own site (including the local dev photo store), inline data/blob images (the
    // browser shrinks photos before upload), the OpenStreetMap map tiles, and Cloudinary photos.
    directive(
      "img-src",
      "'self'",
      "data:",
      "blob:",
      "https://tile.openstreetmap.org",
      ...(usesCloudinary ? ["https://res.cloudinary.com"] : []),
    ),

    // NETWORK REQUESTS from page scripts: our own site, and Cloudinary's upload address (photos
    // are uploaded straight from the browser to Cloudinary, ADR 0008). In development Next.js also
    // opens a websocket for live reload.
    directive("connect-src", "'self'", ...(usesCloudinary ? ["https://api.cloudinary.com"] : []), ...(isDevelopment ? ["ws:", "wss:"] : [])),

    // We use only system fonts, so fonts can only come from our own site.
    directive("font-src", "'self'"),

    // No plugins (Flash, Java applets, PDF viewers embedded in the page).
    directive("object-src", "'none'"),

    // Stops an attacker changing where relative links point, and where forms can send data.
    directive("base-uri", "'self'"),
    directive("form-action", "'self'"),

    // Nobody may put our pages inside a frame on another site (clickjacking protection).
    directive("frame-ancestors", "'none'"),

    // In production, quietly upgrade any accidental http:// request to https://. Not in local
    // development, where the site runs over plain http.
    ...(isProduction ? ["upgrade-insecure-requests"] : []),
  ];

  return directives.join("; ");
}

/** A fresh random nonce, base64-encoded as the Next.js docs recommend. */
export function generateNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString("base64");
}
