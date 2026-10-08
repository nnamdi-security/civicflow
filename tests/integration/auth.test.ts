import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { agencies, rateLimits, sessions, users, verificationTokens } from "@/db/schema";
import { fixedClock } from "@/domain/clock";
import { FakeEmailSender } from "@/server/adapters/email";
import { buildAuthConfig, EMAIL_RATE_RULE, SignInRateLimitedError } from "@/server/auth/config";
import { PostgresRateLimiter } from "@/server/rate-limit/postgres-rate-limiter";
import { setupTestDb } from "./test-db";

let conn: Awaited<ReturnType<typeof setupTestDb>>;
let emailSender: FakeEmailSender;
let config: ReturnType<typeof buildAuthConfig>;

const secret = "s".repeat(32);

beforeAll(async () => {
  conn = await setupTestDb();
});

beforeEach(async () => {
  await conn.db.delete(sessions);
  await conn.db.delete(verificationTokens);
  await conn.db.delete(users);
  await conn.db.delete(agencies);
  await conn.db.delete(rateLimits);
  emailSender = new FakeEmailSender();
  config = buildAuthConfig({
    db: conn.db,
    emailSender,
    limiter: new PostgresRateLimiter(conn.db, fixedClock(new Date("2026-01-01T00:00:00Z"))),
    secret,
  });
});

afterAll(async () => {
  await conn.pool.end();
});

function adapter() {
  if (!config.adapter) throw new Error("adapter missing");
  return config.adapter as Required<NonNullable<typeof config.adapter>>;
}

function emailProvider() {
  const provider = config.providers[0];
  if (!provider || typeof provider === "function" || provider.type !== "email") {
    throw new Error("email provider missing");
  }
  return provider as unknown as {
    sendVerificationRequest(params: { identifier: string; url: string }): Promise<void>;
  };
}

describe("sign-in email", () => {
  it("sends the link once through the email adapter", async () => {
    await emailProvider().sendVerificationRequest({
      identifier: "user@example.com",
      url: "https://x.test/cb",
    });
    expect(emailSender.sent).toHaveLength(1);
    expect(emailSender.sent[0]?.to).toBe("user@example.com");
    expect(emailSender.sent[0]?.text).toContain("https://x.test/cb");
  });

  it("blocks further sends to the same address once the limit is reached", async () => {
    const send = () =>
      emailProvider().sendVerificationRequest({ identifier: "user@example.com", url: "https://x.test" });
    for (let i = 0; i < EMAIL_RATE_RULE.limit; i++) await send();
    await expect(send()).rejects.toBeInstanceOf(SignInRateLimitedError);
    expect(emailSender.sent).toHaveLength(EMAIL_RATE_RULE.limit);
  });

  it("limits each address separately", async () => {
    for (let i = 0; i < EMAIL_RATE_RULE.limit + 1; i++) {
      await emailProvider()
        .sendVerificationRequest({ identifier: "a@example.com", url: "https://x.test" })
        .catch(() => undefined);
    }
    await expect(
      emailProvider().sendVerificationRequest({ identifier: "b@example.com", url: "https://x.test" }),
    ).resolves.toBeUndefined();
  });
});

describe("users and sessions through the adapter", () => {
  it("creates new users as residents", async () => {
    const user = await adapter().createUser({
      id: crypto.randomUUID(),
      email: "new@example.com",
      emailVerified: null,
    });
    const stored = await adapter().getUserByEmail("new@example.com");
    expect(stored?.id).toBe(user.id);
    expect((stored as unknown as { role: string }).role).toBe("resident");
  });

  it("finds a pre-provisioned staff user by email, with role and agency intact", async () => {
    const [agency] = await conn.db
      .insert(agencies)
      .values({ name: "Roads", type: "roads" })
      .returning();
    await conn.db
      .insert(users)
      .values({ email: "officer@example.com", role: "agency_officer", agencyId: agency?.id });
    const found = await adapter().getUserByEmail("officer@example.com");
    expect(found).toMatchObject({ role: "agency_officer", agencyId: agency?.id });
  });

  it("uses a verification token only once", async () => {
    const expires = new Date(Date.now() + 60_000);
    await adapter().createVerificationToken({ identifier: "u@example.com", token: "t1", expires });
    const first = await adapter().useVerificationToken({ identifier: "u@example.com", token: "t1" });
    const second = await adapter().useVerificationToken({ identifier: "u@example.com", token: "t1" });
    expect(first?.token).toBe("t1");
    expect(second).toBeNull();
  });

  it("exposes the current role in the session, so a role change applies immediately", async () => {
    const [user] = await conn.db.insert(users).values({ email: "r@example.com" }).returning();
    if (!user) throw new Error("user not created");
    await adapter().createSession({
      sessionToken: "tok",
      userId: user.id,
      expires: new Date(Date.now() + 60_000),
    });

    const sessionCallback = config.callbacks?.session;
    if (!sessionCallback) throw new Error("session callback missing");
    const map = async () => {
      const found = await adapter().getSessionAndUser("tok");
      if (!found) throw new Error("session missing");
      return sessionCallback({
        session: { ...found.session, user: { id: "", email: "", emailVerified: null } },
        user: found.user,
      } as never);
    };

    expect((await map() as { user: { role: string } }).user.role).toBe("resident");
    await conn.db.update(users).set({ role: "platform_admin" });
    expect((await map() as { user: { role: string } }).user.role).toBe("platform_admin");
  });
});
