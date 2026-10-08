import { z } from "zod";
import type { Db } from "../../db/client";
import type { Clock } from "../../domain/clock";
import { canReassignReports } from "../../domain/permissions";
import { MAX_REASON_LENGTH, validateReassignment } from "../../domain/reports/transitions";
import { ForbiddenError, UnauthenticatedError } from "../auth/errors";
import type { AuthenticatedActor } from "../auth/session-user";
import {
  agencyExists,
  applyStatusChange,
  findReportForWorkflow,
  insertAssignment,
} from "../repositories/report-workflow";
import { canSeeReport, toTransitionActor } from "./change-status";

export interface ReassignDeps {
  db: Db;
  clock: Clock;
}

const inputSchema = z.object({
  reportId: z.uuid(),
  agencyId: z.uuid(),
  reason: z.string().trim().max(MAX_REASON_LENGTH).optional(),
});

export type ReassignResult =
  | { ok: true }
  | { ok: false; reason: "malformed" | "not_found" | "forbidden" | "not_allowed" | "unknown_agency" | "same_agency" | "conflict" };

/**
 * Hands a report to an agency: first routing out of triage, or moving it between agencies.
 * Writes an assignment and a status event, and returns the report to `routed` so the new
 * agency acknowledges afresh (SLA timers restart in Phase 5).
 */
export async function reassignReport(
  deps: ReassignDeps,
  actor: AuthenticatedActor | null,
  raw: unknown,
): Promise<ReassignResult> {
  if (!actor) throw new UnauthenticatedError();
  if (!canReassignReports(actor)) throw new ForbiddenError();
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "malformed" };
  const input = parsed.data;

  const report = await findReportForWorkflow(deps.db, input.reportId);
  if (!report || !canSeeReport(actor, report)) return { ok: false, reason: "not_found" };

  const check = validateReassignment({
    from: report.status,
    actor: toTransitionActor(actor, report),
    reportAgencyId: report.agencyId,
  });
  if (!check.ok) return { ok: false, reason: check.denial };
  if (report.agencyId === input.agencyId) return { ok: false, reason: "same_agency" };
  if (!(await agencyExists(deps.db, input.agencyId))) return { ok: false, reason: "unknown_agency" };

  const reason = input.reason ? `reassigned: ${input.reason}` : "reassigned";
  const applied = await deps.db.transaction(async (tx) => {
    const moved = await applyStatusChange(
      tx,
      {
        reportId: report.id,
        from: check.from,
        to: check.to,
        actorId: actor.userId,
        reason,
        agencyId: input.agencyId,
      },
      deps.clock,
    );
    if (!moved) return false;
    await insertAssignment(tx, {
      reportId: report.id,
      agencyId: input.agencyId,
      assignedBy: actor.userId,
      reason,
    });
    return true;
  });
  return applied ? { ok: true } : { ok: false, reason: "conflict" };
}
