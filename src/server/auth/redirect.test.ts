import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "./redirect";

describe("safeRedirectPath", () => {
  it("keeps same-site relative paths, including query strings", () => {
    expect(safeRedirectPath("/report/new")).toBe("/report/new");
    expect(safeRedirectPath("/reports/abc?x=1#top")).toBe("/reports/abc?x=1#top");
  });

  it("falls back for absolute and protocol-relative URLs", () => {
    expect(safeRedirectPath("https://evil.example/")).toBe("/account");
    expect(safeRedirectPath("//evil.example/")).toBe("/account");
    expect(safeRedirectPath("/\\evil.example")).toBe("/account");
    expect(safeRedirectPath("javascript:alert(1)")).toBe("/account");
  });

  it("falls back for control characters, backslashes and non-strings", () => {
    expect(safeRedirectPath("/a\nb")).toBe("/account");
    expect(safeRedirectPath("/a\\b")).toBe("/account");
    expect(safeRedirectPath(undefined)).toBe("/account");
    expect(safeRedirectPath(["/x"])).toBe("/account");
    expect(safeRedirectPath("")).toBe("/account");
  });

  it("falls back for the auth endpoints and overlong values", () => {
    expect(safeRedirectPath("/api/auth/signout")).toBe("/account");
    expect(safeRedirectPath(`/${"a".repeat(300)}`)).toBe("/account");
  });

  it("uses a custom fallback", () => {
    expect(safeRedirectPath("nope", "/")).toBe("/");
  });
});
