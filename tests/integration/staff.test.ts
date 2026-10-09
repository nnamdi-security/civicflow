/**
 * Integration tests for staff management (ADR 0014): inviting people, and deactivating or
 * reactivating accounts. They use a real PostgreSQL database and the real use cases.
 *
 * Deactivation is a SECURITY feature, so the most important tests here prove it really bites:
 *   - an open session stops working immediately;
 *   - a deactivated person cannot sign in again, and is sent no sign-in link;
 *   - they receive no notifications;
 *   - and nobody can use these screens to deactivate people they should not be able to touch.
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { agencies, auditLog, categories, notifications, rateLimits, reports, sessions, users } from "@/db/schema";
import { fixedClock } from "@/domain/clock";
import { FakeEmailSender } from "@/server/adapters/email";
import { FakeSmsSender } from "@/server/adapters/sms";
import { inviteStaff, setStaffActive } from "@/server/admin/staff";
import { buildAuthConfig, isDeactivatedUser } from "@/server/auth/config";
import { ForbiddenError, UnauthenticatedError } from "@/server/auth/errors";
import type { AuthenticatedActor } from "@/server/auth/session-user";
import { runDispatch } from "@/server/notifications/dispatch";
import { PostgresRateLimiter } from "@/server/rate-limit/postgres-rate-limiter";
import { listStaff } from "@/server/repositories/admin";
import { enqueueNotifications } from "@/server/repositories/notifications";
import { resetAudit, resetReports, setupTestDb } from "./test-db";

let conn: Awaited<ReturnType<typeof setupTestDb>>;
let agencyA: string;
let agencyB: string;
// The people in the story. "A" and "B" are two different agencies.
let platform: AuthenticatedActor; // a platform admin
let platform2: AuthenticatedActor; // a second platform admin
let adminA: AuthenticatedActor; // admin of agency A
let officerA: AuthenticatedActor; // officer of agency A
let officerB: AuthenticatedActor; // officer of agency B
let resident: AuthenticatedActor;

const deps = () => ({ db: conn.db });
const secret = "s".repeat(32);

beforeAll(async () => {
  conn = await setupTestDb();
});

beforeEach(async () => {
  await cleanup();
  const agencyRows = await conn.db
    .insert(agencies)
    .values([
      { name: "stf-agency-a", type: "roads" },
      { name: "stf-agency-b", type: "roads" },
    ])
    .returning();
  const a = agencyRows.find((row) => row.name === "stf-agency-a");
  const b = agencyRows.find((row) => row.name === "stf-agency-b");
  if (!a || !b) throw new Error("agencies missing");
  agencyA = a.id;
  agencyB = b.id;

  const rows = await conn.db
    .insert(users)
    .values([
      { email: "stf-platform@example.com", role: "platform_admin" },
      { email: "stf-platform2@example.com", role: "platform_admin" },
      { email: "stf-admin-a@example.com", role: "agency_admin", agencyId: agencyA },
      { email: "stf-officer-a@example.com", role: "agency_officer", agencyId: agencyA },
      { email: "stf-officer-b@example.com", role: "agency_officer", agencyId: agencyB },
      { email: "stf-resident@example.com" },
    ])
    .returning();
  const as = (email: string): AuthenticatedActor => {
    const row = rows.find((u) => u.email === email);
    if (!row) throw new Error("user missing");
    return { userId: row.id, role: row.role, agencyId: row.agencyId };
  };
  platform = as("stf-platform@example.com");
  platform2 = as("stf-platform2@example.com");
  adminA = as("stf-admin-a@example.com");
  officerA = as("stf-officer-a@example.com");
  officerB = as("stf-officer-b@example.com");
  resident = as("stf-resident@example.com");
});

afterEach(cleanup);

afterAll(async () => {
  await conn.pool.end();
});

/** Removes everything these tests create. Order matters: rows that point at users go first. */
async function cleanup() {
  await resetAudit(conn.db);
  await resetReports(conn.db);
  await conn.db.delete(sessions);
  await conn.db.delete(rateLimits);
  await conn.db.delete(users);
  await conn.db.delete(agencies).where(sql`name like 'stf-%'`);
}

const userRow = async (id: string) => (await conn.db.select().from(users).where(eq(users.id, id)))[0];
const auditEntries = async () => conn.db.select().from(auditLog).orderBy(auditLog.createdAt, auditLog.id);

// -------------------------------------------------------------------------------------------
describe("inviteStaff", () => {
  it("lets a platform admin invite an officer into an agency, and audits it WITHOUT the email", async () => {
    const result = await inviteStaff(deps(), platform, { email: "  New.Officer@Example.com ", role: "agency_officer", agencyId: agencyA });
    expect(result).toMatchObject({ ok: true });

    // The account exists with a tidied (lower-case, trimmed) email, the right role and agency.
    const [created] = await conn.db.select().from(users).where(eq(users.email, "new.officer@example.com"));
    expect(created).toMatchObject({ role: "agency_officer", agencyId: agencyA, disabledAt: null });

    const [entry] = await auditEntries();
    expect(entry).toMatchObject({ action: "staff.invited", targetType: "user", targetId: created?.id });
    expect(entry?.summary).toBe('invited a new agency_officer ("stf-agency-a")');
    // The most important part: no email address anywhere in the audit log.
    expect(JSON.stringify(await auditEntries())).not.toContain("example.com");
  });

  it("lets a platform admin invite another platform admin (no agency)", async () => {
    expect(await inviteStaff(deps(), platform, { email: "boss@example.com", role: "platform_admin", agencyId: null })).toMatchObject({ ok: true });
  });

  it("lets an agency admin invite an officer into their OWN agency only", async () => {
    expect(await inviteStaff(deps(), adminA, { email: "ok@example.com", role: "agency_officer", agencyId: agencyA })).toMatchObject({ ok: true });
    // Another agency, an admin role, a platform admin role and a resident are all forbidden.
    const forbidden = [
      { email: "b@example.com", role: "agency_officer", agencyId: agencyB },
      { email: "c@example.com", role: "agency_admin", agencyId: agencyA },
      { email: "d@example.com", role: "platform_admin", agencyId: null },
      { email: "e@example.com", role: "resident", agencyId: null },
    ];
    for (const attempt of forbidden) {
      await expect(inviteStaff(deps(), adminA, attempt)).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect(await conn.db.select().from(users).where(eq(users.email, "b@example.com"))).toHaveLength(0);
  });

  it("refuses officers, residents and signed-out visitors", async () => {
    const body = { email: "x@example.com", role: "agency_officer", agencyId: agencyA };
    await expect(inviteStaff(deps(), officerA, body)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(inviteStaff(deps(), resident, body)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(inviteStaff(deps(), null, body)).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("explains the ordinary mistakes without changing anything", async () => {
    const ok = { role: "agency_officer", agencyId: agencyA };
    expect(await inviteStaff(deps(), platform, { ...ok, email: "not-an-email" })).toEqual({ ok: false, reason: "email_invalid" });
    expect(await inviteStaff(deps(), platform, { ...ok, email: "" })).toEqual({ ok: false, reason: "email_invalid" });
    expect(await inviteStaff(deps(), platform, { ...ok, email: "stf-officer-a@example.com" })).toEqual({ ok: false, reason: "already_exists" });
    expect(await inviteStaff(deps(), platform, { ...ok, email: "z@example.com", agencyId: crypto.randomUUID() })).toEqual({
      ok: false,
      reason: "agency_not_found",
    });
    expect(await inviteStaff(deps(), platform, "nonsense")).toEqual({ ok: false, reason: "malformed" });
    expect(await auditEntries()).toEqual([]); // none of the failures left an audit entry
  });

  it("does not modify an existing account when its email is invited again", async () => {
    await inviteStaff(deps(), platform, { email: "stf-resident@example.com", role: "agency_officer", agencyId: agencyA });
    expect((await userRow(resident.userId))?.role).toBe("resident");
  });
});

// -------------------------------------------------------------------------------------------
describe("setStaffActive: who may deactivate whom", () => {
  it("lets a platform admin deactivate an officer, recording it without an email", async () => {
    expect(await setStaffActive(deps(), platform, { userId: officerA.userId, active: false })).toEqual({ ok: true, changed: true });
    expect((await userRow(officerA.userId))?.disabledAt).toBeInstanceOf(Date);
    const [entry] = await auditEntries();
    expect(entry).toMatchObject({ action: "staff.deactivated", targetId: officerA.userId, summary: "deactivated an account (agency_officer)" });
    expect(JSON.stringify(await auditEntries())).not.toContain("example.com");
  });

  it("lets an agency admin deactivate and reactivate an officer of their own agency", async () => {
    expect(await setStaffActive(deps(), adminA, { userId: officerA.userId, active: false })).toEqual({ ok: true, changed: true });
    expect(await setStaffActive(deps(), adminA, { userId: officerA.userId, active: true })).toEqual({ ok: true, changed: true });
    expect((await userRow(officerA.userId))?.disabledAt).toBeNull();
    expect((await auditEntries()).map((e) => e.action)).toEqual(["staff.deactivated", "staff.reactivated"]);
  });

  it("makes people an agency admin may not manage look like they do not exist", async () => {
    // An officer of ANOTHER agency, the platform admin, and even the admin's own colleague admin.
    for (const target of [officerB, platform, platform2]) {
      expect(await setStaffActive(deps(), adminA, { userId: target.userId, active: false })).toEqual({ ok: false, reason: "not_found" });
    }
    // Residents are never managed here, and unknown ids look the same.
    expect(await setStaffActive(deps(), platform, { userId: resident.userId, active: false })).toEqual({ ok: false, reason: "not_found" });
    expect(await setStaffActive(deps(), platform, { userId: crypto.randomUUID(), active: false })).toEqual({ ok: false, reason: "not_found" });
    expect((await userRow(officerB.userId))?.disabledAt).toBeNull();
    expect(await auditEntries()).toEqual([]);
  });

  it("never lets you deactivate yourself", async () => {
    expect(await setStaffActive(deps(), platform, { userId: platform.userId, active: false })).toEqual({ ok: false, reason: "not_found" });
    expect((await userRow(platform.userId))?.disabledAt).toBeNull();
  });

  it("refuses officers, residents and signed-out visitors", async () => {
    const body = { userId: officerB.userId, active: false };
    await expect(setStaffActive(deps(), officerA, body)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setStaffActive(deps(), resident, body)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setStaffActive(deps(), null, body)).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("does nothing, and logs nothing, if the account is already in that state", async () => {
    expect(await setStaffActive(deps(), platform, { userId: officerA.userId, active: true })).toEqual({ ok: true, changed: false });
    expect(await auditEntries()).toEqual([]);
  });

  it("never deactivates the last active platform admin", async () => {
    // Two platform admins exist. One is deactivated, so the other becomes the last one standing.
    expect(await setStaffActive(deps(), platform, { userId: platform2.userId, active: false })).toEqual({ ok: true, changed: true });

    // Now the deactivated admin's stale credentials try to remove the remaining one. (In real
    // life their session has already ended; this proves the rule holds even so.)
    expect(await setStaffActive(deps(), platform2, { userId: platform.userId, active: false })).toEqual({
      ok: false,
      reason: "last_platform_admin",
    });
    expect((await userRow(platform.userId))?.disabledAt).toBeNull();
  });

  it("holds even when two platform admins deactivate EACH OTHER at the same moment", async () => {
    // Without the row lock inside the transaction, both would see "two admins" and both would
    // succeed, leaving nobody. With it, exactly one wins and the other is refused.
    const results = await Promise.all([
      setStaffActive(deps(), platform, { userId: platform2.userId, active: false }),
      setStaffActive(deps(), platform2, { userId: platform.userId, active: false }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, reason: "last_platform_admin" }]);
    const active = await conn.db.select().from(users).where(sql`role = 'platform_admin' and disabled_at is null`);
    expect(active).toHaveLength(1);
  });

  it("lets a platform admin be deactivated while another active one remains", async () => {
    const [third] = await conn.db.insert(users).values({ email: "stf-platform3@example.com", role: "platform_admin" }).returning();
    expect(await setStaffActive(deps(), platform, { userId: third?.id ?? "", active: false })).toEqual({ ok: true, changed: true });
    // Reactivation is never blocked by the last-admin rule.
    expect(await setStaffActive(deps(), platform, { userId: third?.id ?? "", active: true })).toEqual({ ok: true, changed: true });
  });
});

// -------------------------------------------------------------------------------------------
describe("deactivation really stops access", () => {
  // Builds the real Auth.js configuration, so we test the same code the app runs.
  function authSetup() {
    const emailSender = new FakeEmailSender();
    const config = buildAuthConfig({
      db: conn.db,
      emailSender,
      limiter: new PostgresRateLimiter(conn.db, fixedClock(new Date("2026-01-01T00:00:00Z"))),
      secret,
    });
    const adapter = config.adapter as Required<NonNullable<typeof config.adapter>>;
    const provider = config.providers[0] as unknown as {
      sendVerificationRequest(params: { identifier: string; url: string }): Promise<void>;
    };
    return { emailSender, config, adapter, provider };
  }

  const startSession = async (adapter: ReturnType<typeof authSetup>["adapter"], userId: string, token: string) =>
    adapter.createSession({ sessionToken: token, userId, expires: new Date(Date.now() + 3_600_000) });

  it("ends an open session on the person's very next request", async () => {
    const { adapter } = authSetup();
    await startSession(adapter, officerA.userId, "token-officer-a");
    expect(await adapter.getSessionAndUser("token-officer-a")).not.toBeNull(); // works while active

    await setStaffActive(deps(), platform, { userId: officerA.userId, active: false });
    expect(await adapter.getSessionAndUser("token-officer-a")).toBeNull(); // signed out at once
  });

  it("also deletes the stored sessions, and leaves other people's sessions alone", async () => {
    const { adapter } = authSetup();
    await startSession(adapter, officerA.userId, "token-a");
    await startSession(adapter, officerB.userId, "token-b");
    await setStaffActive(deps(), platform, { userId: officerA.userId, active: false });
    const remaining = await conn.db.select({ token: sessions.sessionToken }).from(sessions);
    expect(remaining.map((r) => r.token)).toEqual(["token-b"]);
    expect(await adapter.getSessionAndUser("token-b")).not.toBeNull();
  });

  it("lets the person back in after reactivation", async () => {
    const { adapter } = authSetup();
    await setStaffActive(deps(), platform, { userId: officerA.userId, active: false });
    await startSession(adapter, officerA.userId, "token-after");
    expect(await adapter.getSessionAndUser("token-after")).toBeNull(); // still deactivated
    await setStaffActive(deps(), platform, { userId: officerA.userId, active: true });
    expect(await adapter.getSessionAndUser("token-after")).not.toBeNull(); // active again
  });

  it("sends no sign-in link to a deactivated account, but does not reveal that", async () => {
    const { emailSender, provider } = authSetup();
    await setStaffActive(deps(), platform, { userId: officerA.userId, active: false });
    // No error is thrown (the page still says "check your email"), but nothing is sent.
    await expect(
      provider.sendVerificationRequest({ identifier: "stf-officer-a@example.com", url: "https://x.test/cb" }),
    ).resolves.toBeUndefined();
    expect(emailSender.sent).toHaveLength(0);
    // An active account, and an address nobody has, behave as before.
    await provider.sendVerificationRequest({ identifier: "stf-officer-b@example.com", url: "https://x.test/cb" });
    await provider.sendVerificationRequest({ identifier: "nobody@example.com", url: "https://x.test/cb" });
    expect(emailSender.sent.map((m) => m.to)).toEqual(["stf-officer-b@example.com", "nobody@example.com"]);
  });

  it("refuses to complete a sign-in for a deactivated account, even with a link sent earlier", async () => {
    const { config } = authSetup();
    // Auth.js passes more than `user`; the part we use is `email.verificationRequest`.
    const signIn = config.callbacks?.signIn as (params: {
      user: unknown;
      email?: { verificationRequest?: boolean };
    }) => boolean;
    await setStaffActive(deps(), platform, { userId: officerA.userId, active: false });
    const deactivated = await userRow(officerA.userId);
    const active = await userRow(officerB.userId);
    expect(signIn({ user: deactivated })).toBe(false);
    expect(signIn({ user: active })).toBe(true);
    // Someone signing in for the first time arrives as a bare object and must not be blocked.
    expect(signIn({ user: { id: "new", email: "new@example.com" } })).toBe(true);
  });

  it("does NOT refuse at the moment a link is requested, so the page cannot reveal a deactivated account", async () => {
    const { config } = authSetup();
    const signIn = config.callbacks?.signIn as (params: {
      user: unknown;
      email?: { verificationRequest?: boolean };
    }) => boolean;
    await setStaffActive(deps(), platform, { userId: officerA.userId, active: false });
    const deactivated = await userRow(officerA.userId);
    // Asking for a link (verificationRequest: true) is allowed to proceed for everyone, deactivated or not...
    expect(signIn({ user: deactivated, email: { verificationRequest: true } })).toBe(true);
    // ...while using a link (no verificationRequest flag) is refused for the deactivated account.
    expect(signIn({ user: deactivated, email: { verificationRequest: false } })).toBe(false);
  });

  it("recognises a deactivated user object in the shapes Auth.js may pass", () => {
    expect(isDeactivatedUser({ disabledAt: new Date() })).toBe(true);
    expect(isDeactivatedUser({ disabledAt: "2026-01-01T00:00:00Z" })).toBe(true);
    for (const notDeactivated of [{ disabledAt: null }, { disabledAt: undefined }, {}, { id: "x" }, null, undefined, "text", 5]) {
      expect(isDeactivatedUser(notDeactivated)).toBe(false);
    }
  });
});

// -------------------------------------------------------------------------------------------
describe("deactivated people get no notifications", () => {
  /** A routed report in agency A, needed as the subject of notifications. */
  async function reportInAgencyA() {
    const [category] = await conn.db.select().from(categories).limit(1);
    const [row] = await conn.db
      .insert(reports)
      .values({
        reference: "CF-STAFFRPT2",
        categoryId: category?.id ?? "",
        reporterId: resident.userId,
        description: "A large pothole on the main road",
        location: sql`ST_SetSRID(ST_MakePoint(3.3792, 6.5244), 4326)::geography` as unknown as string,
        idempotencyKey: crypto.randomUUID(),
        status: "routed",
        agencyId: agencyA,
        routedAt: new Date(),
        slaCycle: 1,
        slaStartedAt: new Date(),
        ackDueAt: new Date(Date.now() + 3_600_000),
      })
      .returning();
    if (!row) throw new Error("report missing");
    return row;
  }

  it("does not queue messages for a deactivated agency admin", async () => {
    const report = await reportInAgencyA();
    await setStaffActive(deps(), platform, { userId: adminA.userId, active: false });
    // "report_disputed" goes to the agency admins. The only admin is deactivated, so none queue.
    const queued = await conn.db.transaction((tx) => enqueueNotifications(tx, { reportId: report.id, event: "report_disputed", slaCycle: 1 }));
    expect(queued).toBe(0);
  });

  it("skips a message that was queued BEFORE the account was deactivated", async () => {
    const report = await reportInAgencyA();
    // Queue first (the admin is active)...
    await conn.db.transaction((tx) => enqueueNotifications(tx, { reportId: report.id, event: "report_disputed", slaCycle: 1 }));
    expect(await conn.db.select().from(notifications)).toHaveLength(1);
    // ...then deactivate, then let the dispatcher run.
    await setStaffActive(deps(), platform, { userId: adminA.userId, active: false });
    const email = new FakeEmailSender();
    const result = await runDispatch({
      db: conn.db,
      clock: fixedClock(new Date(Date.now() + 60_000)),
      email,
      sms: new FakeSmsSender(),
      baseUrl: "https://civicflow.test",
    });
    expect(result).toEqual({ sent: 0, retrying: 0, failed: 0, skipped: 1 });
    expect(email.sent).toHaveLength(0);
    const [row] = await conn.db.select().from(notifications);
    expect(row).toMatchObject({ status: "skipped", skippedReason: "user_deactivated" });
  });
});

// -------------------------------------------------------------------------------------------
describe("listStaff (who each person can see)", () => {
  it("shows a platform admin every staff account but no residents", async () => {
    const rows = await listStaff(conn.db, { kind: "all" });
    expect(rows.map((r) => r.email).sort()).toEqual(
      [
        "stf-admin-a@example.com",
        "stf-officer-a@example.com",
        "stf-officer-b@example.com",
        "stf-platform2@example.com",
        "stf-platform@example.com",
      ].sort(),
    );
  });

  it("shows an agency admin only the people in their own agency", async () => {
    const rows = await listStaff(conn.db, { kind: "agency", agencyId: agencyA });
    expect(rows.map((r) => r.email).sort()).toEqual(["stf-admin-a@example.com", "stf-officer-a@example.com"]);
    expect(JSON.stringify(rows)).not.toContain("officer-b");
  });

  it("shows nothing for the 'none' scope, and marks deactivated accounts", async () => {
    expect(await listStaff(conn.db, { kind: "none" })).toEqual([]);
    await setStaffActive(deps(), platform, { userId: officerA.userId, active: false });
    const rows = await listStaff(conn.db, { kind: "agency", agencyId: agencyA });
    expect(rows.find((r) => r.email === "stf-officer-a@example.com")?.deactivated).toBe(true);
    expect(rows.find((r) => r.email === "stf-admin-a@example.com")?.deactivated).toBe(false);
  });
});
