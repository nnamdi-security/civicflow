import { describe, expect, it } from "vitest";
import { parseEnv, parseProxyEnv, parsePublicEnv } from "./env";

describe("parseEnv", () => {
  it("accepts a valid environment", () => {
    expect(parseEnv({ DATABASE_URL: "postgres://x" }).DATABASE_URL).toBe("postgres://x");
  });

  it("treats blank values, as left by `KEY=` in .env.example, as unset", async () => {
    const { parseAuthEnv, parseMediaEnv } = await import("./env");
    const blank = { AUTH_SECRET: "x".repeat(32), RESEND_API_KEY: "", EMAIL_FROM: "" };
    expect(parseAuthEnv(blank).RESEND_API_KEY).toBeUndefined();
    const media = parseMediaEnv({
      AUTH_SECRET: "x".repeat(32),
      CLOUDINARY_CLOUD_NAME: "",
      CLOUDINARY_API_KEY: "",
      CLOUDINARY_API_SECRET: "",
    });
    expect(media.CLOUDINARY_CLOUD_NAME).toBeUndefined();
    expect(() => parseEnv({ DATABASE_URL: "" })).toThrow("DATABASE_URL");
  });

  it("names the missing variable without echoing values", () => {
    expect(() => parseEnv({})).toThrow("DATABASE_URL");
  });
});

describe("parsePublicEnv", () => {
  it("keeps the overdue board off unless it is explicitly switched on (ADR 0013)", () => {
    expect(parsePublicEnv({})).toEqual({ overdueBoard: false });
    expect(parsePublicEnv({ PUBLIC_OVERDUE_BOARD: "" })).toEqual({ overdueBoard: false });
    expect(parsePublicEnv({ PUBLIC_OVERDUE_BOARD: "false" })).toEqual({ overdueBoard: false });
    expect(parsePublicEnv({ PUBLIC_OVERDUE_BOARD: "true" })).toEqual({ overdueBoard: true });
  });

  it("rejects anything else rather than guessing", () => {
    expect(() => parsePublicEnv({ PUBLIC_OVERDUE_BOARD: "yes" })).toThrow("PUBLIC_OVERDUE_BOARD");
  });
});

describe("parseProxyEnv", () => {
  it("assumes exactly one trusted proxy when not set", () => {
    expect(parseProxyEnv({})).toEqual({ trustedProxyHops: 1 });
    expect(parseProxyEnv({ TRUSTED_PROXY_HOPS: "" })).toEqual({ trustedProxyHops: 1 });
  });

  it("accepts 0 to 5 and rejects anything else rather than guessing", () => {
    expect(parseProxyEnv({ TRUSTED_PROXY_HOPS: "0" })).toEqual({ trustedProxyHops: 0 });
    expect(parseProxyEnv({ TRUSTED_PROXY_HOPS: "2" })).toEqual({ trustedProxyHops: 2 });
    for (const bad of ["-1", "6", "1.5", "two"]) {
      expect(() => parseProxyEnv({ TRUSTED_PROXY_HOPS: bad })).toThrow("TRUSTED_PROXY_HOPS");
    }
  });
});
