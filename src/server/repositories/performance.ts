/**
 * Database queries behind the performance dashboards (ADR 0014).
 *
 * A "repository" file is where database questions live, so that pages and business logic never
 * contain SQL. This one answers: for each agency I am allowed to see, how did it do over the
 * last N days?
 *
 * THE MOST IMPORTANT RULE IN THIS FILE: who may see which agency is decided INSIDE the query,
 * by the `scope` argument, not left to the page. Even if a page forgot to check, an agency admin
 * could never receive another agency's numbers from here.
 */
import { and, count, eq, gte, inArray, min, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { agencies, reports, slaOutcomes, statusEvents } from "../../db/schema";
import type { Clock } from "../../domain/clock";
import type { AgencyScope } from "../../domain/permissions";
import {
  disputeRatePercent,
  summariseTimer,
  windowStart,
  type AgencyPerformance,
  type PerformanceWindowDays,
} from "../../domain/performance";

/** What the dashboards need to show: the per-agency figures and when the records begin. */
export interface PerformanceReport {
  /** One entry per agency in scope, ordered by name. Agencies with no data still appear (all zeros). */
  agencies: AgencyPerformance[];
  /** When the first outcome was recorded in scope; null if none yet. Shown so nobody misreads an empty history. */
  recordsSince: Date | null;
}

/**
 * Works out the figures for every agency the caller may see.
 * `scope` says which agencies those are (everything, one agency, or nothing).
 */
export async function findAgencyPerformance(
  db: Db,
  scope: AgencyScope,
  days: PerformanceWindowDays,
  clock: Clock,
): Promise<PerformanceReport> {
  // Step 1: which agencies are in scope? This is where the permission boundary is enforced.
  if (scope.kind === "none") return { agencies: [], recordsSince: null };
  const agencyRows = await db
    .select({ id: agencies.id, name: agencies.name })
    .from(agencies)
    // For "all" we add no condition; for "agency" we keep just that one agency.
    .where(scope.kind === "agency" ? eq(agencies.id, scope.agencyId) : undefined)
    .orderBy(agencies.name);
  if (agencyRows.length === 0) return { agencies: [], recordsSince: null };
  const agencyIds = agencyRows.map((a) => a.id);

  const now = clock.now();
  const since = windowStart(days, clock); // the first instant of "the last N days"

  // Step 2: finished timers in the window, grouped by agency and by timer.
  // - count(*)                      = how many timers finished;
  // - count(*) filter (where met)   = how many of those were on time;
  // - percentile_cont(0.5) ...      = the MEDIAN time taken, in seconds (the middle value; for an
  //                                   even number of values Postgres averages the two middle ones).
  const outcomeRows = await db
    .select({
      agencyId: slaOutcomes.agencyId,
      timer: slaOutcomes.timer,
      total: sql<number>`count(*)::int`,
      met: sql<number>`(count(*) filter (where ${slaOutcomes.met}))::int`,
      medianSeconds: sql<number | null>`percentile_cont(0.5) within group (
        order by extract(epoch from (${slaOutcomes.stoppedAt} - ${slaOutcomes.startedAt}))
      )`,
    })
    .from(slaOutcomes)
    .where(and(inArray(slaOutcomes.agencyId, agencyIds), gte(slaOutcomes.stoppedAt, since)))
    .groupBy(slaOutcomes.agencyId, slaOutcomes.timer);

  // Step 3: reports each agency holds RIGHT NOW that still have a running timer, and how many of
  // those are already past a deadline. "Past" is strictly after, the same rule as everywhere else.
  const openRows = await db
    .select({
      agencyId: reports.agencyId,
      open: sql<number>`count(*)::int`,
      overdue: sql<number>`(count(*) filter (
        where ${reports.ackDueAt} < ${now} or ${reports.resolveDueAt} < ${now}
      ))::int`,
    })
    .from(reports)
    .where(
      and(
        inArray(reports.agencyId, agencyIds),
        // A report is "open" when at least one of its timers is running.
        sql`(${reports.ackDueAt} is not null or ${reports.resolveDueAt} is not null)`,
      ),
    )
    .groupBy(reports.agencyId);

  // Step 4: how many resolutions were disputed in the window, per agency. A dispute is a status
  // event whose new status is "disputed". We attribute it to the agency currently holding the report.
  const disputeRows = await db
    .select({ agencyId: reports.agencyId, disputes: count() })
    .from(statusEvents)
    .innerJoin(reports, eq(reports.id, statusEvents.reportId))
    .where(
      and(
        inArray(reports.agencyId, agencyIds),
        eq(statusEvents.toStatus, "disputed"),
        gte(statusEvents.createdAt, since),
      ),
    )
    .groupBy(reports.agencyId);

  // Step 5: when did recording begin? Shown on the page so an empty history is not misread.
  const [first] = await db
    .select({ firstRecordedAt: min(slaOutcomes.createdAt) })
    .from(slaOutcomes)
    .where(inArray(slaOutcomes.agencyId, agencyIds));

  // Step 6: assemble one AgencyPerformance per agency, from the lookups above.
  // `Number(...)` guards against the database driver handing back text for some numeric columns.
  const performance = agencyRows.map((agency): AgencyPerformance => {
    const find = (timer: "acknowledge" | "resolve") =>
      outcomeRows.find((row) => row.agencyId === agency.id && row.timer === timer);
    const ack = find("acknowledge");
    const resolve = find("resolve");
    const open = openRows.find((row) => row.agencyId === agency.id);
    const disputes = Number(disputeRows.find((row) => row.agencyId === agency.id)?.disputes ?? 0);
    const resolutions = Number(resolve?.total ?? 0);

    return {
      agencyId: agency.id,
      agencyName: agency.name,
      acknowledge: summariseTimer(
        Number(ack?.total ?? 0),
        Number(ack?.met ?? 0),
        ack?.medianSeconds == null ? null : Number(ack.medianSeconds),
      ),
      resolve: summariseTimer(
        resolutions,
        Number(resolve?.met ?? 0),
        resolve?.medianSeconds == null ? null : Number(resolve.medianSeconds),
      ),
      openReports: Number(open?.open ?? 0),
      openOverdue: Number(open?.overdue ?? 0),
      resolutions,
      disputes,
      disputeRatePercent: disputeRatePercent(disputes, resolutions),
    };
  });

  return { agencies: performance, recordsSince: first?.firstRecordedAt ? new Date(first.firstRecordedAt) : null };
}
