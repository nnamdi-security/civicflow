/**
 * Accepts only same-site relative paths for post-sign-in redirects, so a crafted link cannot
 * send a user to another site. Anything else falls back to `fallback`.
 */
export function safeRedirectPath(value: unknown, fallback = "/account"): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 200) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  // Control characters and backslashes are treated as separators by some browsers.
  if (/[\u0000-\u001F\u007F\\]/.test(value)) return fallback;
  // Never bounce back into the auth endpoints.
  if (value.startsWith("/api/auth")) return fallback;
  return value;
}
