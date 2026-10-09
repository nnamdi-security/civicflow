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

## Importing real boundaries
Routing is only as good as the boundary shapes in the database. Until real ones are loaded it runs on the sample rectangles from `pnpm db:seed`. Load real boundaries from a GeoJSON file with:

```
pnpm boundaries:import <file.geojson> --level state|lga --name-field <property> [--parent-field <property>] [--dry-run] [--yes]
```

Do it in two passes, states first and then LGAs, and always run `--dry-run` first. The importer checks the file (shapes are Polygon or MultiPolygon, longitude/latitude order, closed rings, inside Nigeria, named, no duplicates), repairs small geometry defects with PostGIS, finds each LGA's state by the name in `--parent-field` or, if that is left out, by location, and saves everything in one transaction. **If anything is wrong, nothing is saved.** It never deletes places, reports or agency coverage, and a second run updates the same places instead of duplicating them (a place is identified by its level, its name ignoring capital letters, and its parent). In production the real run needs `--yes`.

After importing, check each agency's coverage in `/admin/agencies` (coverage rows point at places, so existing ones keep working), and re-check routing for a few known addresses. Which data source to use (and its licence) is still to be decided; the importer works with any GeoJSON that has a name property.

## Open questions
- Duplicate detection (same category within N metres): deferred past Phase 4.
- Real state/LGA boundaries: the importer is built and tested, but no real data has been loaded yet, so routing is only verified against sample and test polygons.
