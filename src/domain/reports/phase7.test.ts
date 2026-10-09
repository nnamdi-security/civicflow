import { describe, expect, it } from "vitest";
import { fixedClock } from "../clock";
import { AUTO_CONFIRM_DAYS, AUTO_CONFIRM_REASON, autoConfirmDueAt, isAutoConfirmDue } from "./auto-confirm";
import { daysOverdue, toPublicReport, type PublicReportSource } from "./public-view";

const DAY = 24 * 60 * 60 * 1000;
const RESOLVED = new Date("2026-03-01T09:00:00Z");
const at = (ms: number) => fixedClock(new Date(RESOLVED.getTime() + ms));

describe("auto-confirm timing", () => {
  it("is 14 days, provisional, with a plain reason", () => {
    expect(AUTO_CONFIRM_DAYS).toBe(14);
    expect(AUTO_CONFIRM_REASON).toBe("auto-confirmed after 14 days");
    expect(autoConfirmDueAt(RESOLVED).toISOString()).toBe("2026-03-15T09:00:00.000Z");
  });

  it("is not due one second before, nor exactly at, 14 days", () => {
    expect(isAutoConfirmDue(RESOLVED, at(14 * DAY - 1000))).toBe(false);
    expect(isAutoConfirmDue(RESOLVED, at(14 * DAY))).toBe(false);
  });

  it("is due one second after 14 days", () => {
    expect(isAutoConfirmDue(RESOLVED, at(14 * DAY + 1000))).toBe(true);
  });

  it("is never due without a resolved time", () => {
    expect(isAutoConfirmDue(null, at(1000 * DAY))).toBe(false);
  });
});

const NOW = new Date("2026-03-20T09:00:00Z");
const source: PublicReportSource = {
  reference: "CF-7K3M9QXD",
  categoryName: "Roads and potholes",
  status: "acknowledged",
  agencyName: "Lagos Roads Agency",
  areaName: "Ikeja",
  createdAt: new Date("2026-03-01T09:00:00Z"),
  ackDueAt: null,
  resolveDueAt: new Date("2026-03-15T09:00:00Z"),
  ackLevel: 3,
  resolveLevel: 1,
  timeline: [
    { toStatus: "submitted", createdAt: new Date("2026-03-01T09:00:00Z") },
    { toStatus: "routed", createdAt: new Date("2026-03-01T09:00:01Z") },
  ],
};

/** Everything private that a database row could carry; none of it may reach the public view. */
const privateFields = {
  id: "3f2b8c1e-9d4a-4b7e-8a61-0c5d2e7f9a10",
  description: "Pothole outside 12 Adeola Odeku St, call me on 08031234567",
  lon: 3.3792,
  lat: 6.5244,
  location: "SRID=4326;POINT(3.3792 6.5244)",
  reporterId: "user-1",
  reporterEmail: "resident@example.com",
  agencyId: "agency-1",
  photos: [{ publicId: "civicflow/user-1/abc" }],
  reason: "Staff note: reporter is a repeat complainer",
  actorId: "staff-1",
};

describe("toPublicReport", () => {
  it("exposes exactly the allow-listed keys, whatever else the source carries", () => {
    const result = toPublicReport({ ...source, ...privateFields } as PublicReportSource, { showSla: true }, fixedClock(NOW));
    expect(Object.keys(result).sort()).toEqual(
      ["agencyName", "areaName", "categoryName", "createdAt", "reference", "sla", "status", "timeline"].sort(),
    );
    expect(Object.keys(result.sla ?? {}).sort()).toEqual(["acknowledgeBy", "overdue", "publiclyOverdue", "resolveBy"]);
    const text = JSON.stringify(result);
    for (const secret of ["Adeola", "08031234567", "3.3792", "6.5244", "resident@example.com", "user-1", "civicflow/", "repeat complainer", "staff-1", "agency-1"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("reduces the timeline to status and time, with no notes or actors", () => {
    const withNotes = {
      ...source,
      timeline: [{ toStatus: "rejected", createdAt: NOW, reason: "private note", actorId: "staff-1" }],
    } as unknown as PublicReportSource;
    const result = toPublicReport(withNotes, { showSla: false }, fixedClock(NOW));
    expect(result.timeline).toEqual([{ status: "rejected", at: NOW }]);
  });

  it("hides every SLA detail unless the switch is on", () => {
    const result = toPublicReport(source, { showSla: false }, fixedClock(NOW));
    expect(result.sla).toBeNull();
    expect(JSON.stringify(result)).not.toContain("2026-03-15");
  });

  it("shows deadlines, overdue timers and the public flag when the switch is on", () => {
    const result = toPublicReport(source, { showSla: true }, fixedClock(NOW));
    expect(result.sla).toEqual({
      acknowledgeBy: null,
      resolveBy: new Date("2026-03-15T09:00:00Z"),
      overdue: ["resolve"],
      publiclyOverdue: true,
    });
  });

  it("is not publicly overdue below level 3", () => {
    const result = toPublicReport({ ...source, ackLevel: 2, resolveLevel: 1 }, { showSla: true }, fixedClock(NOW));
    expect(result.sla?.publiclyOverdue).toBe(false);
    const none = toPublicReport({ ...source, ackLevel: null, resolveLevel: null }, { showSla: true }, fixedClock(NOW));
    expect(none.sla?.publiclyOverdue).toBe(false);
  });

  it("keeps a missing agency or area as null", () => {
    const result = toPublicReport({ ...source, agencyName: null, areaName: null }, { showSla: false }, fixedClock(NOW));
    expect(result).toMatchObject({ agencyName: null, areaName: null });
  });
});

describe("daysOverdue", () => {
  const since = new Date("2026-03-01T09:00:00Z");
  const clockAfter = (ms: number) => fixedClock(new Date(since.getTime() + ms));

  it("counts whole days, rounding down", () => {
    expect(daysOverdue(since, clockAfter(0))).toBe(0);
    expect(daysOverdue(since, clockAfter(DAY - 1000))).toBe(0);
    expect(daysOverdue(since, clockAfter(DAY))).toBe(1);
    expect(daysOverdue(since, clockAfter(3 * DAY + 5 * 3_600_000))).toBe(3);
  });

  it("never goes negative", () => {
    expect(daysOverdue(since, clockAfter(-5 * DAY))).toBe(0);
  });
});
