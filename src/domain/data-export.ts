/**
 * Builds the file a person downloads when they ask for a copy of their data (ADR 0015).
 *
 * Why this exists: data-protection law (the Nigeria Data Protection Act) gives people the right
 * to see the personal data held about them. This turns what we hold into one readable JSON file.
 *
 * It is an ALLOW-LIST, in the same spirit as the public view (public-view.ts): the function copies
 * only the fields named below. Anything not named, such as password-like secrets, session tokens,
 * hashed verification codes, or other people's identities, can never end up in the file, even if a
 * database column with that data is added later. A test fixes the exact set of fields.
 *
 * Pure: it only reshapes the rows it is given. Fetching them is src/server/repositories/export.ts.
 */
import type { NotificationChannel, NotificationEvent, NotificationStatus } from "./notifications/events";
import type { ReportStatus } from "./reports/status";

/** Who made a change to a report, from the downloader's point of view. Never a name or an id. */
export type HistoryActor = "you" | "agency" | "system";

export interface ExportSource {
  profile: {
    email: string;
    name: string | null;
    role: string;
    phoneE164: string | null;
    phoneVerified: boolean;
    notifyEmail: boolean;
    notifySms: boolean;
    createdAt: Date;
  };
  reports: Array<{
    reference: string;
    categoryName: string;
    description: string;
    lon: number;
    lat: number;
    status: ReportStatus;
    createdAt: Date;
    agencyName: string | null;
    areaName: string | null;
    photos: Array<{ publicId: string; imageUrl: string }>;
    history: Array<{ status: ReportStatus; at: Date; note: string | null; by: HistoryActor }>;
  }>;
  notifications: Array<{
    event: NotificationEvent;
    channel: NotificationChannel;
    status: NotificationStatus;
    createdAt: Date;
    sentAt: Date | null;
  }>;
}

/** The identifier of this file layout, so future changes can be told apart. */
export const DATA_EXPORT_FORMAT = "civicflow-data-export-v1";

export interface DataExport {
  format: typeof DATA_EXPORT_FORMAT;
  exportedAt: string;
  note: string;
  profile: {
    email: string;
    name: string | null;
    role: string;
    phone: string | null;
    phoneConfirmed: boolean;
    emailUpdates: boolean;
    smsUpdates: boolean;
    accountCreatedAt: string;
  };
  reports: Array<{
    reference: string;
    category: string;
    description: string;
    location: { longitude: number; latitude: number };
    status: ReportStatus;
    reportedAt: string;
    handledBy: string | null;
    area: string | null;
    photos: Array<{ id: string; url: string }>;
    history: Array<{ status: ReportStatus; at: string; note: string | null; by: HistoryActor }>;
  }>;
  messagesSentToYou: Array<{
    event: NotificationEvent;
    channel: NotificationChannel;
    status: NotificationStatus;
    queuedAt: string;
    sentAt: string | null;
  }>;
}

export function buildDataExport(source: ExportSource, exportedAt: Date): DataExport {
  return {
    format: DATA_EXPORT_FORMAT,
    exportedAt: exportedAt.toISOString(),
    note:
      "This is a copy of the personal data CivicFlow holds about you. Message texts are not stored, only the fact that a message was sent. " +
      "People who handled your reports are not named.",
    profile: {
      email: source.profile.email,
      name: source.profile.name,
      role: source.profile.role,
      phone: source.profile.phoneE164,
      phoneConfirmed: source.profile.phoneVerified,
      emailUpdates: source.profile.notifyEmail,
      smsUpdates: source.profile.notifySms,
      accountCreatedAt: source.profile.createdAt.toISOString(),
    },
    reports: source.reports.map((report) => ({
      reference: report.reference,
      category: report.categoryName,
      description: report.description,
      location: { longitude: report.lon, latitude: report.lat },
      status: report.status,
      reportedAt: report.createdAt.toISOString(),
      handledBy: report.agencyName,
      area: report.areaName,
      photos: report.photos.map((photo) => ({ id: photo.publicId, url: photo.imageUrl })),
      history: report.history.map((entry) => ({
        status: entry.status,
        at: entry.at.toISOString(),
        note: entry.note,
        by: entry.by,
      })),
    })),
    messagesSentToYou: source.notifications.map((n) => ({
      event: n.event,
      channel: n.channel,
      status: n.status,
      queuedAt: n.createdAt.toISOString(),
      sentAt: n.sentAt ? n.sentAt.toISOString() : null,
    })),
  };
}
