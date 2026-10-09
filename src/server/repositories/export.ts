/**
 * Reads everything we hold about ONE person, for their data download (ADR 0015).
 *
 * Every query here is filtered by the user id that the caller passes in, and that id always comes
 * from the signed-in session, never from the request. There is deliberately no way to ask for
 * someone else's data: the only parameter is "me".
 *
 * It returns raw rows in the shape `buildDataExport` expects; the allow-list that decides what
 * actually reaches the file lives there.
 */
import { asc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { agencies, categories, jurisdictions, notifications, reportMedia, reports, statusEvents, users } from "../../db/schema";
import type { ExportSource, HistoryActor } from "../../domain/data-export";

/** `imageUrl` turns a stored photo id into a link; passed in so this file stays free of any provider. */
export async function findDataForExport(
  db: Db,
  userId: string,
  imageUrl: (publicId: string) => string,
): Promise<ExportSource | null> {
  const [profile] = await db
    .select({
      email: users.email,
      name: users.name,
      role: users.role,
      phoneE164: users.phoneE164,
      phoneVerifiedAt: users.phoneVerifiedAt,
      notifyEmail: users.notifyEmail,
      notifySms: users.notifySms,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!profile) return null;

  const reportRows = await db
    .select({
      id: reports.id,
      reference: reports.reference,
      categoryName: categories.name,
      description: reports.description,
      lon: sql<number>`ST_X(${reports.location}::geometry)`,
      lat: sql<number>`ST_Y(${reports.location}::geometry)`,
      status: reports.status,
      createdAt: reports.createdAt,
      agencyName: agencies.name,
      areaName: jurisdictions.name,
    })
    .from(reports)
    .innerJoin(categories, eq(categories.id, reports.categoryId))
    .leftJoin(agencies, eq(agencies.id, reports.agencyId))
    .leftJoin(jurisdictions, eq(jurisdictions.id, reports.jurisdictionId))
    .where(eq(reports.reporterId, userId))
    .orderBy(asc(reports.createdAt));

  const reportIds = reportRows.map((r) => r.id);
  const photoRows = reportIds.length
    ? await db
        .select({ reportId: reportMedia.reportId, publicId: reportMedia.publicId })
        .from(reportMedia)
        .where(inArray(reportMedia.reportId, reportIds))
        .orderBy(asc(reportMedia.position))
    : [];
  const eventRows = reportIds.length
    ? await db
        .select({
          reportId: statusEvents.reportId,
          status: statusEvents.toStatus,
          at: statusEvents.createdAt,
          note: statusEvents.reason,
          actorId: statusEvents.actorId,
        })
        .from(statusEvents)
        .where(inArray(statusEvents.reportId, reportIds))
        .orderBy(asc(statusEvents.createdAt), asc(statusEvents.id))
    : [];

  // Who acted, from the downloader's point of view. We never reveal anyone else's id or name:
  // only "you", "the agency" (any staff member), or "the system" (no actor, for example routing).
  const actorLabel = (actorId: string | null): HistoryActor =>
    actorId === null ? "system" : actorId === userId ? "you" : "agency";

  const notificationRows = await db
    .select({
      event: notifications.event,
      channel: notifications.channel,
      status: notifications.status,
      createdAt: notifications.createdAt,
      sentAt: notifications.sentAt,
    })
    .from(notifications)
    .where(eq(notifications.recipientUserId, userId))
    .orderBy(asc(notifications.createdAt));

  return {
    profile: {
      email: profile.email,
      name: profile.name,
      role: profile.role,
      phoneE164: profile.phoneE164,
      phoneVerified: profile.phoneVerifiedAt !== null,
      notifyEmail: profile.notifyEmail,
      notifySms: profile.notifySms,
      createdAt: profile.createdAt,
    },
    reports: reportRows.map((report) => ({
      reference: report.reference,
      categoryName: report.categoryName,
      description: report.description,
      lon: Number(report.lon),
      lat: Number(report.lat),
      status: report.status,
      createdAt: report.createdAt,
      agencyName: report.agencyName,
      areaName: report.areaName,
      photos: photoRows
        .filter((photo) => photo.reportId === report.id)
        .map((photo) => ({ publicId: photo.publicId, imageUrl: imageUrl(photo.publicId) })),
      history: eventRows
        .filter((event) => event.reportId === report.id)
        .map((event) => ({ status: event.status, at: event.at, note: event.note, by: actorLabel(event.actorId) })),
    })),
    notifications: notificationRows,
  };
}
