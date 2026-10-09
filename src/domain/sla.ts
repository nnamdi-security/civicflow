/**
 * SLA = "service level agreement": the deadlines an agency is held to.
 *
 * Every report that has been sent to an agency gets two stopwatches ("timers"):
 *   - the ACKNOWLEDGE timer: how long the agency has to say "we have seen this";
 *   - the RESOLVE timer:     how long the agency has to say "we have fixed this".
 *
 * This file is the pure rulebook for those timers. "Pure" means it only does maths on the
 * values it is given: it never reads the database, never calls the network, and never asks the
 * computer what time it is. Instead it is handed a `Clock` (see clock.ts), which makes it easy to
 * test (tests can freeze time) and impossible to get wrong by reading the time in two places.
 *
 * Where it fits: the database code in src/server/repositories/report-workflow.ts calls these
 * functions each time a report changes status, then saves what they return.
 *
 * The rules themselves are written down in docs/sla-and-escalation.md and ADR 0010 / 0014.
 */
import type { Clock } from "./clock";
import type { ReportStatus } from "./reports/status";

/**
 * How long an agency gets, for one category of report (for example "Roads").
 * The real numbers live in the `sla_policies` database table. Both are in minutes,
 * so 24 hours is written as 24 * 60 = 1440.
 */
export interface SlaPolicy {
  ackMinutes: number;
  resolveMinutes: number;
}

/** The two timers a report can have. `as const` makes TypeScript treat these as exact words. */
export const SLA_TIMERS = ["acknowledge", "resolve"] as const;
/** "acknowledge" or "resolve" - derived from the list above so the two can never disagree. */
export type SlaTimer = (typeof SLA_TIMERS)[number];

/**
 * Everything the report row stores about its timers.
 * A deadline of `null` means "that timer is not running right now".
 */
export interface TimerState {
  /** Deadline for acknowledging, or null if the acknowledge timer is not running. */
  ackDueAt: Date | null;
  /** Deadline for resolving, or null if the resolve timer is not running. */
  resolveDueAt: Date | null;
  /**
   * Counts how many times the timers have been (re)started: routing, reassignment and a
   * dispute each start a new "cycle". The number lets an escalation recorded in an old cycle
   * stay separate from one in the new cycle, so an old record never blocks a new one.
   */
  slaCycle: number;
  /**
   * When the timers of the current cycle started. Needed to measure "how long did the agency
   * take?" for the dashboards. It is set whenever a cycle starts and is only null while no
   * timer has ever run (the database enforces: a running timer always has a start time).
   */
  startedAt: Date | null;
}

/** The starting state of a brand-new report: nothing running, cycle zero. */
export const NO_TIMERS: TimerState = { ackDueAt: null, resolveDueAt: null, slaCycle: 0, startedAt: null };

// Handy constants so the maths below reads clearly instead of using bare numbers like 60000.
const MINUTE_MS = 60_000; // milliseconds in one minute
const HOUR_MS = 60 * MINUTE_MS;

/** Returns a NEW date `minutes` after `from`. (JavaScript dates are in milliseconds, hence * MINUTE_MS.) */
function addMinutes(from: Date, minutes: number): Date {
  return new Date(from.getTime() + minutes * MINUTE_MS);
}

/**
 * Works out what the timers should look like AFTER a report enters the status `to`.
 *
 * Think of it as the stopwatch rules in one place:
 *   - routed:       both timers start now, and a new cycle begins.
 *                   (Reassigning a report to another agency is also "entering routed",
 *                   so it restarts both timers for the new agency.)
 *   - acknowledged: the acknowledge timer stops. The resolve deadline stays as it was.
 *   - in_progress:  nothing changes. (After a dispute, the resolve timer was already
 *                   restarted at the dispute, so reopening must not restart it again.)
 *   - disputed:     the resident says "not fixed". Only the resolve timer restarts, from now,
 *                   in a new cycle.
 *   - resolved, confirmed, rejected, submitted: everything stops.
 *
 * This function only RETURNS the new state; the caller is responsible for saving it.
 */
export function timersAfterEntering(
  to: ReportStatus,
  current: TimerState,
  policy: SlaPolicy,
  clock: Clock,
): TimerState {
  // Read the time exactly once, so every value below agrees about what "now" is.
  const now = clock.now();

  // `switch` picks the branch matching the new status. TypeScript checks that every possible
  // status is handled, so adding a new status later forces someone to decide its timer rule.
  switch (to) {
    case "routed":
      return {
        ackDueAt: addMinutes(now, policy.ackMinutes),
        resolveDueAt: addMinutes(now, policy.resolveMinutes),
        slaCycle: current.slaCycle + 1,
        startedAt: now,
      };
    case "acknowledged":
      // `...current` copies every field, then we override just the one we want to change.
      return { ...current, ackDueAt: null };
    case "in_progress":
      return current;
    case "disputed":
      return {
        ackDueAt: null,
        resolveDueAt: addMinutes(now, policy.resolveMinutes),
        slaCycle: current.slaCycle + 1,
        startedAt: now,
      };
    case "submitted":
    case "resolved":
    case "confirmed":
    case "rejected":
      // All four of these mean "no timer should be running". We keep slaCycle and startedAt
      // as a record of the last cycle; only the deadlines are cleared.
      return { ...current, ackDueAt: null, resolveDueAt: null };
  }
}

/**
 * One finished timer, ready to be saved as a row in the `sla_outcomes` table so that the
 * dashboards can later say "this agency met 80% of its deadlines".
 */
export interface SlaOutcome {
  timer: SlaTimer;
  /** Which cycle of timers this belongs to (see `TimerState.slaCycle`). */
  slaCycle: number;
  startedAt: Date;
  dueAt: Date;
  stoppedAt: Date;
  /** True if the agency finished at or before the deadline. */
  met: boolean;
}

/**
 * If entering `to` stops a running timer because the agency did its job, describe the result.
 *
 * Only two things count as the agency "doing its job":
 *   - entering `acknowledged` stops the acknowledge timer;
 *   - entering `resolved` stops the resolve timer.
 * Everything else that stops a timer (a rejection, a reassignment, a dispute) deliberately
 * produces NO outcome, so it neither helps nor hurts the agency's score (ADR 0014).
 *
 * Returns the outcome, or null when there is nothing to record.
 */
export function outcomeForEntering(to: ReportStatus, current: TimerState, clock: Clock): SlaOutcome | null {
  // Decide which timer this status change would stop, and read that timer's deadline.
  let timer: SlaTimer;
  let dueAt: Date | null;
  if (to === "acknowledged") {
    timer = "acknowledge";
    dueAt = current.ackDueAt;
  } else if (to === "resolved") {
    timer = "resolve";
    dueAt = current.resolveDueAt;
  } else {
    return null; // This status change does not finish either timer.
  }

  // The timer was not running (already stopped), so there is nothing to measure.
  if (dueAt === null) return null;

  // The database guarantees a running timer has a start time. If this ever fails, the data is
  // corrupt, and it is better to say so loudly than to save a wrong number.
  if (current.startedAt === null) {
    throw new Error("A running SLA timer has no start time");
  }

  const stoppedAt = clock.now();
  return {
    timer,
    slaCycle: current.slaCycle,
    startedAt: current.startedAt,
    dueAt,
    stoppedAt,
    // `<=` is deliberate: finishing EXACTLY on the deadline still counts as on time.
    // (Being overdue starts one instant AFTER the deadline - see `isOverdue` below.)
    met: stoppedAt.getTime() <= dueAt.getTime(),
  };
}

/**
 * Is this deadline in the past right now?
 * A deadline is overdue STRICTLY AFTER it passes: at the exact deadline instant it is not yet
 * overdue. A `null` deadline means the timer is not running, so it can never be overdue.
 */
export function isOverdue(dueAt: Date | null, clock: Clock): boolean {
  return dueAt !== null && clock.now().getTime() > dueAt.getTime();
}

/** The three escalation levels: how far an overdue report has been pushed up the chain. */
export const ESCALATION_LEVELS = [1, 2, 3] as const;
export type EscalationLevel = (typeof ESCALATION_LEVELS)[number];

/**
 * PROVISIONAL escalation ladder (ADR 0010): for each level, how long after the missed deadline
 * it applies and who gets told. These numbers are placeholders until real targets are agreed.
 *   level 1: at the deadline          -> agency admin
 *   level 2: 24 hours after           -> platform admin
 *   level 3: 72 hours after           -> the report becomes publicly overdue
 */
export const ESCALATION_LADDER: Readonly<Record<EscalationLevel, { delayMs: number; target: string }>> = {
  1: { delayMs: 0, target: "agency_admin" },
  2: { delayMs: 24 * HOUR_MS, target: "platform_admin" },
  3: { delayMs: 72 * HOUR_MS, target: "public_overdue" },
};

/**
 * Every escalation level whose time has strictly passed, lowest first.
 * Example: a deadline 30 hours ago returns [1, 2]; 80 hours ago returns [1, 2, 3].
 * Callers record each level at most once (the database prevents duplicates).
 */
export function escalationLevelsDue(dueAt: Date | null, clock: Clock): EscalationLevel[] {
  if (dueAt === null) return [];
  const now = clock.now().getTime();
  // Keep a level only if "now" is strictly later than deadline + that level's delay.
  return ESCALATION_LEVELS.filter((level) => now > dueAt.getTime() + ESCALATION_LADDER[level].delayMs);
}

/** The highest escalation level already reached, or null when nothing is overdue. */
export function currentLevel(dueAt: Date | null, clock: Clock): EscalationLevel | null {
  const due = escalationLevelsDue(dueAt, clock);
  return due.at(-1) ?? null; // `.at(-1)` means "the last item", or undefined if the list is empty
}

/** Which running timers are past their deadline right now (possibly none, one or both). */
export function overdueTimers(state: Pick<TimerState, "ackDueAt" | "resolveDueAt">, clock: Clock): SlaTimer[] {
  const overdue: SlaTimer[] = [];
  if (isOverdue(state.ackDueAt, clock)) overdue.push("acknowledge");
  if (isOverdue(state.resolveDueAt, clock)) overdue.push("resolve");
  return overdue;
}
