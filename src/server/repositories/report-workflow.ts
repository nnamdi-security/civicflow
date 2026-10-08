import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { Db, Tx } from "../../db/client";
import { agencies, assignments, categories, reportMedia, reports, statusEvents } from "../../db/schema";
import type { AgencyScope } from "../../domain/permissions";
import type { ReportStatus } from "../../domain/reports/status";

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
  /** Stamp `routed_at` the first time the report is routed. */
  markRouted?: { at: Date };
}

/**
 * Compare-and-set status change plus its StatusEvent. Returns false when the report is no
 * longer in `from` (someone else moved it first), writing nothing. Call inside a transaction.
 */
export async function applyStatusChange(tx: Tx, change: StatusChange): Promise<boolean> {
  const updated = await tx
    .update(reports)
    .set({
      status: change.to,
      ...(change.agencyId ? { agencyId: change.agencyId } : {}),
      ...(change.markRouted ? { routedAt: sql`coalesce(${reports.routedAt}, ${change.markRouted.at})` } : {}),
    })
    .where(and(eq(reports.id, change.reportId), eq(reports.status, change.from)))
    .returning({ id: reports.id });
  if (updated.length === 0) return false;

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
}

const staffSummary = {
  id: reports.id,
  reference: reports.reference,
  status: reports.status,
  categoryName: categories.name,
  description: reports.description,
  agencyName: agencies.name,
  createdAt: reports.createdAt,
};

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
    .limit(options.limit ?? 100);
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
    .limit(limit);
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
  return row ? { ...row, lon: Number(row.lon), lat: Number(row.lat) } : null;
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
