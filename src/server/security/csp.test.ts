/**
 * Unit tests for the Content Security Policy builder. They read the generated header text and
 * check the properties that matter for security, for example that scripts can never run without
 * the nonce, and that nothing is wide open.
 */
import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy, generateNonce, type CspOptions } from "./csp";

const production: CspOptions = { nonce: "abc123", isDevelopment: false, isProduction: true, usesCloudinary: true };
const development: CspOptions = { nonce: "abc123", isDevelopment: true, isProduction: false, usesCloudinary: false };

/** Splits a header into { directiveName: [values...] } so tests can look at one directive at a time. */
function parse(policy: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const part of policy.split(";")) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) out[name] = values;
  }
  return out;
}

describe("buildContentSecurityPolicy (production)", () => {
  const policy = parse(buildContentSecurityPolicy(production));

  it("only runs scripts from our own site or carrying this request's nonce", () => {
    expect(policy["script-src"]).toEqual(["'self'", "'nonce-abc123'", "'strict-dynamic'"]);
  });

  it("never allows inline or eval scripts in production", () => {
    for (const value of policy["script-src"] ?? []) {
      expect(value).not.toBe("'unsafe-inline'");
      expect(value).not.toBe("'unsafe-eval'");
    }
  });

  it("falls back to our own site for everything not listed", () => {
    expect(policy["default-src"]).toEqual(["'self'"]);
  });

  it("allows only the map tiles and Cloudinary photos as outside image sources", () => {
    expect(policy["img-src"]).toEqual([
      "'self'",
      "data:",
      "blob:",
      "https://tile.openstreetmap.org",
      "https://res.cloudinary.com",
    ]);
  });

  it("allows uploads to Cloudinary and nothing else off-site", () => {
    expect(policy["connect-src"]).toEqual(["'self'", "https://api.cloudinary.com"]);
  });

  it("blocks plugins, framing, and changes to base address or form targets", () => {
    expect(policy["object-src"]).toEqual(["'none'"]);
    expect(policy["frame-ancestors"]).toEqual(["'none'"]);
    expect(policy["base-uri"]).toEqual(["'self'"]);
    expect(policy["form-action"]).toEqual(["'self'"]);
  });

  it("upgrades insecure requests only in production", () => {
    expect(buildContentSecurityPolicy(production)).toContain("upgrade-insecure-requests");
    expect(buildContentSecurityPolicy(development)).not.toContain("upgrade-insecure-requests");
  });

  it("uses no wildcard anywhere, and no plain 'http:' or 'https:' blanket source", () => {
    const text = buildContentSecurityPolicy(production);
    expect(text).not.toMatch(/(^|\s)\*(\s|;|$)/);
    expect(text).not.toMatch(/(^|\s)https?:(\s|;|$)/);
  });
});

describe("buildContentSecurityPolicy (development and options)", () => {
  it("adds eval and the live-reload websocket only in development", () => {
    const policy = parse(buildContentSecurityPolicy(development));
    expect(policy["script-src"]).toContain("'unsafe-eval'");
    expect(policy["connect-src"]).toEqual(expect.arrayContaining(["'self'", "ws:", "wss:"]));
  });

  it("leaves Cloudinary out when it is not configured", () => {
    const text = buildContentSecurityPolicy({ ...production, usesCloudinary: false });
    expect(text).not.toContain("cloudinary");
  });

  it("puts the given nonce in the policy", () => {
    expect(buildContentSecurityPolicy({ ...production, nonce: "xyz789" })).toContain("'nonce-xyz789'");
  });
});

describe("generateNonce", () => {
  it("produces a different value every time", () => {
    const values = new Set(Array.from({ length: 50 }, () => generateNonce()));
    expect(values.size).toBe(50);
  });

  it("is base64 text with no characters that could break out of the header", () => {
    expect(generateNonce()).toMatch(/^[A-Za-z0-9+/=]+$/);
  });
});
