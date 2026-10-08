import { sql } from "drizzle-orm";
import { reports } from "../../db/schema";
import type { SlaTimer } from "../../domain/sla";

/** Highest escalation level recorded for the report's current SLA cycle, or null. */
export function currentEscalationLevel(timer: SlaTimer) {
  return sql<number | null>`(
    select max(e.level) from escalations e
    where e.report_id = ${reports.id} and e.timer = ${timer}::sla_timer and e.sla_cycle = ${reports.slaCycle}
  )`;
}

/** Postgres returns max() as a number or null; normalise defensively. */
export function toLevel(value: number | string | null): number | null {
  return value === null ? null : Number(value);
}
