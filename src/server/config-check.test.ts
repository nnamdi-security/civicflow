/**
 * Unit tests for the production configuration checker. They start from a fully valid set of
 * settings, then break ONE thing at a time and check that exactly the right setting is flagged.
 * The most important property tested last: the checker never reveals a secret's value.
 */
import { describe, expect, it } from "vitest";
import { checkProductionConfig, isLaunchReady, type ConfigFinding } from "./config-check";

/** A complete, valid production configuration, made of obviously fake values. */
const GOOD: Record<string, string> = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://app:R4nd0mDbP4ss@db.internal.example:5432/civicflow",
  AUTH_SECRET: "k9Gx2LmQ7vTz4WbN8cYdR1sFhJpA6eUo3XiZ5qVtBwE=",
  AUTH_URL: "https://civicflow.example.ng",
  RESEND_API_KEY: "re_live_fake_key",
  EMAIL_FROM: "CivicFlow <no-reply@civicflow.example.ng>",
  CLOUDINARY_CLOUD_NAME: "civicflow",
  CLOUDINARY_API_KEY: "123456",
  CLOUDINARY_API_SECRET: "fake-cloudinary-secret",
  TERMII_API_KEY: "TLfakekey",
  TERMII_SENDER_ID: "CivicFlow",
};

const statusOf = (findings: ConfigFinding[], setting: string) => findings.find((f) => f.setting === setting)?.status;
const failures = (findings: ConfigFinding[]) => findings.filter((f) => f.status === "fail").map((f) => f.setting);
const check = (overrides: Record<string, string | undefined>) => checkProductionConfig({ ...GOOD, ...overrides });

describe("a complete production configuration", () => {
  it("passes everything and is ready for launch", () => {
    const findings = checkProductionConfig(GOOD);
    expect(failures(findings)).toEqual([]);
    expect(findings.filter((f) => f.status === "warn")).toEqual([]);
    expect(isLaunchReady(findings)).toBe(true);
  });
});

describe("breaking one setting at a time", () => {
  it("flags development mode", () => {
    expect(failures(check({ NODE_ENV: "development" }))).toEqual(["NODE_ENV"]);
    expect(failures(check({ NODE_ENV: undefined }))).toEqual(["NODE_ENV"]);
  });

  it("flags a missing database, the development password and localhost", () => {
    expect(failures(check({ DATABASE_URL: undefined }))).toEqual(["DATABASE_URL"]);
    expect(failures(check({ DATABASE_URL: "postgres://civicflow:civicflow_dev_only@db.example:5432/x" }))).toEqual(["DATABASE_URL"]);
    expect(failures(check({ DATABASE_URL: "postgres://app:pw@localhost:5432/x" }))).toEqual(["DATABASE_URL"]);
    expect(failures(check({ DATABASE_URL: "postgresql://app:pw@127.0.0.1:5432/x" }))).toEqual(["DATABASE_URL"]);
  });

  it("flags a missing, short or placeholder secret", () => {
    expect(failures(check({ AUTH_SECRET: undefined }))).toEqual(["AUTH_SECRET"]);
    expect(failures(check({ AUTH_SECRET: "too-short" }))).toEqual(["AUTH_SECRET"]);
    expect(failures(check({ AUTH_SECRET: "x".repeat(40) }))).toEqual(["AUTH_SECRET"]);
    expect(failures(check({ AUTH_SECRET: "ab".repeat(20) }))).toEqual(["AUTH_SECRET"]);
    expect(failures(check({ AUTH_SECRET: "changeme-changeme-changeme-changeme-123" }))).toEqual(["AUTH_SECRET"]);
  });

  it("accepts a secret of exactly 32 characters", () => {
    expect(statusOf(check({ AUTH_SECRET: "k9Gx2LmQ7vTz4WbN8cYdR1sFhJpA6eUo" }), "AUTH_SECRET")).toBe("pass");
    expect(statusOf(check({ AUTH_SECRET: "k9Gx2LmQ7vTz4WbN8cYdR1sFhJpA6eU" }), "AUTH_SECRET")).toBe("fail"); // 31
  });

  it("flags a site address that is missing, not https, not a URL, or localhost", () => {
    for (const bad of [undefined, "http://civicflow.example.ng", "civicflow.example.ng", "not a url", "https://localhost:3000", "https://127.0.0.1", "https://app.local"]) {
      expect(failures(check({ AUTH_URL: bad })), String(bad)).toEqual(["AUTH_URL"]);
    }
  });

  it("flags missing email settings and a malformed sender", () => {
    expect(failures(check({ RESEND_API_KEY: undefined }))).toEqual(["RESEND_API_KEY"]);
    expect(failures(check({ EMAIL_FROM: undefined }))).toEqual(["EMAIL_FROM"]);
    expect(failures(check({ EMAIL_FROM: "no-at-sign" }))).toEqual(["EMAIL_FROM"]);
  });

  it("treats blank values like missing ones, as the app does (KEY= in a settings file)", () => {
    const found = failures(check({ RESEND_API_KEY: "", AUTH_SECRET: "   " }));
    expect(found.sort()).toEqual(["AUTH_SECRET", "RESEND_API_KEY"]);
  });

  it("names exactly which Cloudinary settings are missing", () => {
    const findings = check({ CLOUDINARY_API_KEY: undefined, CLOUDINARY_API_SECRET: "" });
    expect(failures(findings)).toEqual(["CLOUDINARY_*"]);
    const message = findings.find((f) => f.setting === "CLOUDINARY_*")?.message ?? "";
    expect(message).toContain("CLOUDINARY_API_KEY");
    expect(message).toContain("CLOUDINARY_API_SECRET");
    expect(message).not.toContain("CLOUDINARY_CLOUD_NAME");
  });
});

describe("optional and cautionary settings", () => {
  it("only warns when SMS is not configured, and still allows launch", () => {
    const findings = check({ TERMII_API_KEY: undefined, TERMII_SENDER_ID: undefined });
    expect(statusOf(findings, "TERMII_*")).toBe("warn");
    expect(isLaunchReady(findings)).toBe(true);
  });

  it("fails when only half of the SMS settings are set", () => {
    expect(failures(check({ TERMII_SENDER_ID: undefined }))).toEqual(["TERMII_*"]);
    expect(failures(check({ TERMII_API_KEY: undefined }))).toEqual(["TERMII_*"]);
  });

  it("warns when the public overdue board is on, passes when off or unset, and fails for nonsense", () => {
    expect(statusOf(check({ PUBLIC_OVERDUE_BOARD: "true" }), "PUBLIC_OVERDUE_BOARD")).toBe("warn");
    expect(statusOf(check({ PUBLIC_OVERDUE_BOARD: "false" }), "PUBLIC_OVERDUE_BOARD")).toBe("pass");
    expect(statusOf(check({ PUBLIC_OVERDUE_BOARD: undefined }), "PUBLIC_OVERDUE_BOARD")).toBe("pass");
    expect(statusOf(check({ PUBLIC_OVERDUE_BOARD: "yes" }), "PUBLIC_OVERDUE_BOARD")).toBe("fail");
  });
});

describe("launch readiness", () => {
  it("is not ready if anything fails, and ready with only warnings", () => {
    expect(isLaunchReady(check({ AUTH_URL: undefined }))).toBe(false);
    expect(isLaunchReady(check({ PUBLIC_OVERDUE_BOARD: "true", TERMII_API_KEY: undefined, TERMII_SENDER_ID: undefined }))).toBe(true);
  });

  it("reports nothing as ready for an empty environment", () => {
    const findings = checkProductionConfig({});
    expect(isLaunchReady(findings)).toBe(false);
    expect(failures(findings).length).toBeGreaterThanOrEqual(7);
  });
});

describe("secrets never appear in the output", () => {
  it("contains no setting VALUE in any message, for good or bad configurations", () => {
    const secrets = [
      GOOD.AUTH_SECRET,
      GOOD.RESEND_API_KEY,
      GOOD.CLOUDINARY_API_KEY,
      GOOD.CLOUDINARY_API_SECRET,
      GOOD.TERMII_API_KEY,
      "R4nd0mDbP4ss",
      "db.internal.example",
    ];
    const everything = [
      ...checkProductionConfig(GOOD),
      ...check({ AUTH_SECRET: "short", DATABASE_URL: "postgres://app:R4nd0mDbP4ss@localhost/x", AUTH_URL: "http://civicflow.example.ng" }),
    ];
    const text = JSON.stringify(everything);
    for (const secret of secrets) expect(text, secret).not.toContain(secret ?? "");
  });
});
