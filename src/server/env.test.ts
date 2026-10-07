import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

describe("parseEnv", () => {
  it("accepts a valid environment", () => {
    expect(parseEnv({ DATABASE_URL: "postgres://x" }).DATABASE_URL).toBe("postgres://x");
  });

  it("names the missing variable without echoing values", () => {
    expect(() => parseEnv({})).toThrow("DATABASE_URL");
  });
});
