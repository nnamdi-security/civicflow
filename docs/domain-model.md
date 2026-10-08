# Domain model

## Entities (draft)
- **Report** — category, description, location, status, reporter, assigned agency, timestamps. `jurisdiction_id` records the finest jurisdiction covering the point, for public area names (Phase 7); `resolved_at` is when it last entered `resolved`, cleared on dispute. Implemented (Phase 3) without the agency link, which arrives with routing. Location is `geography(Point, 4326)`; description is 10–1000 characters of sanitized plain text; a short reference code (`CF-XXXXXXXX`) is shown to the reporter; a per-reporter idempotency key makes resubmits safe. Rules live in `src/domain/reports/`.
- **User** — email (lowercase, unique), role, optional agency. Implemented (Phase 2).
- **Agency** — name, type (roads, drainage, water, power, waste, streetlights), contacts, jurisdiction(s). Implemented without contacts.
- **Category** — name, default agency type, SLA policy. Implemented without SLA policy (Phase 5); the six launch categories are seeded by migration.
- **Jurisdiction** — administrative boundary (state/LGA) as a PostGIS polygon, with an optional parent. Implemented (Phase 2).
- **AgencyJurisdiction** — which jurisdictions an agency covers, with a priority (lower wins routing ties). Implemented (Phase 2).
- **Assignment** — report-to-agency link with history (reassignments). Append-only; `reports.agency_id` holds the current agency (ADR 0009).
- **StatusEvent** — append-only log of every status change (actor, from, to, reason, time). Implemented (Phase 3): a database trigger rejects UPDATE and DELETE. Every report starts with a null → `submitted` event written in the same transaction as the report.
- **SlaPolicy** — acknowledge and resolve durations per category. Placeholder values (Phase 5, ADR 0010).
- **Escalation** — append-only record that a report passed an escalation level for a timer in an SLA cycle. Unique per report, timer, level and cycle (Phase 5).
- **Confirmation** — resident verdict on a resolution (confirmed/disputed, note).
- **Media** — Cloudinary asset references for a report. Implemented (Phase 3): one to three photos per report, stored as provider `public_id` plus format, size and position (ADR 0008).

## Roles and agency scope
Roles: `resident`, `agency_officer`, `agency_admin`, `platform_admin` (`src/domain/roles.ts`). Agency roles belong to exactly one agency; other roles to none. This is enforced both in the domain (`isConsistentTarget`) and by the `users_agency_scope` database constraint. Policy functions live in `src/domain/permissions.ts` and are the only place role rules are written; repositories apply `agencyScopeFor(actor)` inside queries. Sign-in and sessions: ADR 0005.

## Status state machine (draft)
`submitted → routed → acknowledged → in_progress → resolved → confirmed`
Also: `resolved → disputed → in_progress` (reopen), `* → rejected` (invalid/duplicate, with reason).
Every transition is validated in the domain layer and writes a StatusEvent. Transition table lives in code and is tested exhaustively.

Who may perform each transition:
- `submitted → routed`: system (routing) or a platform admin triaging. Agency admins cannot, since an unrouted report has no agency.
- `routed → acknowledged`, `acknowledged → in_progress`, `in_progress → resolved`: staff of the assigned agency (or a platform admin).
- `* → rejected`: agency staff of the assigned agency or a platform admin; a reason is required. Not allowed from `confirmed` or `rejected`.
- `resolved → confirmed`, `resolved → disputed`: the reporting resident only. A dispute requires a note (1 to 500 characters).
- `resolved → confirmed` by the system: when a report has been `resolved` for more than 14 days with no answer (PROVISIONAL period, `docs/sla-and-escalation.md`). Reason "auto-confirmed after 14 days".
- `disputed → in_progress`: staff of the assigned agency (or a platform admin).
Reassignment (`docs/routing.md`) is a separate move that returns the report to `routed`. Unlisted transitions are rejected. A transition whose recorded `from` status no longer matches the report is rejected, so concurrent updates cannot both win.

## PostGIS conventions
- Store points as `geography(Point, 4326)`; boundaries as `geometry(MultiPolygon, 4326)` with GiST indexes.
- Coordinates are lon/lat order (x = longitude).
- Timestamps are `timestamptz`, stored UTC.
