/**
 * Integration tests for "Download my data" (ADR 0015) against a real database.
 *
 * Two promises, both important:
 *   1. the downloader gets EVERYTHING that is theirs: profile, reports with exact location and
 *      photos, the history of those reports, and which messages were sent to them;
 *   2. the file contains NOTHING that is someone else's, and no secret: not other residents' data,
 *      not the identity of staff who handled their reports, not session tokens or code hashes.
 */
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  agencies,
  categories,
  jurisdictions,
  notifications,
  phoneVerifications,
  rateLimits,
  reportMedia,
  reports,
  sessions,
  statusEvents,
  users,
} from "@/db/schema";
import { fixedClock } from "@/domain/clock";
import { FakeMediaStorage } from "@/server/adapters/media";
import { UnauthenticatedError } from "@/server/auth/errors";
import type { AuthenticatedActor } from "@/server/auth/session-user";
import { EXPORT_RATE_RULE, exportMyData, type ExportDeps } from "@/server/account/export";
import { PostgresRateLimiter } from "@/server/rate-limit/postgres-rate-limiter";
import { resetReports, setupTestDb } from "./test-db";

let conn: Awaited<ReturnType<typeof setupTestDb>>;
let deps: ExportDeps;
let alice: AuthenticatedActor;
let bob: AuthenticatedActor;
let officer: AuthenticatedActor;

const NOW = new Date("2026-06-30T12:00:00Z");
const T = new Date("2026-03-01T09:00:00Z");

beforeAll(async () => {
  conn = await setupTestDb();
});

beforeEach(async () => {
  await cleanup();
  deps = {
    db: conn.db,
    clock: fixedClock(NOW),
    media: new FakeMediaStorage(),
    limiter: new PostgresRateLimiter(conn.db, fixedClock(NOW)),
    secret: "s".repeat(32),
  };

  const [agency] = await conn.db.insert(agencies).values({ name: "exp-agency", type: "roads" }).returning();
  const [area] = await conn.db
    .insert(jurisdictions)
    .values({ name: "exp-area", level: "lga", geom: sql`ST_Multi(ST_GeomFromText('POLYGON((8 8, 9 8, 9 9, 8 9, 8 8))', 4326))` })
    .returning();
  const people = await conn.db
    .insert(users)
    .values([
      { email: "alice.export@example.com", name: "Alice Export", phoneE164: "+2348031234567", phoneVerifiedAt: T, notifySms: true },
      { email: "bob.export@example.com", name: "Bob Export" },
      { email: "officer.export@example.com", name: "Officer Secret", role: "agency_officer", agencyId: agency?.id },
    ])
    .returning();
  const [category] = await conn.db.select().from(categories).limit(1);
  const as = (e: string): AuthenticatedActor => {
    const row = people.find((u) => u.email === e);
    if (!row) throw new Error("user missing");
    return { userId: row.id, role: row.role, agencyId: row.agencyId };
  };
  alice = as("alice.export@example.com");
  bob = as("bob.export@example.com");
  officer = as("officer.export@example.com");

  const make = (reference: string, reporterId: string, description: string) =>
    conn.db
      .insert(reports)
      .values({
        reference,
        categoryId: category?.id ?? "",
        reporterId,
        description,
        location: sql`ST_SetSRID(ST_MakePoint(8.25, 8.75), 4326)::geography` as unknown as string,
        idempotencyKey: crypto.randomUUID(),
        status: "acknowledged",
        agencyId: agency?.id,
        jurisdictionId: area?.id,
        routedAt: T,
        slaCycle: 1,
        slaStartedAt: T,
        resolveDueAt: new Date("2026-03-15T09:00:00Z"),
        createdAt: T,
      })
      .returning();
  const [a1] = await make("CF-EXPORTAA2", alice.userId, "Alice's own description");
  const [b1] = await make("CF-EXPORTBB2", bob.userId, "Bob's private description");

  await conn.db.insert(reportMedia).values([
    { reportId: a1?.id ?? "", publicId: "exp/alice-photo", format: "jpg", width: 800, height: 600, bytes: 1000, position: 0 },
    { reportId: b1?.id ?? "", publicId: "exp/bob-photo", format: "jpg", width: 800, height: 600, bytes: 1000, position: 0 },
  ]);
  await conn.db.insert(statusEvents).values([
    { reportId: a1?.id ?? "", fromStatus: null, toStatus: "submitted", actorId: alice.userId, reason: null, createdAt: new Date("2026-03-01T09:00:00Z") },
    { reportId: a1?.id ?? "", fromStatus: "submitted", toStatus: "routed", actorId: null, reason: "auto-routed", createdAt: new Date("2026-03-01T09:00:01Z") },
    { reportId: a1?.id ?? "", fromStatus: "routed", toStatus: "acknowledged", actorId: officer.userId, reason: "We will visit Monday", createdAt: new Date("2026-03-02T09:00:00Z") },
    { reportId: b1?.id ?? "", fromStatus: null, toStatus: "submitted", actorId: bob.userId, reason: "bob's note", createdAt: new Date("2026-03-01T09:00:00Z") },
  ]);
  await conn.db.insert(notifications).values([
    { reportId: a1?.id ?? "", event: "report_received", channel: "email", recipientUserId: alice.userId, slaCycle: 0, status: "sent", sentAt: T },
    { reportId: b1?.id ?? "", event: "report_received", channel: "email", recipientUserId: bob.userId, slaCycle: 0, status: "sent", sentAt: T },
  ]);
  // Things that must NEVER appear in a download.
  await conn.db.insert(sessions).values({ sessionToken: "SECRET-SESSION-TOKEN", userId: alice.userId, expires: new Date(Date.now() + 3_600_000) });
  await conn.db.insert(phoneVerifications).values({ userId: alice.userId, phoneE164: "+2348031234567", codeHash: "SECRET-CODE-HASH", expiresAt: new Date(Date.now() + 60_000) });
});

afterEach(cleanup);

afterAll(async () => {
  await conn.pool.end();
});

async function cleanup() {
  await resetReports(conn.db);
  await conn.db.delete(rateLimits);
  await conn.db.delete(users);
  await conn.db.delete(agencies).where(sql`name like 'exp-%'`);
  await conn.db.delete(jurisdictions).where(sql`name like 'exp-%'`);
}

async function download(as: AuthenticatedActor = alice) {
  const result = await exportMyData(deps, as);
  if (!result.ok) throw new Error(`export failed: ${result.reason}`);
  return result.data;
}

describe("what the downloader gets", () => {
  it("contains their profile, including the full phone number", async () => {
    const data = await download();
    expect(data.profile).toMatchObject({
      email: "alice.export@example.com",
      name: "Alice Export",
      role: "resident",
      phone: "+2348031234567",
      phoneConfirmed: true,
      smsUpdates: true,
    });
    expect(data.exportedAt).toBe(NOW.toISOString());
  });

  it("contains their report with description, exact location, agency, area and photos", async () => {
    const [report] = (await download()).reports;
    expect(report).toMatchObject({
      reference: "CF-EXPORTAA2",
      description: "Alice's own description",
      location: { longitude: 8.25, latitude: 8.75 },
      status: "acknowledged",
      handledBy: "exp-agency",
      area: "exp-area",
    });
    expect(report?.photos).toEqual([{ id: "exp/alice-photo", url: "https://fake.invalid/w_1600/exp/alice-photo" }]);
  });

  it("contains the report's history, saying who acted only as you, agency or system", async () => {
    const [report] = (await download()).reports;
    expect(report?.history.map((h) => [h.status, h.by])).toEqual([
      ["submitted", "you"],
      ["routed", "system"],
      ["acknowledged", "agency"],
    ]);
    // A note staff wrote about THEIR report is theirs to see.
    expect(report?.history[2]?.note).toBe("We will visit Monday");
  });

  it("lists the messages sent to them, without any text", async () => {
    const data = await download();
    expect(data.messagesSentToYou).toEqual([
      { event: "report_received", channel: "email", status: "sent", queuedAt: expect.any(String), sentAt: T.toISOString() },
    ]);
  });
});

describe("what must NOT be in the file", () => {
  it("leaves out other residents' data entirely", async () => {
    const text = JSON.stringify(await download());
    for (const other of ["Bob", "bob.export@example.com", "CF-EXPORTBB2", "Bob's private description", "exp/bob-photo", "bob's note"]) {
      expect(text).not.toContain(other);
    }
  });

  it("does not reveal who the staff member was: no name, email or id", async () => {
    const text = JSON.stringify(await download());
    for (const staff of ["Officer Secret", "officer.export@example.com", officer.userId]) expect(text).not.toContain(staff);
  });

  it("contains no session tokens, code hashes or the person's own internal id", async () => {
    const text = JSON.stringify(await download());
    for (const secret of ["SECRET-SESSION-TOKEN", "SECRET-CODE-HASH", alice.userId, "idempotency"]) expect(text).not.toContain(secret);
  });

  it("gives each person only their own file", async () => {
    const bobs = await download(bob);
    expect(bobs.profile.email).toBe("bob.export@example.com");
    expect(bobs.reports.map((r) => r.reference)).toEqual(["CF-EXPORTBB2"]);
    expect(JSON.stringify(bobs)).not.toContain("Alice");
  });
});

describe("who can download, and how often", () => {
  it("lets staff download their own data too (which has no reports of theirs)", async () => {
    const data = await download(officer);
    expect(data.profile).toMatchObject({ role: "agency_officer", email: "officer.export@example.com" });
    expect(data.reports).toEqual([]);
  });

  it("requires a sign-in", async () => {
    await expect(exportMyData(deps, null)).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("is rate limited per person, without affecting anyone else", async () => {
    for (let i = 0; i < EXPORT_RATE_RULE.limit; i++) expect((await exportMyData(deps, alice)).ok).toBe(true);
    expect(await exportMyData(deps, alice)).toEqual({ ok: false, reason: "rate_limited" });
    expect((await exportMyData(deps, bob)).ok).toBe(true);
  });

  it("reports an account that no longer exists as not found", async () => {
    const ghost: AuthenticatedActor = { userId: crypto.randomUUID(), role: "resident", agencyId: null };
    expect(await exportMyData(deps, ghost)).toEqual({ ok: false, reason: "not_found" });
  });
});
