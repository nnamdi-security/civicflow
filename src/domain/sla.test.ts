/**
 * Unit tests for the SLA timer rules in sla.ts.
 *
 * A "unit test" checks one small piece of code in isolation. These tests need no database:
 * they freeze time with `fixedClock` and check what the pure functions return. Each `it(...)`
 * block states one fact about the rules; if the rules change by accident, the matching test fails.
 */
import { describe, expect, it } from "vitest";
import { fixedClock } from "./clock";
import { REPORT_STATUSES } from "./reports/status";
import {
  ESCALATION_LADDER,
  NO_TIMERS,
  currentLevel,
  escalationLevelsDue,
  isOverdue,
  outcomeForEntering,
  overdueTimers,
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
      // The new field: when this cycle of timers began (used to measure how long the agency took).
      startedAt: T0,
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
    expect(second.startedAt).toEqual(later); // the new cycle starts at the reassignment, not at the first routing
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
        startedAt: routed.startedAt, // kept as a record of the last cycle
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
      startedAt: disputeAt, // a dispute starts a fresh cycle, measured from the dispute
    });
  });

  it("does not restart the timer again when a disputed report is reopened", () => {
    const disputed: TimerState = { ackDueAt: null, resolveDueAt: plus(T0, 100 * HOUR), slaCycle: 2, startedAt: T0 };
    expect(timersAfterEntering("in_progress", disputed, POLICY, clockAt(plus(T0, 50 * HOUR)))).toEqual(disputed);
  });

  it("handles every status without throwing", () => {
    for (const status of REPORT_STATUSES) {
      expect(() => timersAfterEntering(status, routed, POLICY, clock)).not.toThrow();
    }
  });
});

// -------------------------------------------------------------------------------------------
// Outcomes: when an agency finishes a timer, did it make the deadline? (ADR 0014)
// -------------------------------------------------------------------------------------------
describe("outcomeForEntering", () => {
  // A report routed at T0 with a 24-hour acknowledge deadline and a 7-day resolve deadline.
  const routed = timersAfterEntering("routed", NO_TIMERS, POLICY, clockAt(T0));
  const ackDue = routed.ackDueAt as Date; // we know it is set because we just routed the report

  it("is met when the agency acknowledges well before the deadline", () => {
    const outcome = outcomeForEntering("acknowledged", routed, clockAt(plus(T0, 2 * HOUR)));
    expect(outcome).toEqual({
      timer: "acknowledge",
      slaCycle: 1,
      startedAt: T0,
      dueAt: ackDue,
      stoppedAt: plus(T0, 2 * HOUR),
      met: true,
    });
  });

  it("is still met exactly on the deadline, and missed one second later", () => {
    // This pair of checks pins down the boundary: the deadline instant itself is on time.
    expect(outcomeForEntering("acknowledged", routed, clockAt(ackDue))?.met).toBe(true);
    expect(outcomeForEntering("acknowledged", routed, clockAt(plus(ackDue, 1000)))?.met).toBe(false);
    expect(outcomeForEntering("acknowledged", routed, clockAt(plus(ackDue, -1000)))?.met).toBe(true);
  });

  it("measures the resolve timer when the report is resolved", () => {
    const acked = timersAfterEntering("acknowledged", routed, POLICY, clockAt(plus(T0, HOUR)));
    const outcome = outcomeForEntering("resolved", acked, clockAt(plus(T0, 3 * 24 * HOUR)));
    expect(outcome).toMatchObject({ timer: "resolve", met: true, startedAt: T0, dueAt: routed.resolveDueAt });
  });

  it("is missed when resolved after the resolve deadline", () => {
    const outcome = outcomeForEntering("resolved", routed, clockAt(plus(T0, 8 * 24 * HOUR)));
    expect(outcome?.met).toBe(false);
  });

  it("produces nothing for changes that end a timer without the agency finishing it", () => {
    // Rejection, dispute, reassignment ("routed"), confirmation, and in_progress do not
    // count for or against the agency.
    for (const status of ["rejected", "disputed", "routed", "confirmed", "in_progress", "submitted"] as const) {
      expect(outcomeForEntering(status, routed, clockAt(plus(T0, HOUR)))).toBeNull();
    }
  });

  it("produces nothing when the timer being stopped was not running", () => {
    const acked = timersAfterEntering("acknowledged", routed, POLICY, clockAt(plus(T0, HOUR)));
    // The acknowledge timer is already off, so entering "acknowledged" again records nothing.
    expect(outcomeForEntering("acknowledged", acked, clockAt(plus(T0, 2 * HOUR)))).toBeNull();
  });

  it("refuses to guess if a running timer has no start time (corrupt data)", () => {
    const broken: TimerState = { ...routed, startedAt: null };
    expect(() => outcomeForEntering("acknowledged", broken, clockAt(plus(T0, HOUR)))).toThrow();
  });

  it("records a dispute cycle separately from the first cycle", () => {
    // After a dispute, the resolve timer is a NEW cycle, so its outcome carries cycle 2.
    const resolvedOnce = timersAfterEntering("resolved", routed, POLICY, clockAt(plus(T0, 3 * HOUR)));
    const disputed = timersAfterEntering("disputed", resolvedOnce, POLICY, clockAt(plus(T0, 24 * HOUR)));
    const outcome = outcomeForEntering("resolved", disputed, clockAt(plus(T0, 30 * HOUR)));
    expect(outcome).toMatchObject({ slaCycle: 2, startedAt: plus(T0, 24 * HOUR), met: true });
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

describe("overdueTimers", () => {
  const ack = new Date("2026-03-02T09:00:00Z");
  const resolve = new Date("2026-03-08T09:00:00Z");

  it("lists only the timers strictly past their deadline", () => {
    expect(overdueTimers({ ackDueAt: ack, resolveDueAt: resolve }, clockAt(ack))).toEqual([]);
    expect(overdueTimers({ ackDueAt: ack, resolveDueAt: resolve }, clockAt(plus(ack, 1000)))).toEqual(["acknowledge"]);
    expect(overdueTimers({ ackDueAt: ack, resolveDueAt: resolve }, clockAt(plus(resolve, 1000)))).toEqual([
      "acknowledge",
      "resolve",
    ]);
  });

  it("skips stopped timers", () => {
    expect(overdueTimers({ ackDueAt: null, resolveDueAt: resolve }, clockAt(plus(resolve, 1000)))).toEqual(["resolve"]);
    expect(overdueTimers({ ackDueAt: null, resolveDueAt: null }, clockAt(plus(resolve, 1000)))).toEqual([]);
  });
});
