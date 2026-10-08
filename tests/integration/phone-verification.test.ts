import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { phoneVerifications, rateLimits, users } from "@/db/schema";
import { fixedClock } from "@/domain/clock";
import { FakeSmsSender } from "@/server/adapters/sms";
import { updateNotificationPreferences } from "@/server/account/preferences";
import {
  PHONE_RATE_RULES,
  confirmPhoneVerification,
  removePhone,
  startPhoneVerification,
  type PhoneDeps,
} from "@/server/account/phone";
import { UnauthenticatedError } from "@/server/auth/errors";
import type { AuthenticatedActor } from "@/server/auth/session-user";
import { PostgresRateLimiter } from "@/server/rate-limit/postgres-rate-limiter";
import { findNotificationSettings } from "@/server/repositories/account";
import { setupTestDb } from "./test-db";

let conn: Awaited<ReturnType<typeof setupTestDb>>;
let sms: FakeSmsSender;
let clock: ReturnType<typeof fixedClock>;
let deps: PhoneDeps;
let alice: AuthenticatedActor;
let bob: AuthenticatedActor;
const START = new Date("2026-03-01T09:00:00Z");
const PHONE = "0803 123 4567";
const E164 = "+2348031234567";

beforeAll(async () => {
  conn = await setupTestDb();
});

beforeEach(async () => {
  clock = fixedClock(START);
  sms = new FakeSmsSender();
  await conn.db.delete(rateLimits);
  await conn.db.delete(users);
  const [a, b] = await conn.db
    .insert(users)
    .values([{ email: "alice@example.com" }, { email: "bob@example.com" }])
    .returning();
  if (!a || !b) throw new Error("users missing");
  alice = { userId: a.id, role: "resident", agencyId: null };
  bob = { userId: b.id, role: "resident", agencyId: null };
  deps = {
    db: conn.db,
    clock,
    sms,
    limiter: new PostgresRateLimiter(conn.db, clock),
    secret: "s".repeat(32),
    randomBytes: (n) => randomBytes(n),
  };
});

afterAll(async () => {
  await conn.db.delete(rateLimits);
  await conn.db.delete(users);
  await conn.pool.end();
});

const lastCode = () => /\d{6}/.exec(sms.sent.at(-1)?.text ?? "")?.[0] ?? "";
const userRow = async (id: string) => (await conn.db.select().from(users).where(eq(users.id, id)))[0];
const pendingRow = async (id: string) =>
  (await conn.db.select().from(phoneVerifications).where(eq(phoneVerifications.userId, id)))[0];

describe("startPhoneVerification", () => {
  it("texts a code to the normalized number and stores only its hash", async () => {
    const result = await startPhoneVerification(deps, alice, { phone: PHONE });
    expect(result).toEqual({ ok: true, maskedPhone: "+234********67" });
    expect(sms.sent).toHaveLength(1);
    expect(sms.sent[0]?.to).toBe(E164);
    expect(lastCode()).toMatch(/^\d{6}$/);

    const pending = await pendingRow(alice.userId);
    expect(pending?.phoneE164).toBe(E164);
    expect(pending?.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(pending)).not.toContain(lastCode());
    expect(pending?.expiresAt).toEqual(new Date(START.getTime() + 10 * 60_000));
    // Nothing is saved on the user until the code is confirmed.
    expect(await userRow(alice.userId)).toMatchObject({ phoneE164: null, phoneVerifiedAt: null });
  });

  it("requires a sign-in", async () => {
    await expect(startPhoneVerification(deps, null, { phone: PHONE })).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("rejects malformed input and numbers that are not Nigerian mobiles, sending nothing", async () => {
    expect(await startPhoneVerification(deps, alice, {})).toEqual({ ok: false, reason: "malformed" });
    expect(await startPhoneVerification(deps, alice, { phone: "+14155550123" })).toEqual({ ok: false, reason: "invalid_phone" });
    expect(await startPhoneVerification(deps, alice, { phone: "12345" })).toEqual({ ok: false, reason: "invalid_phone" });
    expect(sms.sent).toHaveLength(0);
  });

  it("says so when SMS is switched off for the deployment", async () => {
    expect(await startPhoneVerification({ ...deps, sms: null }, alice, { phone: PHONE })).toEqual({
      ok: false,
      reason: "sms_unavailable",
    });
    expect(await pendingRow(alice.userId)).toBeUndefined();
  });

  it("limits how many codes one account can request", async () => {
    for (let i = 0; i < PHONE_RATE_RULES.hour.limit; i++) {
      expect(await startPhoneVerification(deps, alice, { phone: PHONE })).toMatchObject({ ok: true });
    }
    expect(await startPhoneVerification(deps, alice, { phone: PHONE })).toEqual({ ok: false, reason: "rate_limited" });
    expect(sms.sent).toHaveLength(PHONE_RATE_RULES.hour.limit);
    // Another account is unaffected.
    expect(await startPhoneVerification(deps, bob, { phone: "0901 234 5678" })).toMatchObject({ ok: true });
  });

  it("removes the pending code when the SMS cannot be sent", async () => {
    sms.failOnNextSend();
    expect(await startPhoneVerification(deps, alice, { phone: PHONE })).toEqual({ ok: false, reason: "delivery_failed" });
    expect(await pendingRow(alice.userId)).toBeUndefined();
  });

  it("does not text a number that is already verified for the account", async () => {
    await startPhoneVerification(deps, alice, { phone: PHONE });
    await confirmPhoneVerification(deps, alice, { code: lastCode() });
    sms.sent.length = 0;
    expect(await startPhoneVerification(deps, alice, { phone: "+2348031234567" })).toEqual({
      ok: false,
      reason: "already_verified",
    });
    expect(sms.sent).toHaveLength(0);
  });
});

describe("confirmPhoneVerification", () => {
  it("verifies the number and leaves SMS off until the user opts in", async () => {
    await startPhoneVerification(deps, alice, { phone: PHONE });
    clock.advance(60_000);
    expect(await confirmPhoneVerification(deps, alice, { code: lastCode() })).toEqual({ ok: true });
    expect(await userRow(alice.userId)).toMatchObject({
      phoneE164: E164,
      phoneVerifiedAt: new Date(START.getTime() + 60_000),
      notifySms: false,
    });
    expect(await pendingRow(alice.userId)).toBeUndefined();
  });

  it("accepts a code typed with spaces", async () => {
    await startPhoneVerification(deps, alice, { phone: PHONE });
    const code = lastCode();
    expect(await confirmPhoneVerification(deps, alice, { code: `${code.slice(0, 3)} ${code.slice(3)}` })).toEqual({ ok: true });
  });

  it("rejects a wrong code and counts the attempt", async () => {
    await startPhoneVerification(deps, alice, { phone: PHONE });
    const wrong = lastCode() === "000000" ? "111111" : "000000";
    expect(await confirmPhoneVerification(deps, alice, { code: wrong })).toEqual({ ok: false, reason: "wrong_code" });
    expect((await pendingRow(alice.userId))?.attempts).toBe(1);
    expect(await userRow(alice.userId)).toMatchObject({ phoneE164: null });
  });

  it("locks the code after five wrong guesses, even for the right code", async () => {
    await startPhoneVerification(deps, alice, { phone: PHONE });
    const right = lastCode();
    const wrong = right === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) {
      expect(await confirmPhoneVerification(deps, alice, { code: wrong })).toEqual({ ok: false, reason: "wrong_code" });
    }
    expect(await confirmPhoneVerification(deps, alice, { code: right })).toEqual({ ok: false, reason: "too_many_attempts" });
    expect(await pendingRow(alice.userId)).toBeUndefined();
    expect(await userRow(alice.userId)).toMatchObject({ phoneE164: null });
  });

  it("accepts the code exactly at ten minutes and rejects it a second later", async () => {
    await startPhoneVerification(deps, alice, { phone: PHONE });
    const code = lastCode();
    clock.advance(10 * 60_000 + 1000);
    expect(await confirmPhoneVerification(deps, alice, { code })).toEqual({ ok: false, reason: "expired" });
    expect(await pendingRow(alice.userId)).toBeUndefined();

    await startPhoneVerification(deps, alice, { phone: PHONE });
    const second = lastCode();
    clock.advance(10 * 60_000);
    expect(await confirmPhoneVerification(deps, alice, { code: second })).toEqual({ ok: true });
  });

  it("replaces an earlier code when a new one is requested, and ties a code to its number", async () => {
    await startPhoneVerification(deps, alice, { phone: PHONE });
    const first = lastCode();
    await startPhoneVerification(deps, alice, { phone: "0901 234 5678" });
    const second = lastCode();
    if (first !== second) {
      expect(await confirmPhoneVerification(deps, alice, { code: first })).toEqual({ ok: false, reason: "wrong_code" });
    }
    expect(await confirmPhoneVerification(deps, alice, { code: second })).toEqual({ ok: true });
    expect(await userRow(alice.userId)).toMatchObject({ phoneE164: "+2349012345678" });
  });

  it("turns SMS back off when a new number is verified", async () => {
    await startPhoneVerification(deps, alice, { phone: PHONE });
    await confirmPhoneVerification(deps, alice, { code: lastCode() });
    await updateNotificationPreferences(deps, alice, { notifyEmail: true, notifySms: true });
    await startPhoneVerification(deps, alice, { phone: "0901 234 5678" });
    await confirmPhoneVerification(deps, alice, { code: lastCode() });
    expect(await userRow(alice.userId)).toMatchObject({ phoneE164: "+2349012345678", notifySms: false });
  });

  it("handles missing, malformed and someone else's codes", async () => {
    expect(await confirmPhoneVerification(deps, alice, { code: "123456" })).toEqual({ ok: false, reason: "no_pending" });
    expect(await confirmPhoneVerification(deps, alice, { code: "12ab56" })).toEqual({ ok: false, reason: "malformed" });
    expect(await confirmPhoneVerification(deps, alice, {})).toEqual({ ok: false, reason: "malformed" });
    await expect(confirmPhoneVerification(deps, null, { code: "123456" })).rejects.toBeInstanceOf(UnauthenticatedError);

    await startPhoneVerification(deps, alice, { phone: PHONE });
    // Bob cannot use Alice's pending code: he has none of his own.
    expect(await confirmPhoneVerification(deps, bob, { code: lastCode() })).toEqual({ ok: false, reason: "no_pending" });
    expect(await userRow(bob.userId)).toMatchObject({ phoneE164: null });
  });
});

describe("removePhone", () => {
  it("clears the number, consent and any pending code, and touches nobody else", async () => {
    await startPhoneVerification(deps, alice, { phone: PHONE });
    await confirmPhoneVerification(deps, alice, { code: lastCode() });
    await updateNotificationPreferences(deps, alice, { notifyEmail: true, notifySms: true });
    await startPhoneVerification(deps, bob, { phone: "0901 234 5678" });
    await confirmPhoneVerification(deps, bob, { code: lastCode() });

    await removePhone(deps, alice);
    expect(await userRow(alice.userId)).toMatchObject({ phoneE164: null, phoneVerifiedAt: null, notifySms: false });
    expect(await userRow(bob.userId)).toMatchObject({ phoneE164: "+2349012345678" });
    await expect(removePhone(deps, null)).rejects.toBeInstanceOf(UnauthenticatedError);
  });
});

describe("updateNotificationPreferences", () => {
  it("lets a user switch report emails off and on", async () => {
    expect(await updateNotificationPreferences(deps, alice, { notifyEmail: false, notifySms: false })).toEqual({ ok: true });
    expect(await userRow(alice.userId)).toMatchObject({ notifyEmail: false });
    await updateNotificationPreferences(deps, alice, { notifyEmail: true, notifySms: false });
    expect(await userRow(alice.userId)).toMatchObject({ notifyEmail: true });
  });

  it("refuses SMS without a verified number, and allows it with one", async () => {
    expect(await updateNotificationPreferences(deps, alice, { notifyEmail: true, notifySms: true })).toEqual({
      ok: false,
      reason: "phone_not_verified",
    });
    await startPhoneVerification(deps, alice, { phone: PHONE });
    expect(await updateNotificationPreferences(deps, alice, { notifyEmail: true, notifySms: true })).toEqual({
      ok: false,
      reason: "phone_not_verified",
    });
    await confirmPhoneVerification(deps, alice, { code: lastCode() });
    expect(await updateNotificationPreferences(deps, alice, { notifyEmail: true, notifySms: true })).toEqual({ ok: true });
    expect(await userRow(alice.userId)).toMatchObject({ notifySms: true });
  });

  it("only ever changes the caller's own settings, and needs a sign-in and valid input", async () => {
    await updateNotificationPreferences(deps, alice, { notifyEmail: false, notifySms: false });
    expect(await userRow(bob.userId)).toMatchObject({ notifyEmail: true });
    await expect(updateNotificationPreferences(deps, null, { notifyEmail: true, notifySms: false })).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    expect(await updateNotificationPreferences(deps, alice, { notifyEmail: "yes" })).toEqual({ ok: false, reason: "malformed" });
  });
});

describe("findNotificationSettings", () => {
  it("shows masked numbers only, and a pending code", async () => {
    expect(await findNotificationSettings(conn.db, alice.userId)).toEqual({
      notifyEmail: true,
      notifySms: false,
      maskedPhone: null,
      phoneVerified: false,
      pending: null,
    });
    await startPhoneVerification(deps, alice, { phone: PHONE });
    const pending = await findNotificationSettings(conn.db, alice.userId);
    expect(pending?.pending).toEqual({ maskedPhone: "+234********67", expiresAt: new Date(START.getTime() + 10 * 60_000) });
    expect(JSON.stringify(pending)).not.toContain("8031234567");

    await confirmPhoneVerification(deps, alice, { code: lastCode() });
    expect(await findNotificationSettings(conn.db, alice.userId)).toMatchObject({
      maskedPhone: "+234********67",
      phoneVerified: true,
      pending: null,
    });
  });
});
