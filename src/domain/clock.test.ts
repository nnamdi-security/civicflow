import { describe, expect, it } from "vitest";
import { fixedClock } from "./clock";

describe("fixedClock", () => {
  it("returns the configured instant until advanced", () => {
    const clock = fixedClock(new Date("2026-01-01T00:00:00Z"));
    expect(clock.now().toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("advances by the given milliseconds", () => {
    const clock = fixedClock(new Date("2026-01-01T00:00:00Z"));
    clock.advance(1000);
    expect(clock.now().toISOString()).toBe("2026-01-01T00:00:01.000Z");
  });
});
