---
paths:
  - "src/db/**"
  - "drizzle/**"
  - "drizzle.config.*"
---

- Change the schema, then run `pnpm db:generate`. Never hand-edit or delete an applied migration; add a new one.
- Review generated SQL before applying, especially PostGIS extensions, spatial types, and index definitions.
- Timestamps are `timestamptz` (UTC). Primary keys are UUIDs unless there is a reason otherwise.
- Points: `geography(Point, 4326)`; boundaries: `geometry(MultiPolygon, 4326)`; GiST index on every spatial column. Coordinates are lon/lat.
- Index SLA deadline columns and status columns used by jobs.
- StatusEvent is append-only: no updates or deletes.
- Queries live in repositories, not in components or actions.
