/** Unit tests for the retention periods and cut-off calculation. */
import { describe, expect, it } from "vitest";
import { fixedClock } from "./clock";
import { RETENTION_DAYS, retentionCutoff } from "./retention";

describe("retention periods (provisional, ADR 0015)", () => {
  it("match the documented policy", () => {
    expect(RETENTION_DAYS).toEqual({ rateLimits: 7, notificationsDelivered: 90, notificationsFailed: 180 });
  });

  it("keep failed notification records longer than delivered ones", () => {
    expect(RETENTION_DAYS.notificationsFailed).toBeGreaterThan(RETENTION_DAYS.notificationsDelivered);
  });
});

describe("retentionCutoff", () => {
  const now = new Date("2026-06-30T12:00:00Z");

  it("is exactly N days before now", () => {
    expect(retentionCutoff(7, fixedClock(now)).toISOString()).toBe("2026-06-23T12:00:00.000Z");
    expect(retentionCutoff(90, fixedClock(now)).toISOString()).toBe("2026-04-01T12:00:00.000Z");
  });

  it("moves with the clock", () => {
    const clock = fixedClock(now);
    const before = retentionCutoff(7, clock).getTime();
    clock.advance(24 * 60 * 60 * 1000);
    expect(retentionCutoff(7, clock).getTime()).toBe(before + 24 * 60 * 60 * 1000);
  });
});
