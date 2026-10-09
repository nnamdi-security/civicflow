import { asc, eq, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { agencies, categories, jurisdictions, reports, statusEvents } from "../../db/schema";
import type { PublicOverdueItem, PublicReportSource } from "../../domain/reports/public-view";
import { currentEscalationLevel, toLevel } from "./sla-columns";

/**
 * Public reads (ADR 0013). Every query names its columns: nothing here selects the reporter,
 * description, photos, exact location or staff notes, so they cannot be returned by accident.
 * Callers still pass results through `toPublicReport`.
 */
export async function findPublicReportByReference(db: Db, reference: string): Promise<PublicReportSource | null> {
  const [row] = await db
    .select({
      id: reports.id,
      reference: reports.reference,
      categoryName: categories.name,
      status: reports.status,
      agencyName: agencies.name,
      areaName: jurisdictions.name,
      createdAt: reports.createdAt,
      ackDueAt: reports.ackDueAt,
      resolveDueAt: reports.resolveDueAt,
      ackLevel: currentEscalationLevel("acknowledge"),
      resolveLevel: currentEscalationLevel("resolve"),
    })
    .from(reports)
    .innerJoin(categories, eq(categories.id, reports.categoryId))
    .leftJoin(agencies, eq(agencies.id, reports.agencyId))
    .leftJoin(jurisdictions, eq(jurisdictions.id, reports.jurisdictionId))
    .where(eq(reports.reference, reference))
    .limit(1);
  if (!row) return null;

  const timeline = await db
    .select({ toStatus: statusEvents.toStatus, createdAt: statusEvents.createdAt })
    .from(statusEvents)
    .where(eq(statusEvents.reportId, row.id))
    .orderBy(asc(statusEvents.createdAt), asc(statusEvents.id));

  return {
    reference: row.reference,
    categoryName: row.categoryName,
    status: row.status,
    agencyName: row.agencyName,
    areaName: row.areaName,
    createdAt: row.createdAt,
    ackDueAt: row.ackDueAt,
    resolveDueAt: row.resolveDueAt,
    ackLevel: toLevel(row.ackLevel),
    resolveLevel: toLevel(row.resolveLevel),
    timeline,
  };
}

interface OverdueRow extends Record<string, unknown> {
  reference: string;
  category_name: string;
  agency_name: string | null;
  area_name: string | null;
  overdue_since: Date;
}

/**
 * Reports marked publicly overdue (escalation level 3 in the current cycle) whose timer is still
 * running, longest overdue first. Closed reports drop off because their timers are stopped.
 */
export async function listPubliclyOverdue(db: Db, limit = 100): Promise<PublicOverdueItem[]> {
  const level3 = (timer: "acknowledge" | "resolve") => sql`exists (
    select 1 from escalations e
    where e.report_id = r.id and e.timer = ${timer}::sla_timer and e.level = 3 and e.sla_cycle = r.sla_cycle
  )`;
  const result = await db.execute<OverdueRow>(sql`
    select r.reference as reference, c.name as category_name, a.name as agency_name, j.name as area_name,
      least(
        case when r.ack_due_at is not null and ${level3("acknowledge")} then r.ack_due_at end,
        case when r.resolve_due_at is not null and ${level3("resolve")} then r.resolve_due_at end
      ) as overdue_since
    from reports r
    join categories c on c.id = r.category_id
    left join agencies a on a.id = r.agency_id
    left join jurisdictions j on j.id = r.jurisdiction_id
    where (r.ack_due_at is not null and ${level3("acknowledge")})
       or (r.resolve_due_at is not null and ${level3("resolve")})
    order by overdue_since asc, r.reference
    limit ${limit}
  `);
  return result.rows.map((row) => ({
    reference: row.reference,
    categoryName: row.category_name,
    agencyName: row.agency_name,
    areaName: row.area_name,
    overdueSince: new Date(row.overdue_since),
  }));
}
