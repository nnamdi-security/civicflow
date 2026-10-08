/** An agency of the right type covering a jurisdiction on the path from the report's point upward. */
export interface RoutingCandidate {
  agencyId: string;
  jurisdictionId: string;
  /** Parent hops from the finest jurisdiction covering the point: 0 = that jurisdiction itself. */
  hops: number;
  /** `agency_jurisdictions.priority`: lower wins. */
  priority: number;
}

export interface RoutingInput {
  candidates: readonly RoutingCandidate[];
  /** True when the point is covered by more than one finest-level jurisdiction (a shared boundary). */
  boundary: boolean;
}

export type RoutingDecision =
  | { kind: "agency"; agencyId: string; jurisdictionId: string; viaParent: boolean; boundary: boolean }
  | { kind: "triage" };

function compare(a: RoutingCandidate, b: RoutingCandidate): number {
  return (
    a.hops - b.hops ||
    a.priority - b.priority ||
    a.jurisdictionId.localeCompare(b.jurisdictionId) ||
    a.agencyId.localeCompare(b.agencyId)
  );
}

/**
 * Deterministic agency choice (docs/routing.md, ADR 0009): most specific jurisdiction first
 * (fewest parent hops), then priority, then jurisdiction id, then agency id. The same inputs
 * always give the same answer regardless of order. No candidates means the triage queue.
 */
export function pickAgency(input: RoutingInput): RoutingDecision {
  const [best] = [...input.candidates].sort(compare);
  if (!best) return { kind: "triage" };
  return {
    kind: "agency",
    agencyId: best.agencyId,
    jurisdictionId: best.jurisdictionId,
    viaParent: best.hops > 0,
    boundary: input.boundary,
  };
}

/** The reason text stored on the assignment and status event. No PII. */
export function routingReason(decision: Extract<RoutingDecision, { kind: "agency" }>): string {
  const parts = ["auto-routed"];
  if (decision.viaParent) parts.push("parent jurisdiction fallback");
  if (decision.boundary) parts.push("boundary case");
  return parts.join("; ");
}
