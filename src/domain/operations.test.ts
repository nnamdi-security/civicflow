/**
 * Unit tests for the worker health rules. Time is frozen with a fake clock, and the boundaries
 * (exactly at the limit, one second over) are checked, because "late" is a judgement made on a
 * threshold and off-by-one mistakes there cause false alarms or missed outages.
 */
import { describe, expect, it } from "vitest";
import { fixedClock } from "./clock";
import {
  JOB_DESCRIPTIONS,
  JOB_EXPECTED_MINUTES,
  JOB_NAMES,
  LATE_AFTER_INTERVALS,
  assessJob,
  assessWorker,
  type JobHealth,
} from "./operations";

const NOW = new Date("2026-06-30T12:00:00Z");
const MINUTE = 60_000;
const ranAgo = (ms: number, lastStatus: "ok" | "error" = "ok") => ({ lastRunAt: new Date(NOW.getTime() - ms), lastStatus });

describe("job configuration", () => {
  it("covers every job with a schedule and a description", () => {
    for (const job of JOB_NAMES) {
      expect(JOB_EXPECTED_MINUTES[job]).toBeGreaterThan(0);
      expect(JOB_DESCRIPTIONS[job].length).toBeGreaterThan(5);
    }
  });

  it("matches the schedules registered with the worker", () => {
    expect(JOB_EXPECTED_MINUTES).toEqual({
      "sla-scan": 1,
      "notification-dispatch": 1,
      "auto-confirm": 60,
      retention: 1440,
      "media-cleanup": 5,
    });
  });
});

describe("assessJob", () => {
  const clock = fixedClock(NOW);

  it("says never_run when there is no heartbeat", () => {
    expect(assessJob("sla-scan", null, clock)).toBe("never_run");
  });

  it("is ok when the job ran recently", () => {
    expect(assessJob("sla-scan", ranAgo(30_000), clock)).toBe("ok");
  });

  it("is still ok exactly at the limit (3 intervals) and late one second after", () => {
    const limit = LATE_AFTER_INTERVALS * JOB_EXPECTED_MINUTES["sla-scan"] * MINUTE;
    expect(assessJob("sla-scan", ranAgo(limit), clock)).toBe("ok");
    expect(assessJob("sla-scan", ranAgo(limit + 1000), clock)).toBe("late");
  });

  it("allows each job its own interval: a daily job is not late after an hour", () => {
    expect(assessJob("retention", ranAgo(60 * MINUTE), clock)).toBe("ok");
    expect(assessJob("retention", ranAgo(LATE_AFTER_INTERVALS * 1440 * MINUTE + 1000), clock)).toBe("late");
    expect(assessJob("sla-scan", ranAgo(60 * MINUTE), clock)).toBe("late");
  });

  it("reports failing when the last run was an error, even if it was just now", () => {
    expect(assessJob("sla-scan", ranAgo(1000, "error"), clock)).toBe("failing");
  });

  it("reports failing rather than late for a job that has been erroring for a long time", () => {
    expect(assessJob("sla-scan", ranAgo(10 * 60 * MINUTE, "error"), clock)).toBe("failing");
  });
});

describe("assessWorker", () => {
  const all = (health: JobHealth): JobHealth[] => JOB_NAMES.map(() => health);

  it("is unknown when nothing has ever run", () => {
    expect(assessWorker(all("never_run"))).toBe("unknown");
  });

  it("is ok only when every job is ok", () => {
    expect(assessWorker(all("ok"))).toBe("ok");
  });

  it("is degraded when any job is late, failing, or missing while others ran", () => {
    for (const bad of ["late", "failing", "never_run"] as const) {
      expect(assessWorker(["ok", "ok", bad, "ok", "ok"])).toBe("degraded");
    }
  });

  it("handles an empty list as unknown rather than ok", () => {
    // `every` on an empty list is true, so this documents what happens: nothing to judge means unknown.
    expect(assessWorker([])).toBe("unknown");
  });
});
