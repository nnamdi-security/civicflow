/**
 * Unit tests for the data-export builder. They check the exact shape of the file and, more
 * importantly, that nothing outside the allow-list can leak into it.
 */
import { describe, expect, it } from "vitest";
import { DATA_EXPORT_FORMAT, buildDataExport, type ExportSource } from "./data-export";

const NOW = new Date("2026-06-30T12:00:00Z");
const T = new Date("2026-03-01T09:00:00Z");

const source: ExportSource = {
  profile: {
    email: "alice@example.com",
    name: "Alice Example",
    role: "resident",
    phoneE164: "+2348031234567",
    phoneVerified: true,
    notifyEmail: true,
    notifySms: false,
    createdAt: T,
  },
  reports: [
    {
      reference: "CF-7K3M9QXD",
      categoryName: "Roads and potholes",
      description: "A deep pothole",
      lon: 3.3792,
      lat: 6.5244,
      status: "resolved",
      createdAt: T,
      agencyName: "Lagos Roads Agency",
      areaName: "Ikeja",
      photos: [{ publicId: "civicflow/reports/u/p1", imageUrl: "https://img.example/p1" }],
      history: [
        { status: "submitted", at: T, note: null, by: "you" },
        { status: "routed", at: T, note: null, by: "system" },
        { status: "acknowledged", at: T, note: "We will visit on Monday", by: "agency" },
      ],
    },
  ],
  notifications: [{ event: "report_received", channel: "email", status: "sent", createdAt: T, sentAt: T }],
};

describe("buildDataExport", () => {
  const result = buildDataExport(source, NOW);

  it("labels the file and says when it was made", () => {
    expect(result.format).toBe(DATA_EXPORT_FORMAT);
    expect(result.exportedAt).toBe("2026-06-30T12:00:00.000Z");
    expect(result.note).toContain("copy of the personal data");
  });

  it("contains the person's own profile, with the full phone number", () => {
    expect(result.profile).toEqual({
      email: "alice@example.com",
      name: "Alice Example",
      role: "resident",
      phone: "+2348031234567",
      phoneConfirmed: true,
      emailUpdates: true,
      smsUpdates: false,
      accountCreatedAt: "2026-03-01T09:00:00.000Z",
    });
  });

  it("contains their reports with description, exact location, photos and history", () => {
    expect(result.reports).toEqual([
      {
        reference: "CF-7K3M9QXD",
        category: "Roads and potholes",
        description: "A deep pothole",
        location: { longitude: 3.3792, latitude: 6.5244 },
        status: "resolved",
        reportedAt: "2026-03-01T09:00:00.000Z",
        handledBy: "Lagos Roads Agency",
        area: "Ikeja",
        photos: [{ id: "civicflow/reports/u/p1", url: "https://img.example/p1" }],
        history: [
          { status: "submitted", at: "2026-03-01T09:00:00.000Z", note: null, by: "you" },
          { status: "routed", at: "2026-03-01T09:00:00.000Z", note: null, by: "system" },
          { status: "acknowledged", at: "2026-03-01T09:00:00.000Z", note: "We will visit on Monday", by: "agency" },
        ],
      },
    ]);
  });

  it("lists which messages were sent, never their text", () => {
    expect(result.messagesSentToYou).toEqual([
      { event: "report_received", channel: "email", status: "sent", queuedAt: "2026-03-01T09:00:00.000Z", sentAt: "2026-03-01T09:00:00.000Z" },
    ]);
  });

  it("uses exactly these top-level and profile fields: nothing else can slip in", () => {
    expect(Object.keys(result).sort()).toEqual(["exportedAt", "format", "messagesSentToYou", "note", "profile", "reports"]);
    expect(Object.keys(result.profile).sort()).toEqual(
      ["accountCreatedAt", "email", "emailUpdates", "name", "phone", "phoneConfirmed", "role", "smsUpdates"],
    );
  });

  it("drops every extra field a source row might carry (secrets, other people's ids)", () => {
    const hostile = {
      ...source,
      profile: { ...source.profile, id: "user-1", codeHash: "deadbeef", sessionToken: "tok", disabledAt: T },
      reports: [
        {
          ...source.reports[0],
          reporterId: "user-1",
          idempotencyKey: "key-123",
          history: [{ status: "acknowledged", at: T, note: "ok", by: "agency", actorId: "staff-77", actorEmail: "officer@example.com" }],
        },
      ],
      notifications: [{ ...source.notifications[0], recipientUserId: "user-1", lastError: "provider_unavailable" }],
    } as unknown as ExportSource;
    const text = JSON.stringify(buildDataExport(hostile, NOW));
    for (const secret of ["user-1", "deadbeef", "tok", "key-123", "staff-77", "officer@example.com", "provider_unavailable", "disabledAt"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("handles a person with nothing: no reports, no messages, no phone", () => {
    const empty = buildDataExport(
      { profile: { ...source.profile, phoneE164: null, phoneVerified: false, name: null }, reports: [], notifications: [] },
      NOW,
    );
    expect(empty.reports).toEqual([]);
    expect(empty.messagesSentToYou).toEqual([]);
    expect(empty.profile).toMatchObject({ phone: null, name: null, phoneConfirmed: false });
  });

  it("is plain JSON: it survives being written out and read back unchanged", () => {
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});
