import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { Db, Tx } from "../../db/client";
import { agencies, assignments, categories, reportMedia, reports, slaPolicies, statusEvents } from "../../db/schema";
import type { Clock } from "../../domain/clock";
import type { AgencyScope } from "../../domain/permissions";
import type { ReportStatus } from "../../domain/reports/status";
import { timersAfterEntering, type SlaPolicy } from "../../domain/sla";
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
 * Compare-and-set status change plus its StatusEvent, with the SLA timers that go with it
 * (docs/sla-and-escalation.md). The report row is locked first, so the timers are computed
 * from the state the change really applies to. Returns false when the report is no longer in
 * `from` (someone else moved it first), writing nothing. Call inside a transaction.
 */
export async function applyStatusChange(tx: Tx, change: StatusChange, clock: Clock): Promise<boolean> {
  const [current] = await tx
    .select({
      status: reports.status,
      categoryId: reports.categoryId,
      ackDueAt: reports.ackDueAt,
      resolveDueAt: reports.resolveDueAt,
      slaCycle: reports.slaCycle,
    })
    .from(reports)
    .where(eq(reports.id, change.reportId))
    .for("update");
  if (!current || current.status !== change.from) return false;

  const policy = await findSlaPolicy(tx, current.categoryId);
  // A category without a policy cannot start timers; fail loudly instead of leaving a report untimed.
  if (!policy && (change.to === "routed" || change.to === "disputed")) {
    throw new Error("No SLA policy for the report's category");
  }
  const timers = timersAfterEntering(change.to, current, policy ?? { ackMinutes: 0, resolveMinutes: 0 }, clock);

  await tx
    .update(reports)
    .set({
      status: change.to,
      ...(change.agencyId ? { agencyId: change.agencyId } : {}),
      ...(change.to === "routed" ? { routedAt: sql`coalesce(${reports.routedAt}, ${clock.now()})` } : {}),
      ackDueAt: timers.ackDueAt,
      resolveDueAt: timers.resolveDueAt,
      slaCycle: timers.slaCycle,
    })
    .where(eq(reports.id, change.reportId));

  await tx.insert(statusEvents).values({
    reportId: change.reportId,
    fromStatus: change.from,
    toStatus: change.to,
    actorId: change.actorId,
    reason: change.reason,
    // now() is the transaction start; use the wall clock so events in one transaction keep their order.
    createdAt: sql`clock_timestamp()` as unknown as Date,
  });
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
