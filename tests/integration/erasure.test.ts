/**
 * Integration tests for account erasure (ADR 0015). They run the real use case against a real
 * database, with a scenario of two residents (Alice, who erases her account, and Bob, who does
 * not) and a staff officer.
 *
 * Two promises are tested with equal care:
 *   1. everything personal about Alice is gone: her identity, her words, her exact locations, her
 *      photos, her sessions and message records;
 *   2. everything that is NOT hers is untouched: Bob's data, the staff officer's notes, and the
 *      public record of what happened to Alice's reports (category, status, agency, area, timeline).
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  agencies,
  auditLog,
  categories,
  jurisdictions,
  mediaDeletions,
  notifications,
  phoneVerifications,
  rateLimits,
  reportMedia,
  reports,
  sessions,
  statusEvents,
  users,
  verificationTokens,
} from "@/db/schema";
import { fixedClock } from "@/domain/clock";
import { FakeEmailSender } from "@/server/adapters/email";
import { ForbiddenError, UnauthenticatedError } from "@/server/auth/errors";
import { isDeactivatedUser } from "@/server/auth/config";
import type { AuthenticatedActor } from "@/server/auth/session-user";
import {
  ERASED_DESCRIPTION,
  ERASE_RATE_RULE,
  eraseAccount,
  type EraseDeps,
} from "@/server/account/erase";
import { PostgresRateLimiter } from "@/server/rate-limit/postgres-rate-limiter";
import { findPublicReportByReference } from "@/server/repositories/public-reports";
import { resetAudit, resetReports, setupTestDb } from "./test-db";

let conn: Awaited<ReturnType<typeof setupTestDb>>;
let email: FakeEmailSender;
let deps: EraseDeps;
let alice: AuthenticatedActor;
let bob: AuthenticatedActor;
let officer: AuthenticatedActor;
let areaId: string;
let agencyId: string;
let aliceInAreaId: string; // Alice's report that sits inside a known area
let aliceNoAreaId: string; // Alice's report that sits outside every area
let bobReportId: string;

const ALICE_EMAIL = "alice.erasure@example.com";
const ALICE_PHONE = "+2348031234567";
const ALICE_NOTE = "still broken, please call me on 08031234567";
const STAFF_NOTE = "inspected the site, will return tomorrow";
const BOB_NOTE = "bob's own note";

beforeAll(async () => {
  conn = await setupTestDb();
});

beforeEach(async () => {
  await cleanup();
  email = new FakeEmailSender();
  deps = {
    db: conn.db,
    email,
    limiter: new PostgresRateLimiter(conn.db, fixedClock(new Date("2026-03-01T09:00:00Z"))),
    secret: "s".repeat(32),
  };

  const [agency] = await conn.db.insert(agencies).values({ name: "ers-agency", type: "roads" }).returning();
  const [area] = await conn.db
    .insert(jurisdictions)
    .values({
      name: "ers-area",
      level: "lga",
      geom: sql`ST_Multi(ST_GeomFromText('POLYGON((8 8, 9 8, 9 9, 8 9, 8 8))', 4326))`,
    })
    .returning();
  const people = await conn.db
    .insert(users)
    .values([
      {
        email: ALICE_EMAIL,
        name: "Alice Example",
        image: "https://example.com/alice.png",
        emailVerified: new Date(),
        phoneE164: ALICE_PHONE,
        phoneVerifiedAt: new Date(),
        notifySms: true,
      },
      { email: "bob.erasure@example.com", name: "Bob Example" },
      { email: "officer.erasure@example.com", role: "agency_officer", agencyId: agency?.id },
    ])
    .returning();
  const [category] = await conn.db.select().from(categories).limit(1);
  if (!agency || !area || !category) throw new Error("fixtures missing");
  agencyId = agency.id;
  areaId = area.id;
  const as = (e: string): AuthenticatedActor => {
    const row = people.find((u) => u.email === e);
    if (!row) throw new Error("user missing");
    return { userId: row.id, role: row.role, agencyId: row.agencyId };
  };
  alice = as(ALICE_EMAIL);
  bob = as("bob.erasure@example.com");
  officer = as("officer.erasure@example.com");

  // Reports. Alice's first sits at an EXACT spot inside the area; the second is outside every area.
  const make = (reference: string, reporterId: string, lon: number, lat: number, jurisdictionId: string | null) =>
    conn.db
      .insert(reports)
      .values({
        reference,
        categoryId: category.id,
        reporterId,
        description: "A deep pothole outside number 12, Adeola Odeku Street",
        location: sql`ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography` as unknown as string,
        idempotencyKey: crypto.randomUUID(),
        status: "routed",
        agencyId: agency.id,
        jurisdictionId,
        routedAt: new Date("2026-03-01T09:00:00Z"),
        slaCycle: 1,
        slaStartedAt: new Date("2026-03-01T09:00:00Z"),
        ackDueAt: new Date("2026-03-02T09:00:00Z"),
      })
      .returning();
  const [a1] = await make("CF-ERASEAAA2", alice.userId, 8.123456, 8.654321, area.id);
  const [a2] = await make("CF-ERASEBBB2", alice.userId, 7.123456, 9.876543, null);
  const [b1] = await make("CF-ERASECCC2", bob.userId, 8.5, 8.5, area.id);
  aliceInAreaId = a1?.id ?? "";
  aliceNoAreaId = a2?.id ?? "";
  bobReportId = b1?.id ?? "";

  // Photos: two on Alice's first report, one on her second, one on Bob's.
  const photo = (reportId: string, publicId: string, position: number) => ({
    reportId,
    publicId,
    format: "jpg",
    width: 800,
    height: 600,
    bytes: 1000,
    position,
  });
  await conn.db.insert(reportMedia).values([
    photo(aliceInAreaId, "ers/alice-1", 0),
    photo(aliceInAreaId, "ers/alice-2", 1),
    photo(aliceNoAreaId, "ers/alice-3", 0),
    photo(bobReportId, "ers/bob-1", 0),
  ]);

  // History: Alice's own note, a staff note on her report, a note-less event by Alice, and Bob's note.
  await conn.db.insert(statusEvents).values([
    { reportId: aliceInAreaId, fromStatus: null, toStatus: "submitted", actorId: alice.userId, reason: null, createdAt: new Date("2026-03-01T09:00:00Z") },
    { reportId: aliceInAreaId, fromStatus: "resolved", toStatus: "disputed", actorId: alice.userId, reason: ALICE_NOTE, createdAt: new Date("2026-03-03T09:00:00Z") },
    { reportId: aliceInAreaId, fromStatus: "routed", toStatus: "acknowledged", actorId: officer.userId, reason: STAFF_NOTE, createdAt: new Date("2026-03-02T09:00:00Z") },
    { reportId: bobReportId, fromStatus: "resolved", toStatus: "disputed", actorId: bob.userId, reason: BOB_NOTE, createdAt: new Date("2026-03-03T09:00:00Z") },
  ]);

  // Messages, sessions, sign-in link and pending phone code for both residents.
  await conn.db.insert(notifications).values([
    { reportId: aliceInAreaId, event: "report_received", channel: "email", recipientUserId: alice.userId, slaCycle: 0, status: "pending" },
    { reportId: aliceInAreaId, event: "report_routed", channel: "email", recipientUserId: alice.userId, slaCycle: 1, status: "sent" },
    { reportId: bobReportId, event: "report_received", channel: "email", recipientUserId: bob.userId, slaCycle: 0, status: "pending" },
  ]);
  await conn.db.insert(sessions).values([
    { sessionToken: "alice-session", userId: alice.userId, expires: new Date(Date.now() + 3_600_000) },
    { sessionToken: "bob-session", userId: bob.userId, expires: new Date(Date.now() + 3_600_000) },
  ]);
  await conn.db.insert(verificationTokens).values([
    { identifier: ALICE_EMAIL, token: "alice-link", expires: new Date(Date.now() + 60_000) },
    { identifier: "bob.erasure@example.com", token: "bob-link", expires: new Date(Date.now() + 60_000) },
  ]);
  await conn.db.insert(phoneVerifications).values({
    userId: alice.userId,
    phoneE164: ALICE_PHONE,
    codeHash: "h",
    expiresAt: new Date(Date.now() + 60_000),
  });
});

afterEach(cleanup);

afterAll(async () => {
  await conn.pool.end();
});

async function cleanup() {
  await resetAudit(conn.db);
  await resetReports(conn.db);
  await conn.db.delete(mediaDeletions);
  await conn.db.delete(rateLimits);
  await conn.db.delete(verificationTokens);
  await conn.db.delete(users);
  await conn.db.delete(agencies).where(sql`name like 'ers-%'`);
  await conn.db.delete(jurisdictions).where(sql`name like 'ers-%'`);
}

const erase = (as: AuthenticatedActor | null = alice, confirmation: unknown = "DELETE") =>
  eraseAccount(deps, as, { confirmation });
const userRow = async (id: string) => (await conn.db.select().from(users).where(eq(users.id, id)))[0];
const reportRow = async (id: string) => (await conn.db.select().from(reports).where(eq(reports.id, id)))[0];

/** Where a report is, as longitude/latitude numbers. */
async function whereIs(reportId: string) {
  const r = await conn.db.execute<{ lon: number; lat: number }>(
    sql`select ST_X(location::geometry) as lon, ST_Y(location::geometry) as lat from reports where id = ${reportId}`,
  );
  return { lon: Number(r.rows[0]?.lon), lat: Number(r.rows[0]?.lat) };
}

// -------------------------------------------------------------------------------------------
describe("who may erase an account", () => {
  it("lets a resident erase their own account", async () => {
    expect(await erase()).toEqual({ ok: true });
  });

  it("refuses staff (they are deactivated by an admin instead) and people who are not signed in", async () => {
    await expect(erase(officer)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(erase(null)).rejects.toBeInstanceOf(UnauthenticatedError);
    expect((await userRow(officer.userId))?.erasedAt).toBeNull();
  });

  it("only ever affects the signed-in person: there is no way to name someone else", async () => {
    // The use case takes the person from the session. Even a hostile extra field is ignored.
    await eraseAccount(deps, alice, { confirmation: "DELETE", userId: bob.userId });
    expect((await userRow(bob.userId))?.erasedAt).toBeNull();
    expect((await userRow(alice.userId))?.erasedAt).not.toBeNull();
  });

  it("needs the exact confirmation word, and changes nothing without it", async () => {
    // (Not `undefined`: that would trigger the helper's default argument. A missing field is tested below.)
    for (const wrong of ["delete", "yes", "", "DELETE ME", 5, null]) {
      expect((await erase(alice, wrong)).ok, `confirmation ${JSON.stringify(wrong)}`).toBe(false);
    }
    expect(await eraseAccount(deps, alice, {})).toEqual({ ok: false, reason: "malformed" });
    expect(await eraseAccount(deps, alice, "nonsense")).toEqual({ ok: false, reason: "malformed" });
    expect((await userRow(alice.userId))?.erasedAt).toBeNull(); // nothing happened

    expect(await erase(alice, "  DELETE  ")).toEqual({ ok: true }); // surrounding spaces are fine
  });

  it("reports an account that is already erased, instead of doing it again", async () => {
    await erase();
    expect(await erase()).toEqual({ ok: false, reason: "already_erased" });
    expect(email.sent).toHaveLength(1); // the "deleted" email went out only once
  });

  it("limits repeated confirmed attempts (typing the wrong word does not count)", async () => {
    // Make every attempt fail inside the transaction, so the account is never erased and the
    // person keeps retrying. Each confirmed attempt counts; after the limit they are told to wait.
    const failing: EraseDeps = {
      ...deps,
      beforeCommit: async () => {
        throw new Error("simulated failure");
      },
    };
    for (let i = 0; i < ERASE_RATE_RULE.limit; i++) {
      await expect(eraseAccount(failing, alice, { confirmation: "DELETE" })).rejects.toThrow();
    }
    expect(await eraseAccount(failing, alice, { confirmation: "DELETE" })).toEqual({ ok: false, reason: "rate_limited" });
    // Typos before that point never used up any attempts.
    expect(await eraseAccount(deps, bob, { confirmation: "nope" })).toEqual({ ok: false, reason: "wrong_confirmation" });
  });
});

// -------------------------------------------------------------------------------------------
describe("everything personal about the person is removed", () => {
  beforeEach(async () => {
    expect(await erase()).toEqual({ ok: true });
  });

  it("strips the account of identity and contact details, and locks it", async () => {
    const row = await userRow(alice.userId);
    expect(row).toMatchObject({
      email: `erased-${alice.userId}@erased.invalid`,
      name: null,
      image: null,
      emailVerified: null,
      phoneE164: null,
      phoneVerifiedAt: null,
      notifyEmail: false,
      notifySms: false,
    });
    expect(row?.erasedAt).toBeInstanceOf(Date);
    expect(row?.disabledAt).toBeInstanceOf(Date);
    expect(isDeactivatedUser(row)).toBe(true); // so nobody can sign in to it
    // Nothing of the old identity is left anywhere in the row.
    const text = JSON.stringify(row);
    for (const secret of [ALICE_EMAIL, "Alice", ALICE_PHONE, "alice.png"]) expect(text).not.toContain(secret);
  });

  it("ends sessions, sign-in links, pending phone codes and message records", async () => {
    expect((await conn.db.select().from(sessions).where(eq(sessions.userId, alice.userId)))).toHaveLength(0);
    expect((await conn.db.select().from(verificationTokens).where(eq(verificationTokens.identifier, ALICE_EMAIL)))).toHaveLength(0);
    expect(await conn.db.select().from(phoneVerifications)).toHaveLength(0);
    expect((await conn.db.select().from(notifications).where(eq(notifications.recipientUserId, alice.userId)))).toHaveLength(0);
  });

  it("replaces the description of every report they filed", async () => {
    expect((await reportRow(aliceInAreaId))?.description).toBe(ERASED_DESCRIPTION);
    expect((await reportRow(aliceNoAreaId))?.description).toBe(ERASED_DESCRIPTION);
    expect(JSON.stringify(await conn.db.select().from(reports).where(eq(reports.reporterId, alice.userId)))).not.toContain("Adeola");
  });

  it("blurs the exact location: to a point inside the area, or to a coarse grid square", async () => {
    const inArea = await whereIs(aliceInAreaId);
    // Not the exact spot any more, but still inside the area (8..9 by 8..9).
    expect([inArea.lon, inArea.lat]).not.toEqual([8.123456, 8.654321]);
    expect(inArea.lon).toBeGreaterThan(8);
    expect(inArea.lon).toBeLessThan(9);
    expect(inArea.lat).toBeGreaterThan(8);
    expect(inArea.lat).toBeLessThan(9);

    // With no area, the point snaps to a 0.1 degree grid (about 11 km): 7.1234 -> 7.1, 9.8765 -> 9.9.
    const noArea = await whereIs(aliceNoAreaId);
    expect(noArea.lon).toBeCloseTo(7.1, 5);
    expect(noArea.lat).toBeCloseTo(9.9, 5);
  });

  it("removes photo records and queues every one of their photos for deletion at the provider", async () => {
    const left = await conn.db.select({ publicId: reportMedia.publicId }).from(reportMedia);
    expect(left.map((p) => p.publicId)).toEqual(["ers/bob-1"]); // only Bob's photo remains
    const queued = (await conn.db.select({ publicId: mediaDeletions.publicId }).from(mediaDeletions)).map((p) => p.publicId).sort();
    expect(queued).toEqual(["ers/alice-1", "ers/alice-2", "ers/alice-3"]);
  });

  it("blanks the notes the person wrote in the history, leaving the events themselves", async () => {
    const events = await conn.db.select().from(statusEvents).where(eq(statusEvents.actorId, alice.userId));
    expect(events).toHaveLength(2); // both events still exist
    expect(events.find((e) => e.toStatus === "disputed")?.reason).toBe("removed");
    expect(events.find((e) => e.toStatus === "submitted")?.reason).toBeNull(); // had no note; stays empty
    expect(JSON.stringify(await conn.db.select().from(statusEvents))).not.toContain("08031234567");
  });

  it("emails the OLD address once, so a hijacked session would be noticed", async () => {
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]).toMatchObject({ to: ALICE_EMAIL, subject: "Your CivicFlow account was deleted" });
    // The message carries no report details.
    expect(email.sent[0]?.text).not.toContain("CF-");
  });

  it("records the erasure in the audit log without any personal data", async () => {
    const entries = await conn.db.select().from(auditLog);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: "account.erased", targetId: alice.userId, actorId: alice.userId });
    const text = JSON.stringify(entries);
    for (const secret of [ALICE_EMAIL, "Alice", ALICE_PHONE]) expect(text).not.toContain(secret);
  });
});

// -------------------------------------------------------------------------------------------
describe("everything that is not theirs is kept", () => {
  beforeEach(async () => {
    await erase();
  });

  it("keeps each of their reports with its reference, category, status, agency and area", async () => {
    const first = await reportRow(aliceInAreaId);
    expect(first).toMatchObject({ reference: "CF-ERASEAAA2", status: "routed", agencyId, jurisdictionId: areaId });
    expect(await reportRow(aliceNoAreaId)).toMatchObject({ reference: "CF-ERASEBBB2", jurisdictionId: null });
  });

  it("keeps the whole status timeline, and the staff officer's own note", async () => {
    const history = await conn.db.select().from(statusEvents).where(eq(statusEvents.reportId, aliceInAreaId));
    expect(history).toHaveLength(3);
    expect(history.find((e) => e.actorId === officer.userId)?.reason).toBe(STAFF_NOTE);
  });

  it("leaves the other resident completely untouched", async () => {
    expect(await userRow(bob.userId)).toMatchObject({ email: "bob.erasure@example.com", name: "Bob Example", erasedAt: null, disabledAt: null });
    expect(await reportRow(bobReportId)).toMatchObject({ description: "A deep pothole outside number 12, Adeola Odeku Street" });
    expect(await whereIs(bobReportId)).toEqual({ lon: 8.5, lat: 8.5 });
    expect((await conn.db.select().from(statusEvents).where(eq(statusEvents.actorId, bob.userId)))[0]?.reason).toBe(BOB_NOTE);
    expect(await conn.db.select().from(sessions).where(eq(sessions.userId, bob.userId))).toHaveLength(1);
    expect(await conn.db.select().from(notifications).where(eq(notifications.recipientUserId, bob.userId))).toHaveLength(1);
    expect((await conn.db.select().from(reportMedia).where(eq(reportMedia.reportId, bobReportId)))).toHaveLength(1);
  });

  it("keeps the report publicly trackable, with no personal details", async () => {
    const view = await findPublicReportByReference(conn.db, "CF-ERASEAAA2");
    expect(view).toMatchObject({ reference: "CF-ERASEAAA2", status: "routed", agencyName: "ers-agency", areaName: "ers-area" });
    expect(view?.timeline.length).toBeGreaterThan(0);
  });
});

// -------------------------------------------------------------------------------------------
describe("all or nothing", () => {
  it("undoes everything if anything fails before the end", async () => {
    const failing: EraseDeps = {
      ...deps,
      beforeCommit: async () => {
        throw new Error("simulated failure at the very last step");
      },
    };
    await expect(eraseAccount(failing, alice, { confirmation: "DELETE" })).rejects.toThrow("simulated failure");

    // Nothing at all changed: she is still fully herself.
    expect(await userRow(alice.userId)).toMatchObject({ email: ALICE_EMAIL, name: "Alice Example", erasedAt: null, phoneE164: ALICE_PHONE });
    expect((await reportRow(aliceInAreaId))?.description).toContain("Adeola");
    expect(await whereIs(aliceInAreaId)).toEqual({ lon: 8.123456, lat: 8.654321 });
    expect(await conn.db.select().from(reportMedia).where(eq(reportMedia.reportId, aliceInAreaId))).toHaveLength(2);
    expect(await conn.db.select().from(mediaDeletions)).toHaveLength(0);
    expect((await conn.db.select().from(statusEvents).where(eq(statusEvents.actorId, alice.userId))).find((e) => e.toStatus === "disputed")?.reason).toBe(ALICE_NOTE);
    expect(await conn.db.select().from(sessions).where(eq(sessions.userId, alice.userId))).toHaveLength(1);
    expect(await conn.db.select().from(auditLog)).toHaveLength(0);
    expect(email.sent).toHaveLength(0); // and no "your account was deleted" email for something that did not happen
  });

  it("still reports success if the confirmation email cannot be sent", async () => {
    email.failOnNextSend();
    expect(await erase()).toEqual({ ok: true });
    expect((await userRow(alice.userId))?.erasedAt).not.toBeNull();
  });
});

// -------------------------------------------------------------------------------------------
describe("the narrow exception to the append-only history", () => {
  // These talk straight to the database, skipping the use case, to prove the exception cannot be abused.
  async function tryStatement(statement: ReturnType<typeof sql>, withErasureSetting: boolean) {
    return conn.db
      .transaction(async (tx) => {
        if (withErasureSetting) await tx.execute(sql`select set_config('civicflow.erasure', 'on', true)`);
        await tx.execute(statement);
      })
      .then(
        () => "allowed",
        () => "refused",
      );
  }

  it("refuses to change history without the erasure setting, as before", async () => {
    expect(await tryStatement(sql`update status_events set reason = 'removed' where actor_id = ${alice.userId}`, false)).toBe("refused");
    expect(await tryStatement(sql`delete from status_events where actor_id = ${alice.userId}`, false)).toBe("refused");
  });

  it("with the setting, allows ONLY changing a reason to the word 'removed'", async () => {
    expect(await tryStatement(sql`update status_events set reason = 'removed' where actor_id = ${alice.userId}`, true)).toBe("allowed");
  });

  it("with the setting, still refuses any other change: other words, other columns, deletes", async () => {
    const id = sql`actor_id = ${bob.userId}`;
    expect(await tryStatement(sql`update status_events set reason = 'something else' where ${id}`, true)).toBe("refused");
    expect(await tryStatement(sql`update status_events set to_status = 'confirmed' where ${id}`, true)).toBe("refused");
    expect(await tryStatement(sql`update status_events set reason = 'removed', to_status = 'confirmed' where ${id}`, true)).toBe("refused");
    expect(await tryStatement(sql`delete from status_events where ${id}`, true)).toBe("refused");
    // Bob's note is still there, word for word.
    expect((await conn.db.select().from(statusEvents).where(eq(statusEvents.actorId, bob.userId)))[0]?.reason).toBe(BOB_NOTE);
  });

  it("the setting only lasts for one transaction", async () => {
    await tryStatement(sql`select 1`, true);
    // A later, separate transaction does NOT have the setting.
    expect(await tryStatement(sql`update status_events set reason = 'removed' where actor_id = ${bob.userId}`, false)).toBe("refused");
  });
});
