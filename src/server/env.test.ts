import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

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
