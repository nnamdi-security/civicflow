import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { agencies, categories, reportMedia, reports } from "../../db/schema";
import type { ReportStatus } from "../../domain/reports/status";

export async function findActiveCategory(db: Db, categoryId: string) {
  const [row] = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.active, true)))
    .limit(1);
  return row ?? null;
}

export async function listActiveCategories(db: Db) {
  return db
    .select({ id: categories.id, slug: categories.slug, name: categories.name })
    .from(categories)
    .where(eq(categories.active, true))
    .orderBy(categories.sortOrder);
}

export async function findReportByIdempotencyKey(db: Db, reporterId: string, key: string) {
  const [row] = await db
    .select({ id: reports.id, reference: reports.reference })
    .from(reports)
    .where(and(eq(reports.reporterId, reporterId), eq(reports.idempotencyKey, key)))
    .limit(1);
  return row ?? null;
}

/** Public ids already attached to any report. */
export async function findUsedPublicIds(db: Db, publicIds: string[]) {
  if (publicIds.length === 0) return [];
  const rows = await db
    .select({ publicId: reportMedia.publicId })
    .from(reportMedia)
    .where(inArray(reportMedia.publicId, publicIds));
  return rows.map((row) => row.publicId);
}

export interface ReportSummary {
  id: string;
  reference: string;
  status: ReportStatus;
  categoryName: string;
  description: string;
  createdAt: Date;
}

/** A reporter's own reports, newest first. Ownership is part of the query. */
export async function listReportsForReporter(db: Db, reporterId: string, limit = 50): Promise<ReportSummary[]> {
  return db
    .select({
      id: reports.id,
      reference: reports.reference,
      status: reports.status,
      categoryName: categories.name,
      description: reports.description,
      createdAt: reports.createdAt,
    })
    .from(reports)
    .innerJoin(categories, eq(categories.id, reports.categoryId))
    .where(eq(reports.reporterId, reporterId))
    .orderBy(desc(reports.createdAt))
    .limit(limit);
}

export interface ReportDetail extends ReportSummary {
  /** The agency currently holding the report, once routed. */
  agencyName: string | null;
  lon: number;
  lat: number;
  photos: { publicId: string; width: number; height: number }[];
}

/** One report, only if it belongs to `reporterId`; otherwise null (callers answer 404). */
export async function findReportForReporter(
  db: Db,
  reportId: string,
  reporterId: string,
): Promise<ReportDetail | null> {
  const [row] = await db
    .select({
      id: reports.id,
      reference: reports.reference,
      status: reports.status,
      categoryName: categories.name,
      description: reports.description,
      createdAt: reports.createdAt,
      agencyName: agencies.name,
      lon: sql<number>`ST_X(${reports.location}::geometry)`,
      lat: sql<number>`ST_Y(${reports.location}::geometry)`,
    })
    .from(reports)
    .innerJoin(categories, eq(categories.id, reports.categoryId))
    .leftJoin(agencies, eq(agencies.id, reports.agencyId))
    .where(and(eq(reports.id, reportId), eq(reports.reporterId, reporterId)))
    .limit(1);
  if (!row) return null;

  const photos = await db
    .select({ publicId: reportMedia.publicId, width: reportMedia.width, height: reportMedia.height })
    .from(reportMedia)
    .where(eq(reportMedia.reportId, reportId))
    .orderBy(reportMedia.position);
  return { ...row, lon: Number(row.lon), lat: Number(row.lat), photos };
}
