import { sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { escalations } from "../../db/schema";
import type { Clock } from "../../domain/clock";
import {
  ESCALATION_LADDER,
  ESCALATION_LEVELS,
  escalationLevelsDue,
  type EscalationLevel,
  type SlaTimer,
} from "../../domain/sla";

/** Upper bound per run so one pass stays short. Leftovers are picked up on the next pass. */
const MAX_MISSING_PER_RUN = 1000;

export interface ScanResult {
  /** Escalations newly recorded by this run. Zero on a repeat run. */
  recorded: number;
}

interface MissingRow extends Record<string, unknown> {
  report_id: string;
  timer: SlaTimer;
  due_at: Date;
  sla_cycle: number;
  level: number;
}

const TIMER_COLUMN = { acknowledge: sql`ack_due_at`, resolve: sql`resolve_due_at` } as const;

/**
 * Finds ladder steps that are due but not yet recorded. SQL narrows candidates through the
 * partial deadline indexes; the domain function stays the authority on what is due.
 */
async function findMissing(db: Db, timer: SlaTimer, clock: Clock): Promise<MissingRow[]> {
  const now = clock.now();
  const ladder = sql.join(
    ESCALATION_LEVELS.map(
      (level) => sql`(${level}::smallint, ${ESCALATION_LADDER[level].delayMs / 1000}::double precision)`,
    ),
    sql`, `,
  );
  const column = TIMER_COLUMN[timer];
  const result = await db.execute<MissingRow>(sql`
    select r.id as report_id, ${timer}::sla_timer as timer, r.${column} as due_at,
           r.sla_cycle as sla_cycle, l.level as level
    from reports r
    cross join (values ${ladder}) as l(level, delay_seconds)
    where r.${column} is not null
      and r.${column} + make_interval(secs => l.delay_seconds) < ${now}
      and not exists (
        select 1 from escalations e
        where e.report_id = r.id and e.timer = ${timer}::sla_timer
          and e.level = l.level and e.sla_cycle = r.sla_cycle
      )
    order by r.${column}, l.level
    limit ${MAX_MISSING_PER_RUN}
  `);
  return result.rows;
}

/**
 * Records every escalation step that is due. Idempotent: the unique key on
 * (report, timer, level, cycle) plus ON CONFLICT DO NOTHING means a repeat run, an overlapping
 * run, or two workers never create a duplicate (ADR 0010).
 */
export async function runSlaScan(db: Db, clock: Clock): Promise<ScanResult> {
  let recorded = 0;
  for (const timer of ["acknowledge", "resolve"] as const) {
    const missing = await findMissing(db, timer, clock);
    const due = missing.filter((row) =>
      escalationLevelsDue(new Date(row.due_at), clock).includes(row.level as EscalationLevel),
    );
    if (due.length === 0) continue;

    const inserted = await db
      .insert(escalations)
      .values(
        due.map((row) => ({
          reportId: row.report_id,
          timer: row.timer,
          level: row.level,
          slaCycle: row.sla_cycle,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: escalations.id });
    recorded += inserted.length;
  }
  return { recorded };
}
