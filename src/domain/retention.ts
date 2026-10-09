/**
 * How long different kinds of data are kept (ADR 0015, docs/security-privacy.md).
 *
 * "Retention" means deciding when old data that no longer has a purpose should be deleted.
 * Keeping personal data forever is a risk (it can leak) and, under data-protection law, usually
 * not allowed. These numbers are PROVISIONAL: they are sensible starting points that a
 * data-protection adviser should confirm before launch.
 *
 * Note what is NOT here, because it is deliberately kept: reports and their history (an
 * accountability record) and the audit log.
 */
import type { Clock } from "./clock";

export const RETENTION_DAYS = {
  /** Counters that slow down abuse; useless after their time window has long passed. */
  rateLimits: 7,
  /** Records of emails/SMS that were sent or skipped. They hold no message text (ADR 0011). */
  notificationsDelivered: 90,
  /** Records of messages that failed for good; kept a little longer so problems can be investigated. */
  notificationsFailed: 180,
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The cut-off instant for "older than N days". Data from strictly BEFORE this instant is old
 * enough to delete; data exactly at, or after, the instant is kept. (Being careful about the
 * boundary means a record is never deleted a moment too early.)
 */
export function retentionCutoff(days: number, clock: Clock): Date {
  return new Date(clock.now().getTime() - days * DAY_MS);
}
