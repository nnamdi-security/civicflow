# Routing

Decisions and rationale: ADR 0009 (`docs/decisions/0009-routing-and-assignment.md`). Routing runs inline at report creation.

## Algorithm (draft)
1. Find the jurisdiction containing the report point (PostGIS `ST_Covers`).
2. Select agencies in that jurisdiction whose type matches the category.
3. If several match, apply a deterministic tiebreak (most specific jurisdiction first, then configured priority, then jurisdiction id, then agency id). "Most specific" is counted as fewest parent hops from the jurisdiction containing the point..
4. If none match, fall back to the parent jurisdiction, then to a platform admin triage queue.

## Manual reassignment
Platform admins can route reports out of triage and reassign any report; an agency admin can reassign reports currently held by their own agency. Officers and residents cannot. Allowed from `submitted`, `routed`, `acknowledged`, `in_progress` and `disputed`; not once `resolved`, `confirmed` or `rejected`.

Every reassignment creates an Assignment record and a StatusEvent, and returns the report to `routed` so the new agency acknowledges afresh. `routed_at` keeps the first routing time; the latest assignment's `created_at` is when the timers restart (Phase 5, per `sla-and-escalation.md`). Reassigning to the same agency is refused.

## Boundary reports
A point covered by two sibling jurisdictions resolves to the lowest jurisdiction id; the assignment reason notes the boundary case (ADR 0009).

## Open questions
- Duplicate detection (same category within N metres): deferred past Phase 4.
- Real state/LGA boundaries: routing is only verified against sample polygons.
