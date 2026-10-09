/**
 * Rules for the platform-admin screens (ADR 0014), written as plain functions with no database.
 *
 * Every form on the admin screens sends text and numbers typed by a person. Before anything is
 * saved, it passes through a function here that either returns a cleaned-up VALID value or says
 * exactly what is wrong. Keeping these rules in one pure file means they are easy to read,
 * easy to test, and impossible to forget when a new screen is added.
 */
import { AGENCY_TYPES, type AgencyType } from "./agency-types";
import { sanitizeDescription, textLength } from "./reports/new-report";

/**
 * The kinds of administrative change that are written to the audit log.
 * Each is "what happened to what", for example "agency.created" or "sla_policy.updated".
 */
export const AUDIT_ACTIONS = [
  "agency.created",
  "agency.updated",
  "coverage.added",
  "coverage.removed",
  "coverage.priority_changed",
  "sla_policy.updated",
  "category.activated",
  "category.deactivated",
  "staff.invited",
  "staff.deactivated",
  "staff.reactivated",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

// ---- Agencies ----------------------------------------------------------------------------

export const AGENCY_NAME_MIN = 2;
export const AGENCY_NAME_MAX = 100;

export type AgencyInputIssue = "name_invalid" | "type_invalid";

export type AgencyInputResult =
  | { ok: true; value: { name: string; type: AgencyType } }
  | { ok: false; issue: AgencyInputIssue };

/**
 * Cleans and checks an agency's name and type.
 * Cleaning: removes invisible/control characters, turns any run of spaces or line breaks into a
 * single space (a name is one line), and trims the ends.
 */
export function validateAgencyInput(input: { name: unknown; type: unknown }): AgencyInputResult {
  if (typeof input.name !== "string") return { ok: false, issue: "name_invalid" };
  // sanitizeDescription removes control characters; then we squash all whitespace to single spaces.
  const name = sanitizeDescription(input.name).replace(/\s+/g, " ");
  const length = textLength(name);
  if (length < AGENCY_NAME_MIN || length > AGENCY_NAME_MAX) return { ok: false, issue: "name_invalid" };

  // `includes` on the official list means only the six real agency types are accepted.
  if (typeof input.type !== "string" || !(AGENCY_TYPES as readonly string[]).includes(input.type)) {
    return { ok: false, issue: "type_invalid" };
  }
  return { ok: true, value: { name, type: input.type as AgencyType } };
}

// ---- Coverage priority -------------------------------------------------------------------

export const PRIORITY_MIN = 0;
export const PRIORITY_MAX = 1000;

/**
 * When two agencies cover the same place, the LOWER priority number wins (docs/routing.md).
 * Accepts a whole number from 0 to 1000; returns null for anything else.
 */
export function validatePriority(input: unknown): number | null {
  return typeof input === "number" && Number.isInteger(input) && input >= PRIORITY_MIN && input <= PRIORITY_MAX
    ? input
    : null;
}

// ---- SLA policy --------------------------------------------------------------------------

export const SLA_ACK_MIN_MINUTES = 5;
export const SLA_ACK_MAX_MINUTES = 30 * 24 * 60; // 30 days
export const SLA_RESOLVE_MAX_MINUTES = 365 * 24 * 60; // one year
export const SLA_NOTE_MIN = 5;
export const SLA_NOTE_MAX = 500;

export type SlaPolicyIssue = "ack_invalid" | "resolve_invalid" | "resolve_before_ack" | "note_invalid";

export type SlaPolicyInputResult =
  | { ok: true; value: { ackMinutes: number; resolveMinutes: number; note: string } }
  | { ok: false; issue: SlaPolicyIssue };

/**
 * Checks new SLA durations (in minutes) and the required explanation note.
 * Sensible limits stop a typing slip (for example 1 minute, or 100 years) from becoming policy.
 * The note is required so the audit log always records WHY a deadline changed.
 */
export function validateSlaPolicyInput(input: {
  ackMinutes: unknown;
  resolveMinutes: unknown;
  note: unknown;
}): SlaPolicyInputResult {
  const { ackMinutes, resolveMinutes } = input;
  if (
    typeof ackMinutes !== "number" ||
    !Number.isInteger(ackMinutes) ||
    ackMinutes < SLA_ACK_MIN_MINUTES ||
    ackMinutes > SLA_ACK_MAX_MINUTES
  ) {
    return { ok: false, issue: "ack_invalid" };
  }
  if (
    typeof resolveMinutes !== "number" ||
    !Number.isInteger(resolveMinutes) ||
    resolveMinutes > SLA_RESOLVE_MAX_MINUTES
  ) {
    return { ok: false, issue: "resolve_invalid" };
  }
  // Resolving can never be due before acknowledging: that would make no sense to an agency.
  if (resolveMinutes < ackMinutes) return { ok: false, issue: "resolve_before_ack" };

  if (typeof input.note !== "string") return { ok: false, issue: "note_invalid" };
  const note = sanitizeDescription(input.note).replace(/\s+/g, " ");
  const noteLength = textLength(note);
  if (noteLength < SLA_NOTE_MIN || noteLength > SLA_NOTE_MAX) return { ok: false, issue: "note_invalid" };

  return { ok: true, value: { ackMinutes, resolveMinutes, note } };
}

/**
 * One plain sentence describing an SLA change, for the audit log, for example:
 *   "acknowledge 1440 -> 720 min; resolve 20160 -> 4320 min. Reason: faster targets agreed".
 */
export function describeSlaChange(
  before: { ackMinutes: number; resolveMinutes: number },
  after: { ackMinutes: number; resolveMinutes: number },
  note: string,
): string {
  return (
    `acknowledge ${before.ackMinutes} -> ${after.ackMinutes} min; ` +
    `resolve ${before.resolveMinutes} -> ${after.resolveMinutes} min. Reason: ${note}`
  );
}
