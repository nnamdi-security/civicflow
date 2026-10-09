import type { NextConfig } from "next";

/**
 * Security headers sent with every response (Phase 8 Part B, docs/security-privacy.md).
 * The Content Security Policy is NOT here: it needs a fresh random value per request, so it is
 * built in src/proxy.ts. These headers are the same for everyone, so they live in the config.
 */
const isProduction = process.env.NODE_ENV === "production";

const securityHeaders = [
  // Browsers must trust the declared file type and not "sniff" a different one (stops a file
  // upload being run as a script).
  { key: "X-Content-Type-Options", value: "nosniff" },
  // When a visitor follows a link to another site, tell that site only OUR ADDRESS, never the
  // full page address (report links contain ids).
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Switch off browser features we never use. Location stays allowed for our own pages only:
  // the report form has a "use my location" button.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), payment=(), usb=(), geolocation=(self)" },
  // Older browsers' version of "do not let other sites frame our pages" (the CSP covers modern ones).
  { key: "X-Frame-Options", value: "DENY" },
  // Keep our pages in their own browsing context group, away from other sites' windows.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // HTTPS-only for 180 days. Sent only in production: the header is meaningless over plain http,
  // and a wrong HSTS on a development host would lock that host to https in your browser.
  ...(isProduction ? [{ key: "Strict-Transport-Security", value: "max-age=15552000" }] : []),
];

const nextConfig: NextConfig = {
  // Do not announce "X-Powered-By: Next.js" on every response: it only helps attackers pick tools.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
