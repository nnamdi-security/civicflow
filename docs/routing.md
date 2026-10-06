# Routing

## Algorithm (draft)
1. Find the jurisdiction containing the report point (PostGIS `ST_Covers`).
2. Select agencies in that jurisdiction whose type matches the category.
3. If several match, apply a deterministic tiebreak (most specific jurisdiction first, then configured priority).
4. If none match, fall back to the parent jurisdiction, then to a platform admin triage queue.

## Manual reassignment
Platform admins and agency admins can reassign. Every reassignment creates an Assignment record and StatusEvent, and restarts SLA timers per `sla-and-escalation.md`.

## Open questions
- Reports on a jurisdiction boundary.
- Duplicate detection (same category within N metres).
