/**
 * Small, pure helpers for the agency performance dashboards (ADR 0014).
 *
 * The dashboards answer questions like "what share of reports did this agency acknowledge on
 * time in the last 30 days?". The DATABASE does the counting (it is much faster at that), and
 * this file does the careful arithmetic on the counts: percentages, rounding, how to treat
 * "nothing to measure yet", and which time window "the last 30 days" means.
 *
 * "Pure" means no database, no network and no reading of the real clock: every function here
 * just turns the values it is given into a result, so each one is easy to test.
 */
import type { Clock } from "./clock";

/** The time windows the dashboards offer, in days. */
export const PERFORMANCE_WINDOWS = [30, 90] as const;
export type PerformanceWindowDays = (typeof PERFORMANCE_WINDOWS)[number];
export const DEFAULT_PERFORMANCE_WINDOW: PerformanceWindowDays = 30;

/**
 * With very few measurements a percentage is misleading: 1 on time out of 1 is "100%" but says
 * almost nothing. Below this many finished timers the dashboard still shows the counts but warns
 * that the sample is small.
 */
export const MIN_RELIABLE_SAMPLE = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The start of "the last N days": exactly N x 24 hours before now.
 * An outcome counts if it happened at or after this instant (so the very first instant of the
 * window is included; one second earlier is not).
 */
export function windowStart(days: PerformanceWindowDays, clock: Clock): Date {
  return new Date(clock.now().getTime() - days * DAY_MS);
}

/**
 * Turns the number from a web address (for example "?days=90") into a valid window.
 * Anything unexpected falls back to the default instead of causing an error, because the value
 * comes from a URL that anyone can edit by hand.
 */
export function parseWindow(input: unknown): PerformanceWindowDays {
  const asNumber = typeof input === "string" ? Number(input) : input;
  return (PERFORMANCE_WINDOWS as readonly unknown[]).includes(asNumber)
    ? (asNumber as PerformanceWindowDays)
    : DEFAULT_PERFORMANCE_WINDOW;
}

/**
 * "part out of whole" as a percentage rounded to the nearest whole number.
 * Returns null (not 0, and not NaN) when there is nothing to measure, so the page can say
 * "no data yet" instead of showing a misleading 0% or a broken number.
 */
export function percentOf(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return Math.round((part / whole) * 100);
}

/** The summary of one kind of timer (acknowledge or resolve) for one agency over a window. */
export interface TimerSummary {
  /** How many timers of this kind were finished in the window. */
  total: number;
  /** How many of those were finished on or before the deadline. */
  met: number;
  /** `met` as a whole-number percentage, or null if `total` is zero. */
  onTimePercent: number | null;
  /** The middle value of "how long it took", in whole minutes, or null if none finished. */
  medianMinutes: number | null;
  /** True when there are too few measurements to trust the percentage (see MIN_RELIABLE_SAMPLE). */
  lowSample: boolean;
}

/**
 * Builds a TimerSummary from the raw counts the database returned.
 * `medianSeconds` is what the database computed; we convert to whole minutes for display.
 */
export function summariseTimer(total: number, met: number, medianSeconds: number | null): TimerSummary {
  return {
    total,
    met,
    onTimePercent: percentOf(met, total),
    medianMinutes: medianSeconds === null ? null : Math.round(medianSeconds / 60),
    lowSample: total < MIN_RELIABLE_SAMPLE,
  };
}

/**
 * Share of resolutions that the resident then said were NOT fixed.
 * disputes / resolutions, as a whole-number percentage, or null when nothing was resolved.
 */
export function disputeRatePercent(disputes: number, resolutions: number): number | null {
  return percentOf(disputes, resolutions);
}

/** Everything the dashboard shows about one agency over one window. */
export interface AgencyPerformance {
  agencyId: string;
  agencyName: string;
  acknowledge: TimerSummary;
  resolve: TimerSummary;
  /** Reports the agency currently holds that still have a running timer. */
  openReports: number;
  /** Of those, how many are past a deadline right now. */
  openOverdue: number;
  /** Reports resolved in the window (the denominator for the dispute rate). */
  resolutions: number;
  /** Resolutions the resident disputed in the window. */
  disputes: number;
  disputeRatePercent: number | null;
}

/**
 * Turns a number of minutes into short words a person can read at a glance:
 *   45   -> "45 min"          150   -> "2 h 30 min"          1500  -> "1 d 1 h"
 * Returns "No data" for null (nothing was measured). Used for the "median time" columns.
 */
export function formatDuration(minutes: number | null): string {
  if (minutes === null) return "No data";
  if (minutes < 1) return "under 1 min";
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) {
    // Leave out "0 min" so exact hours read cleanly: "3 h", not "3 h 0 min".
    return remainingMinutes === 0 ? `${hours} h` : `${hours} h ${remainingMinutes} min`;
  }

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours === 0 ? `${days} d` : `${days} d ${remainingHours} h`;
}
