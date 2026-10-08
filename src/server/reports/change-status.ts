import { z } from "zod";
import type { Db } from "../../db/client";
import { REPORT_STATUSES, type ReportStatus } from "../../domain/reports/status";
import { MAX_REASON_LENGTH, validateTransition, type TransitionActor } from "../../domain/reports/transitions";
import { UnauthenticatedError } from "../auth/errors";
import type { AuthenticatedActor } from "../auth/session-user";
import { applyStatusChange, findReportForWorkflow, type WorkflowReport } from "../repositories/report-workflow";

export interface ChangeStatusDeps {
  db: Db;
}

/** `routed` is reached only by routing or reassignment, never by a plain status change. */
const TARGETS = REPORT_STATUSES.filter((status) => status !== "routed");

const inputSchema = z.object({
  reportId: z.uuid(),
  to: z.enum(TARGETS as [ReportStatus, ...ReportStatus[]]),
  reason: z.string().max(MAX_REASON_LENGTH * 2).optional(),
});

export type ChangeStatusResult =
  | { ok: true; status: ReportStatus }
  | { ok: false; reason: "malformed" | "not_found" | "forbidden" | "not_allowed" | "reason_required" | "conflict" };

/** Whether this actor may even know the report exists. Anything else answers "not found". */
export function canSeeReport(actor: AuthenticatedActor, report: WorkflowReport): boolean {
  if (actor.role === "platform_admin") return true;
  if (report.reporterId === actor.userId) return true;
  return (
    (actor.role === "agency_officer" || actor.role === "agency_admin") &&
    actor.agencyId !== null &&
    report.agencyId === actor.agencyId
  );
}

export function toTransitionActor(actor: AuthenticatedActor, report: WorkflowReport): TransitionActor {
  return { kind: "user", role: actor.role, agencyId: actor.agencyId, isReporter: report.reporterId === actor.userId };
}

/**
 * Moves a report along the state machine. Order: authenticate, validate input, load the
 * report within the actor's visibility, authorize via the domain, then persist with a
 * compare-and-set so two concurrent moves cannot both win.
 */
export async function changeReportStatus(
  deps: ChangeStatusDeps,
  actor: AuthenticatedActor | null,
  raw: unknown,
): Promise<ChangeStatusResult> {
  if (!actor) throw new UnauthenticatedError();
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "malformed" };
  const input = parsed.data;

  const report = await findReportForWorkflow(deps.db, input.reportId);
  if (!report || !canSeeReport(actor, report)) return { ok: false, reason: "not_found" };

  const check = validateTransition({
    from: report.status,
    to: input.to,
    actor: toTransitionActor(actor, report),
    reportAgencyId: report.agencyId,
    reason: input.reason,
  });
  if (!check.ok) return { ok: false, reason: check.denial };

  const applied = await deps.db.transaction((tx) =>
    applyStatusChange(tx, {
      reportId: report.id,
      from: check.from,
      to: check.to,
      actorId: actor.userId,
      reason: check.reason,
    }),
  );
  return applied ? { ok: true, status: check.to } : { ok: false, reason: "conflict" };
}
