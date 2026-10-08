# 0009: Routing and assignment

Status: Accepted

## Decision
Routing runs inline, in the same transaction that creates the report. It moves the report `submitted → routed` and records an assignment, so a report is never visible in `submitted` with a routable location for longer than the transaction.

Candidate agencies come from a PostGIS `ST_Covers` lookup of the report point against jurisdictions, filtered by the category's default agency type. Ties break deterministically: most specific jurisdiction level first, then `agency_jurisdictions.priority` (lower wins), then agency id. If no agency covers the point, the lookup walks up the parent jurisdictions. If still none match, the report stays `submitted` with no agency, which is the platform admin triage queue.

A point covered by two sibling jurisdictions (a boundary) resolves to the lowest jurisdiction id. The assignment reason records that it was a boundary case so staff can see and correct it.

Reassignment writes a new assignment row and never edits an old one. Assignments are append-only, like status events. The current agency is denormalised onto `reports.agency_id` for scoped queries.

Duplicate detection is out of scope for Phase 4.

## Rationale
Inline routing keeps creation and routing atomic and avoids a window of unrouted reports. It also avoids a job-queue dependency before Phase 5, where timers hook onto `routed`. A deterministic tiebreak makes routing reproducible and testable. Treating "no match" as a triage queue means no report is dropped.

## Consequences
Routing is tested against the sample polygons only. Behaviour on real state/LGA boundaries is unverified until a boundary data source is chosen (`docs/roadmap.md`). If routing becomes slow or needs external calls, move it to a pg-boss job and supersede this ADR. The state machine and its role rules live in `docs/domain-model.md`.
