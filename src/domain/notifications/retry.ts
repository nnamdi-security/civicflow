import type { Clock } from "../clock";

/** Wait after the Nth failed attempt before trying again (ADR 0011). */
export const RETRY_DELAYS_MINUTES = [1, 5, 30, 120] as const;
/** The first attempt plus one retry per delay. */
export const MAX_ATTEMPTS = RETRY_DELAYS_MINUTES.length + 1;

/**
 * When to try again after `attemptsMade` failed attempts, or null to give up. Permanent
 * failures should not call this: they are marked failed straight away.
 */
export function nextAttemptAt(attemptsMade: number, clock: Clock): Date | null {
  const delay = RETRY_DELAYS_MINUTES[attemptsMade - 1];
  if (attemptsMade < 1 || delay === undefined) return null;
  return new Date(clock.now().getTime() + delay * 60_000);
}
