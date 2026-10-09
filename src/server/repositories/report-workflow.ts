import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { Db, Tx } from "../../db/client";
import {
  agencies,
  assignments,
  categories,
  reportMedia,
  reports,
  slaOutcomes,
  slaPolicies,
  statusEvents,
} from "../../db/schema";
import type { Clock } from "../../domain/clock";
import type { AgencyScope } from "../../domain/permissions";
import type { ReportStatus } from "../../domain/reports/status";
import { outcomeForEntering, timersAfterEntering, type SlaPolicy } from "../../domain/sla";
import { eventForStatus } from "../../domain/notifications/events";
import { enqueueNotifications } from "./notifications";
import { currentEscalationLevel, toLevel } from "./sla-columns";

export interface WorkflowReport {
  id: string;
  status: ReportStatus;
  agencyId: string | null;
  reporterId: string;
}

/** Row for a status decision. No scope here: callers decide visibility and answer "not found". */
export async function findReportForWorkflow(db: Db | Tx, reportId: string): Promise<WorkflowReport | null> {
  const [row] = await db
    .select({ id: reports.id, status: reports.status, agencyId: reports.agencyId, reporterId: reports.reporterId })
    .from(reports)
    .where(eq(reports.id, reportId))
    .limit(1);
  return row ?? null;
}

export interface StatusChange {
  reportId: string;
  from: ReportStatus;
  to: ReportStatus;
  /** Null for system actions. */
  actorId: string | null;
  reason: string | null;
  /** Set when the change also (re)assigns the report. */
  agencyId?: string;
}

export async function findSlaPolicy(db: Db | Tx, categoryId: string): Promise<SlaPolicy | null> {
  const [row] = await db
    .select({ ackMinutes: slaPolicies.ackMinutes, resolveMinutes: slaPolicies.resolveMinutes })
    .from(slaPolicies)
    .where(eq(slaPolicies.categoryId, categoryId))
    .limit(1);
  return row ?? null;
}

/**
 * Moves a report from one status to another, and does every other thing that must happen at the
 * same moment. This is THE place status changes are written, so all the bookkeeping lives here:
 *
 *   1. checks nobody else changed the report first ("compare-and-set", explained below);
 *   2. works out the new SLA timers (src/domain/sla.ts) and saves them;
 *   3. records an SLA outcome if the agency just finished a timer (for the dashboards);
 *   4. adds a line to the report's history (a "status event");
 *   5. queues any email/SMS this change should cause (the notification outbox).
 *
 * It must be called inside a database TRANSACTION (`tx`). A transaction is a group of database
 * changes that either ALL succeed or ALL are undone. That is what guarantees, for example, that
 * a report never says "acknowledged" without its history line and its notification.
 *
 * Returns false (and writes nothing) if the report is no longer in the `from` status, which means
 * someone else moved it first. This is called "compare-and-set": we only set the new status if it
 * still matches what we compared against. It stops two people clicking at the same moment from both winning.
 */
export async function applyStatusChange(tx: Tx, change: StatusChange, clock: Clock): Promise<boolean> {
  // Read the report's current state and LOCK its row (`.for("update")`). While we hold the lock,
  // any other transaction trying to change this same report has to wait for us to finish.
  const [current] = await tx
    .select({
      status: reports.status,
      categoryId: reports.categoryId,
      agencyId: reports.agencyId,
      ackDueAt: reports.ackDueAt,
      resolveDueAt: reports.resolveDueAt,
      slaCycle: reports.slaCycle,
      slaStartedAt: reports.slaStartedAt,
    })
    .from(reports)
    .where(eq(reports.id, change.reportId))
    .for("update");

  // The "compare" in compare-and-set: if the report moved on since the caller looked, give up.
  if (!current || current.status !== change.from) return false;

  // Look up how long this category's deadlines are (see the sla_policies table).
  const policy = await findSlaPolicy(tx, current.categoryId);
  // Routing and disputes START timers, so they need a policy. If a category has none, fail loudly
  // instead of quietly leaving a report with no deadline.
  if (!policy && (change.to === "routed" || change.to === "disputed")) {
    throw new Error("No SLA policy for the report's category");
  }

  // The report's timers as they are right now, in the shape the pure SLA rules expect.
  const before = {
    ackDueAt: current.ackDueAt,
    resolveDueAt: current.resolveDueAt,
    slaCycle: current.slaCycle,
    startedAt: current.slaStartedAt,
  };

  // Ask the pure SLA rules: "what do the timers look like after entering this status?"
  // The fallback policy of zeros is only used for statuses that never start a timer.
  const timers = timersAfterEntering(change.to, before, policy ?? { ackMinutes: 0, resolveMinutes: 0 }, clock);

  // Ask the pure SLA rules: "did this change finish a timer, and was it on time?"
  // This must use the timers from BEFORE the change, because acknowledging clears the deadline.
  const outcome = outcomeForEntering(change.to, before, clock);

  // Save the new status and timers on the report.
  await tx
    .update(reports)
    .set({
      status: change.to,
      // Only set the agency when this change (re)assigns the report.
      ...(change.agencyId ? { agencyId: change.agencyId } : {}),
      // Remember the FIRST time the report was routed; `coalesce` keeps an existing value.
      ...(change.to === "routed" ? { routedAt: sql`coalesce(${reports.routedAt}, ${clock.now()})` } : {}),
      // Auto-confirmation counts from the latest time the report entered `resolved` (ADR 0013).
      ...(change.to === "resolved" ? { resolvedAt: clock.now() } : {}),
      ...(change.to === "disputed" ? { resolvedAt: null } : {}),
      ackDueAt: timers.ackDueAt,
      resolveDueAt: timers.resolveDueAt,
      slaCycle: timers.slaCycle,
      slaStartedAt: timers.startedAt,
    })
    .where(eq(reports.id, change.reportId));

  // Record the SLA outcome (if any) for the dashboards. It is attributed to the agency that held
  // the report at that moment, which is the one being measured.
  if (outcome) {
    if (current.agencyId === null) throw new Error("A timer stopped on a report with no agency");
    await tx.insert(slaOutcomes).values({
      reportId: change.reportId,
      agencyId: current.agencyId,
      timer: outcome.timer,
      slaCycle: outcome.slaCycle,
      startedAt: outcome.startedAt,
      dueAt: outcome.dueAt,
      stoppedAt: outcome.stoppedAt,
      met: outcome.met,
    });
  }

  // Add a line to the report's permanent history (this table can never be edited or deleted).
  await tx.insert(statusEvents).values({
    reportId: change.reportId,
    fromStatus: change.from,
    toStatus: change.to,
    actorId: change.actorId,
    reason: change.reason,
    // `now()` in a transaction means "when the transaction started", so two events in one
    // transaction would tie. `clock_timestamp()` is the real current time, keeping them in order.
    createdAt: sql`clock_timestamp()` as unknown as Date,
  });

  // Queue the emails/SMS this change should cause, in the SAME transaction: a message exists
  // exactly when the change is saved, never without it (ADR 0011).
  const event = eventForStatus(change.to);
  if (event) await enqueueNotifications(tx, { reportId: change.reportId, event, slaCycle: timers.slaCycle });
  return true;
}

export async function insertAssignment(
  tx: Tx,
  row: { reportId: string; agencyId: string; assignedBy: string | null; reason: string | null },
) {
  await tx.insert(assignments).values(row);
}

/** Moves a routed-or-later report to another agency, only if it is still in `expectedStatus`. */
export async function changeReportAgency(
  tx: Tx,
  reportId: string,
  agencyId: string,
  expectedStatus: ReportStatus,
): Promise<boolean> {
  const updated = await tx
    .update(reports)
    .set({ agencyId })
    .where(and(eq(reports.id, reportId), eq(reports.status, expectedStatus)))
    .returning({ id: reports.id });
  return updated.length > 0;
}

export async function agencyExists(db: Db | Tx, agencyId: string): Promise<boolean> {
  const [row] = await db.select({ id: agencies.id }).from(agencies).where(eq(agencies.id, agencyId)).limit(1);
  return Boolean(row);
}

export async function listAgencyOptions(db: Db) {
  return db.select({ id: agencies.id, name: agencies.name, type: agencies.type }).from(agencies).orderBy(agencies.name);
}

export interface StaffReportSummary {
  id: string;
  reference: string;
  status: ReportStatus;
  categoryName: string;
  description: string;
  agencyName: string | null;
  createdAt: Date;
  ackDueAt: Date | null;
  resolveDueAt: Date | null;
  /** Highest escalation level recorded in the current SLA cycle, per timer. */
  ackLevel: number | null;
  resolveLevel: number | null;
}

const staffSummary = {
  id: reports.id,
  reference: reports.reference,
  status: reports.status,
  categoryName: categories.name,
  description: reports.description,
  agencyName: agencies.name,
  createdAt: reports.createdAt,
  ackDueAt: reports.ackDueAt,
  resolveDueAt: reports.resolveDueAt,
  ackLevel: currentEscalationLevel("acknowledge"),
  resolveLevel: currentEscalationLevel("resolve"),
};

type StaffRow = Omit<StaffReportSummary, "ackLevel" | "resolveLevel"> & {
  ackLevel: number | string | null;
  resolveLevel: number | string | null;
};

function normalise<T extends StaffRow>(row: T) {
  return { ...row, ackLevel: toLevel(row.ackLevel), resolveLevel: toLevel(row.resolveLevel) };
}

function scopeCondition(scope: AgencyScope) {
  switch (scope.kind) {
    case "all":
      return sql`true`;
    case "agency":
      return eq(reports.agencyId, scope.agencyId);
    case "none":
      return sql`false`;
  }
}

/** Reports visible to staff, newest first. The scope is part of the query, not a UI filter. */
export async function listReportsForScope(
  db: Db,
  scope: AgencyScope,
  options: { status?: ReportStatus; limit?: number } = {},
): Promise<StaffReportSummary[]> {
  if (scope.kind === "none") return [];
  return db
    .select(staffSummary)
    .from(reports)
    .innerJoin(categories, eq(categories.id, reports.categoryId))
    .leftJoin(agencies, eq(agencies.id, reports.agencyId))
    .where(and(scopeCondition(scope), options.status ? eq(reports.status, options.status) : undefined))
    .orderBy(desc(reports.createdAt))
    .limit(options.limit ?? 100)
    .then((rows) => rows.map(normalise));
}

/** Unrouted reports awaiting a platform admin, oldest first. Callers authorize first. */
export async function listTriageReports(db: Db, limit = 100): Promise<StaffReportSummary[]> {
  return db
    .select(staffSummary)
    .from(reports)
    .innerJoin(categories, eq(categories.id, reports.categoryId))
    .leftJoin(agencies, eq(agencies.id, reports.agencyId))
    .where(and(isNull(reports.agencyId), eq(reports.status, "submitted")))
    .orderBy(asc(reports.createdAt))
    .limit(limit)
    .then((rows) => rows.map(normalise));
}

export interface StaffReportDetail extends StaffReportSummary {
  agencyId: string | null;
  lon: number;
  lat: number;
}

/** One report if it is inside `scope`; otherwise null (callers answer 404, not 403). */
export async function findReportForScope(
  db: Db,
  reportId: string,
  scope: AgencyScope,
): Promise<StaffReportDetail | null> {
  if (scope.kind === "none") return null;
  const [row] = await db
    .select({
      ...staffSummary,
      agencyId: reports.agencyId,
      lon: sql<number>`ST_X(${reports.location}::geometry)`,
      lat: sql<number>`ST_Y(${reports.location}::geometry)`,
    })
    .from(reports)
    .innerJoin(categories, eq(categories.id, reports.categoryId))
    .leftJoin(agencies, eq(agencies.id, reports.agencyId))
    .where(and(eq(reports.id, reportId), scopeCondition(scope)))
    .limit(1);
  return row ? { ...normalise(row), lon: Number(row.lon), lat: Number(row.lat) } : null;
}

export interface StatusHistoryEntry {
  fromStatus: ReportStatus | null;
  toStatus: ReportStatus;
  reason: string | null;
  createdAt: Date;
}

/** Oldest first. Actor identity is deliberately not returned. */
export async function listStatusHistory(db: Db, reportId: string): Promise<StatusHistoryEntry[]> {
  return db
    .select({
      fromStatus: statusEvents.fromStatus,
      toStatus: statusEvents.toStatus,
      reason: statusEvents.reason,
      createdAt: statusEvents.createdAt,
    })
    .from(statusEvents)
    .where(eq(statusEvents.reportId, reportId))
    .orderBy(asc(statusEvents.createdAt), asc(statusEvents.id));
}

export async function listReportPhotos(db: Db, reportId: string) {
  return db
    .select({ publicId: reportMedia.publicId, width: reportMedia.width, height: reportMedia.height })
    .from(reportMedia)
    .where(eq(reportMedia.reportId, reportId))
    .orderBy(asc(reportMedia.position));
}

/**
 * Records the finest jurisdiction covering the report's point (no covering child; the lowest id on a
 * shared boundary), for public area names. Runs in the creation transaction. Null if nothing covers it.
 */
export async function assignReportJurisdiction(tx: Tx, reportId: string): Promise<void> {
  await tx.execute(sql`
    update reports r
    set jurisdiction_id = (
      select j.id from jurisdictions j
      where ST_Covers(j.geom, r.location::geometry)
        and not exists (
          select 1 from jurisdictions c
          where c.parent_id = j.id and ST_Covers(c.geom, r.location::geometry)
        )
      order by j.id
      limit 1
    )
    where r.id = ${reportId}
  `);
}
