# Routing

Decisions and rationale: ADR 0009 (`docs/decisions/0009-routing-and-assignment.md`). Routing runs inline at report creation.

## Algorithm (draft)
1. Find the jurisdiction containing the report point (PostGIS `ST_Covers`).
2. Select agencies in that jurisdiction whose type matches the category.
3. If several match, apply a deterministic tiebreak (most specific jurisdiction first, then configured priority, then agency id).
4. If none match, fall back to the parent jurisdiction, then to a platform admin triage queue.

## Manual reassignment
Platform admins and agency admins can reassign. Every reassignment creates an Assignment record and StatusEvent, and restarts SLA timers per `sla-and-escalation.md`.

## Boundary reports
A point covered by two sibling jurisdictions resolves to the lowest jurisdiction id; the assignment reason notes the boundary case (ADR 0009).

## Open questions
- Duplicate detection (same category within N metres): deferred past Phase 4.
- Real state/LGA boundaries: routing is only verified against sample polygons.
