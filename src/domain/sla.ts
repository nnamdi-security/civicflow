import type { Clock } from "./clock";
import type { ReportStatus } from "./reports/status";

/** Durations for one category. Placeholder values live in the `sla_policies` table (ADR 0010). */
export interface SlaPolicy {
  ackMinutes: number;
  resolveMinutes: number;
}

export const SLA_TIMERS = ["acknowledge", "resolve"] as const;
export type SlaTimer = (typeof SLA_TIMERS)[number];

/** What the report row stores. A null deadline means that timer is not running. */
export interface TimerState {
  ackDueAt: Date | null;
  resolveDueAt: Date | null;
  /** Increments each time timers restart, so an escalation from an old cycle never blocks a new one. */
  slaCycle: number;
}

export const NO_TIMERS: TimerState = { ackDueAt: null, resolveDueAt: null, slaCycle: 0 };

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

function addMinutes(from: Date, minutes: number): Date {
  return new Date(from.getTime() + minutes * MINUTE_MS);
}

/**
 * Timer state after a report enters `to` (docs/sla-and-escalation.md). Pure: the caller
 * persists the result. Reassignment is a move to `routed`, so it restarts both timers.
 *
 * - routed: both timers start now (new cycle).
 * - acknowledged: acknowledgement stops; resolution keeps its deadline.
 * - in_progress: nothing changes (a reopen after a dispute keeps the timer restarted at the dispute).
 * - disputed: resolution restarts now (new cycle).
 * - resolved, confirmed, rejected: everything stops.
 */
export function timersAfterEntering(
  to: ReportStatus,
  current: TimerState,
  policy: SlaPolicy,
  clock: Clock,
): TimerState {
  const now = clock.now();
  switch (to) {
    case "routed":
      return {
        ackDueAt: addMinutes(now, policy.ackMinutes),
        resolveDueAt: addMinutes(now, policy.resolveMinutes),
        slaCycle: current.slaCycle + 1,
      };
    case "acknowledged":
      return { ...current, ackDueAt: null };
    case "in_progress":
      return current;
    case "disputed":
      return { ackDueAt: null, resolveDueAt: addMinutes(now, policy.resolveMinutes), slaCycle: current.slaCycle + 1 };
    case "submitted":
    case "resolved":
    case "confirmed":
    case "rejected":
      return { ...current, ackDueAt: null, resolveDueAt: null };
  }
}

/** A deadline is overdue strictly after it: at the exact instant it is not yet overdue. */
export function isOverdue(dueAt: Date | null, clock: Clock): boolean {
  return dueAt !== null && clock.now().getTime() > dueAt.getTime();
}

export const ESCALATION_LEVELS = [1, 2, 3] as const;
export type EscalationLevel = (typeof ESCALATION_LEVELS)[number];

/** PROVISIONAL ladder (ADR 0010): delay after the missed deadline before each level applies. */
export const ESCALATION_LADDER: Readonly<Record<EscalationLevel, { delayMs: number; target: string }>> = {
  1: { delayMs: 0, target: "agency_admin" },
  2: { delayMs: 24 * HOUR_MS, target: "platform_admin" },
  3: { delayMs: 72 * HOUR_MS, target: "public_overdue" },
};

/** Every ladder level whose time has strictly passed. Callers record each at most once. */
export function escalationLevelsDue(dueAt: Date | null, clock: Clock): EscalationLevel[] {
  if (dueAt === null) return [];
  const now = clock.now().getTime();
  return ESCALATION_LEVELS.filter((level) => now > dueAt.getTime() + ESCALATION_LADDER[level].delayMs);
}

/** The highest level already reached; null when no timer is overdue. */
export function currentLevel(dueAt: Date | null, clock: Clock): EscalationLevel | null {
  const due = escalationLevelsDue(dueAt, clock);
  return due.at(-1) ?? null;
}
