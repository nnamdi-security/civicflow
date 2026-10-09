/**
 * Unit tests for the dashboard arithmetic in performance.ts. No database is involved: each test
 * hands a function some numbers and checks the answer, especially the awkward edges (nothing to
 * measure, the exact start of a window, rounding).
 */
import { describe, expect, it } from "vitest";
import { fixedClock } from "./clock";
import {
  DEFAULT_PERFORMANCE_WINDOW,
  MIN_RELIABLE_SAMPLE,
  disputeRatePercent,
  parseWindow,
  percentOf,
  summariseTimer,
  windowStart,
} from "./performance";

describe("percentOf", () => {
  it("rounds to the nearest whole number", () => {
    expect(percentOf(1, 3)).toBe(33); // 33.33...
    expect(percentOf(2, 3)).toBe(67); // 66.66...
    expect(percentOf(1, 2)).toBe(50);
    expect(percentOf(3, 3)).toBe(100);
    expect(percentOf(0, 4)).toBe(0);
  });

  it("returns null, not 0 or NaN, when there is nothing to measure", () => {
    expect(percentOf(0, 0)).toBeNull();
    expect(percentOf(5, 0)).toBeNull();
    expect(percentOf(1, -1)).toBeNull();
  });
});

describe("summariseTimer", () => {
  it("fills in the percentage and converts the median to whole minutes", () => {
    expect(summariseTimer(10, 8, 5400)).toEqual({
      total: 10,
      met: 8,
      onTimePercent: 80,
      medianMinutes: 90, // 5400 seconds = 90 minutes
      lowSample: false,
    });
  });

  it("rounds the median to the nearest minute", () => {
    expect(summariseTimer(10, 5, 89)?.medianMinutes).toBe(1); // 1.48 -> 1
    expect(summariseTimer(10, 5, 91)?.medianMinutes).toBe(2); // 1.52 -> 2
  });

  it("copes with no finished timers at all", () => {
    expect(summariseTimer(0, 0, null)).toEqual({
      total: 0,
      met: 0,
      onTimePercent: null,
      medianMinutes: null,
      lowSample: true,
    });
  });

  it("warns about a small sample just below the threshold, and not at it", () => {
    expect(summariseTimer(MIN_RELIABLE_SAMPLE - 1, 4, 60).lowSample).toBe(true);
    expect(summariseTimer(MIN_RELIABLE_SAMPLE, 4, 60).lowSample).toBe(false);
  });
});

describe("disputeRatePercent", () => {
  it("is disputes as a share of resolutions", () => {
    expect(disputeRatePercent(1, 4)).toBe(25);
    expect(disputeRatePercent(0, 10)).toBe(0);
  });

  it("is null when nothing was resolved", () => {
    expect(disputeRatePercent(0, 0)).toBeNull();
  });
});

describe("windowStart", () => {
  const now = new Date("2026-04-30T12:00:00Z");

  it("is exactly N days before now", () => {
    expect(windowStart(30, fixedClock(now)).toISOString()).toBe("2026-03-31T12:00:00.000Z");
    expect(windowStart(90, fixedClock(now)).toISOString()).toBe("2026-01-30T12:00:00.000Z");
  });
});

describe("parseWindow", () => {
  it("accepts the offered windows, as numbers or as text from a URL", () => {
    expect(parseWindow(30)).toBe(30);
    expect(parseWindow("90")).toBe(90);
  });

  it("falls back to the default for anything else", () => {
    for (const bad of [undefined, null, "", "abc", "7", 7, "30; drop table", 0, NaN]) {
      expect(parseWindow(bad)).toBe(DEFAULT_PERFORMANCE_WINDOW);
    }
  });
});
