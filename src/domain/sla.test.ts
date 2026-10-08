import { describe, expect, it } from "vitest";
import { fixedClock } from "./clock";
import { REPORT_STATUSES } from "./reports/status";
import {
  ESCALATION_LADDER,
  NO_TIMERS,
  currentLevel,
  escalationLevelsDue,
  isOverdue,
  timersAfterEntering,
  type SlaPolicy,
  type TimerState,
} from "./sla";

const POLICY: SlaPolicy = { ackMinutes: 24 * 60, resolveMinutes: 7 * 24 * 60 };
const T0 = new Date("2026-03-01T09:00:00Z");
const HOUR = 3_600_000;

const clockAt = (at: Date) => fixedClock(at);
const plus = (date: Date, ms: number) => new Date(date.getTime() + ms);

describe("timersAfterEntering: routed", () => {
  it("starts both timers from now and begins cycle 1", () => {
    const state = timersAfterEntering("routed", NO_TIMERS, POLICY, clockAt(T0));
    expect(state).toEqual({
      ackDueAt: new Date("2026-03-02T09:00:00Z"),
      resolveDueAt: new Date("2026-03-08T09:00:00Z"),
      slaCycle: 1,
    });
  });

  it("is UTC arithmetic: a deadline spanning a DST change elsewhere does not shift", () => {
    const start = new Date("2026-03-28T23:30:00Z");
    const state = timersAfterEntering("routed", NO_TIMERS, { ackMinutes: 60, resolveMinutes: 120 }, clockAt(start));
    expect(state.ackDueAt?.toISOString()).toBe("2026-03-29T00:30:00.000Z");
    expect(state.resolveDueAt?.toISOString()).toBe("2026-03-29T01:30:00.000Z");
  });

  it("restarts both timers and bumps the cycle on reassignment", () => {
    const first = timersAfterEntering("routed", NO_TIMERS, POLICY, clockAt(T0));
    const later = plus(T0, 10 * HOUR);
    const second = timersAfterEntering("routed", first, POLICY, clockAt(later));
    expect(second.slaCycle).toBe(2);
    expect(second.ackDueAt).toEqual(plus(later, 24 * HOUR));
    expect(second.resolveDueAt).toEqual(plus(later, 7 * 24 * HOUR));
  });
});

describe("timersAfterEntering: later states", () => {
  const routed = timersAfterEntering("routed", NO_TIMERS, POLICY, clockAt(T0));
  const clock = clockAt(plus(T0, 5 * HOUR));

  it("stops acknowledgement on acknowledged and keeps the resolve deadline", () => {
    expect(timersAfterEntering("acknowledged", routed, POLICY, clock)).toEqual({ ...routed, ackDueAt: null });
  });

  it("changes nothing on in_progress", () => {
    const acked = timersAfterEntering("acknowledged", routed, POLICY, clock);
    expect(timersAfterEntering("in_progress", acked, POLICY, clock)).toEqual(acked);
  });

  it("stops everything on resolved, confirmed, rejected and submitted, keeping the cycle", () => {
    for (const status of ["resolved", "confirmed", "rejected", "submitted"] as const) {
      expect(timersAfterEntering(status, routed, POLICY, clock)).toEqual({
        ackDueAt: null,
        resolveDueAt: null,
        slaCycle: routed.slaCycle,
      });
    }
  });

  it("restarts only the resolve timer on dispute, from the dispute moment, in a new cycle", () => {
    const resolved = timersAfterEntering("resolved", routed, POLICY, clock);
    const disputeAt = plus(T0, 3 * 24 * HOUR);
    const disputed = timersAfterEntering("disputed", resolved, POLICY, clockAt(disputeAt));
    expect(disputed).toEqual({
      ackDueAt: null,
      resolveDueAt: plus(disputeAt, 7 * 24 * HOUR),
      slaCycle: resolved.slaCycle + 1,
    });
  });

  it("does not restart the timer again when a disputed report is reopened", () => {
    const disputed: TimerState = { ackDueAt: null, resolveDueAt: plus(T0, 100 * HOUR), slaCycle: 2 };
    expect(timersAfterEntering("in_progress", disputed, POLICY, clockAt(plus(T0, 50 * HOUR)))).toEqual(disputed);
  });

  it("handles every status without throwing", () => {
    for (const status of REPORT_STATUSES) {
      expect(() => timersAfterEntering(status, routed, POLICY, clock)).not.toThrow();
    }
  });
});

describe("isOverdue", () => {
  const due = new Date("2026-03-02T09:00:00Z");

  it("is not overdue one second before, nor at the exact deadline", () => {
    expect(isOverdue(due, clockAt(plus(due, -1000)))).toBe(false);
    expect(isOverdue(due, clockAt(due))).toBe(false);
  });

  it("is overdue one second after", () => {
    expect(isOverdue(due, clockAt(plus(due, 1000)))).toBe(true);
  });

  it("is never overdue without a running timer", () => {
    expect(isOverdue(null, clockAt(plus(due, 1_000_000_000)))).toBe(false);
  });
});

describe("escalation ladder", () => {
  const due = new Date("2026-03-02T09:00:00Z");
  const at = (ms: number) => clockAt(plus(due, ms));

  it("has no levels while the timer is stopped", () => {
    expect(escalationLevelsDue(null, at(100 * HOUR))).toEqual([]);
    expect(currentLevel(null, at(100 * HOUR))).toBeNull();
  });

  it("reaches level 1 strictly after the deadline", () => {
    expect(escalationLevelsDue(due, at(-1000))).toEqual([]);
    expect(escalationLevelsDue(due, at(0))).toEqual([]);
    expect(escalationLevelsDue(due, at(1000))).toEqual([1]);
  });

  it("reaches level 2 strictly after 24 hours", () => {
    const day = ESCALATION_LADDER[2].delayMs;
    expect(escalationLevelsDue(due, at(day - 1000))).toEqual([1]);
    expect(escalationLevelsDue(due, at(day))).toEqual([1]);
    expect(escalationLevelsDue(due, at(day + 1000))).toEqual([1, 2]);
  });

  it("reaches level 3 strictly after 72 hours and reports the highest level", () => {
    const limit = ESCALATION_LADDER[3].delayMs;
    expect(escalationLevelsDue(due, at(limit))).toEqual([1, 2]);
    expect(escalationLevelsDue(due, at(limit + 1000))).toEqual([1, 2, 3]);
    expect(currentLevel(due, at(limit + 1000))).toBe(3);
    expect(currentLevel(due, at(1000))).toBe(1);
    expect(currentLevel(due, at(0))).toBeNull();
  });

  it("orders the ladder by increasing delay", () => {
    const delays = [1, 2, 3].map((level) => ESCALATION_LADDER[level as 1 | 2 | 3].delayMs);
    expect(delays).toEqual([...delays].sort((a, b) => a - b));
  });
});
