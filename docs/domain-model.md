# Domain model

## Entities (draft)
- **Report** — category, description, location, status, reporter, assigned agency, timestamps.
- **Agency** — name, type, contacts, jurisdiction(s).
- **Category** — name, default agency type, SLA policy.
- **Jurisdiction** — administrative boundary (state/LGA) as a PostGIS polygon.
- **Assignment** — report-to-agency link with history (reassignments).
- **StatusEvent** — append-only log of every status change (actor, from, to, reason, time).
- **Confirmation** — resident verdict on a resolution (confirmed/disputed, note).
- **Media** — Cloudinary asset references for a report.

## Status state machine (draft)
`submitted → routed → acknowledged → in_progress → resolved → confirmed`
Also: `resolved → disputed → in_progress` (reopen), `* → rejected` (invalid/duplicate, with reason).
Every transition is validated in the domain layer and writes a StatusEvent. Transition table lives in code and is tested exhaustively.

## PostGIS conventions
- Store points as `geography(Point, 4326)`; boundaries as `geometry(MultiPolygon, 4326)` with GiST indexes.
- Coordinates are lon/lat order (x = longitude).
- Timestamps are `timestamptz`, stored UTC.
