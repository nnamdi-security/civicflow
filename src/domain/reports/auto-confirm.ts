import type { Clock } from "../clock";

/** PROVISIONAL (ADR 0013): days a report may sit `resolved` before the system confirms it. */
export const AUTO_CONFIRM_DAYS = 14;
export const AUTO_CONFIRM_REASON = `auto-confirmed after ${AUTO_CONFIRM_DAYS} days`;

const DAY_MS = 24 * 60 * 60 * 1000;

export function autoConfirmDueAt(resolvedAt: Date): Date {
  return new Date(resolvedAt.getTime() + AUTO_CONFIRM_DAYS * DAY_MS);
}

/** Due strictly after 14 days: at exactly 14 days the resident can still answer. */
export function isAutoConfirmDue(resolvedAt: Date | null, clock: Clock): boolean {
  return resolvedAt !== null && clock.now().getTime() > autoConfirmDueAt(resolvedAt).getTime();
}

/**
 * Reports resolved strictly before this instant are due. Same rule as `isAutoConfirmDue`, in a
 * form a database query can use to narrow candidates.
 */
export function autoConfirmCutoff(clock: Clock): Date {
  return new Date(clock.now().getTime() - AUTO_CONFIRM_DAYS * DAY_MS);
}
