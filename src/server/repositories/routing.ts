import { sql } from "drizzle-orm";
import type { Db, Tx } from "../../db/client";
import type { RoutingCandidate, RoutingInput } from "../../domain/routing";

interface CandidateRow extends Record<string, unknown> {
  agency_id: string;
  jurisdiction_id: string;
  hops: number;
  priority: number;
}

interface BoundaryRow extends Record<string, unknown> {
  finest_count: number;
}

/**
 * Everything routing needs for one report, from the database's own copy of its point (no
 * float round trip). Finest jurisdictions are the covering ones with no covering child; the
 * candidate walk climbs `parent_id` from each, counting hops. Only agencies of the category's
 * default type are returned.
 */
export async function findRoutingInput(db: Db | Tx, reportId: string): Promise<RoutingInput> {
  const covering = sql`
    covering as (
      select j.id, j.parent_id
      from jurisdictions j, target t
      where ST_Covers(j.geom, t.point)
    ),
    finest as (
      select c.id from covering c
      where not exists (select 1 from covering k where k.parent_id = c.id)
    )`;
  const target = sql`
    target as (
      select r.location::geometry as point, cat.default_agency_type as agency_type
      from reports r join categories cat on cat.id = r.category_id
      where r.id = ${reportId}
    )`;

  const candidates = await db.execute<CandidateRow>(sql`
    with recursive ${target}, ${covering},
    chain(id, parent_id, hops) as (
      select j.id, j.parent_id, 0 from jurisdictions j join finest f on f.id = j.id
      union all
      select p.id, p.parent_id, chain.hops + 1
      from jurisdictions p join chain on chain.parent_id = p.id
    )
    select a.id as agency_id, chain.id as jurisdiction_id, min(chain.hops)::int as hops,
           aj.priority as priority
    from chain
    join agency_jurisdictions aj on aj.jurisdiction_id = chain.id
    join agencies a on a.id = aj.agency_id
    join target t on t.agency_type = a.type
    group by a.id, chain.id, aj.priority
  `);

  const boundary = await db.execute<BoundaryRow>(sql`
    with ${target}, ${covering}
    select count(*)::int as finest_count from finest
  `);

  return {
    candidates: candidates.rows.map(
      (row): RoutingCandidate => ({
        agencyId: row.agency_id,
        jurisdictionId: row.jurisdiction_id,
        hops: Number(row.hops),
        priority: Number(row.priority),
      }),
    ),
    boundary: Number(boundary.rows[0]?.finest_count ?? 0) > 1,
  };
}
