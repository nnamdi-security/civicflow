import { isAgencyRole, type Role } from "../roles";
import { REPORT_STATUSES, type ReportStatus } from "./status";

/** Who is attempting a transition. `system` is routing and (later) timers. */
export type TransitionActor =
  | { kind: "system" }
  | { kind: "user"; role: Role; agencyId: string | null; isReporter: boolean };

export interface TransitionRequest {
  from: ReportStatus;
  to: ReportStatus;
  actor: TransitionActor;
  /** The agency the report is currently assigned to, if any. */
  reportAgencyId: string | null;
  reason?: string | null;
}

export type TransitionDenial =
  | "not_allowed"
  | "forbidden"
  | "reason_required";

export type TransitionResult =
  | { ok: true; from: ReportStatus; to: ReportStatus; reason: string | null }
  | { ok: false; denial: TransitionDenial };

export const MAX_REASON_LENGTH = 500;

/** The edges of the state machine (docs/domain-model.md). `rejected` is handled separately. */
const FORWARD: Readonly<Record<ReportStatus, readonly ReportStatus[]>> = {
  submitted: ["routed"],
  routed: ["acknowledged"],
  acknowledged: ["in_progress"],
  in_progress: ["resolved"],
  resolved: ["confirmed", "disputed"],
  confirmed: [],
  disputed: ["in_progress"],
  rejected: [],
};

const NOT_REJECTABLE: readonly ReportStatus[] = ["confirmed", "rejected"];

/** Every statically allowed (from, to) pair, including rejection. */
export function allowedTargets(from: ReportStatus): ReportStatus[] {
  const targets = [...FORWARD[from]];
  if (!NOT_REJECTABLE.includes(from)) targets.push("rejected");
  return targets;
}

export function isAllowedTransition(from: ReportStatus, to: ReportStatus): boolean {
  return allowedTargets(from).includes(to);
}

function isPlatformAdmin(actor: TransitionActor): boolean {
  return actor.kind === "user" && actor.role === "platform_admin";
}

function isAssignedAgencyStaff(actor: TransitionActor, reportAgencyId: string | null): boolean {
  return (
    actor.kind === "user" &&
    isAgencyRole(actor.role) &&
    reportAgencyId !== null &&
    actor.agencyId === reportAgencyId
  );
}

function isStaffFor(actor: TransitionActor, reportAgencyId: string | null): boolean {
  return isPlatformAdmin(actor) || isAssignedAgencyStaff(actor, reportAgencyId);
}

function mayPerform(req: TransitionRequest): boolean {
  const { from, to, actor, reportAgencyId } = req;
  if (to === "rejected") return isStaffFor(actor, reportAgencyId);
  if (from === "submitted" && to === "routed") return actor.kind === "system" || isPlatformAdmin(actor);
  if (from === "resolved" && (to === "confirmed" || to === "disputed")) {
    return actor.kind === "user" && actor.isReporter;
  }
  return isStaffFor(actor, reportAgencyId);
}

/**
 * Validates a status change. Pure: callers persist the result (and its StatusEvent) themselves.
 * Checks the table first so an impossible move is "not_allowed" for everyone, then authority.
 */
export function validateTransition(req: TransitionRequest): TransitionResult {
  if (!isAllowedTransition(req.from, req.to)) return { ok: false, denial: "not_allowed" };
  if (!mayPerform(req)) return { ok: false, denial: "forbidden" };

  const reason = req.reason?.trim() ? req.reason.trim() : null;
  if (req.to === "rejected" && (reason === null || reason.length > MAX_REASON_LENGTH)) {
    return { ok: false, denial: "reason_required" };
  }
  return { ok: true, from: req.from, to: req.to, reason };
}

export const ALL_STATUS_PAIRS: ReadonlyArray<readonly [ReportStatus, ReportStatus]> = REPORT_STATUSES.flatMap(
  (from) => REPORT_STATUSES.map((to) => [from, to] as const),
);
