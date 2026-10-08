import type { Tx } from "../../db/client";
import type { Clock } from "../../domain/clock";
import { validateTransition } from "../../domain/reports/transitions";
import { pickAgency, routingReason } from "../../domain/routing";
import { applyStatusChange, insertAssignment } from "../repositories/report-workflow";
import { findRoutingInput } from "../repositories/routing";

export type RouteOutcome = { routed: true; agencyId: string } | { routed: false };

/**
 * Automatic routing for a report still in `submitted`. Runs inside the caller's transaction
 * (ADR 0009). With no matching agency the report stays `submitted` with no agency: that is
 * the platform triage queue. Safe to call twice: the compare-and-set makes the second a no-op.
 */
export async function routeNewReport(tx: Tx, clock: Clock, reportId: string): Promise<RouteOutcome> {
  const decision = pickAgency(await findRoutingInput(tx, reportId));
  if (decision.kind === "triage") return { routed: false };

  const reason = routingReason(decision);
  const check = validateTransition({
    from: "submitted",
    to: "routed",
    actor: { kind: "system" },
    reportAgencyId: null,
  });
  if (!check.ok) throw new Error(`Routing transition rejected: ${check.denial}`);

  const applied = await applyStatusChange(tx, {
    reportId,
    from: "submitted",
    to: "routed",
    actorId: null,
    reason,
    agencyId: decision.agencyId,
    markRouted: { at: clock.now() },
  });
  if (!applied) return { routed: false };

  await insertAssignment(tx, { reportId, agencyId: decision.agencyId, assignedBy: null, reason });
  return { routed: true, agencyId: decision.agencyId };
}
