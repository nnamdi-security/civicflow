import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { categories, notifications, phoneVerifications, reports, users } from "@/db/schema";
import { resetReports, setupTestDb } from "./test-db";

let conn: Awaited<ReturnType<typeof setupTestDb>>;

beforeAll(async () => {
  conn = await setupTestDb();
});

afterEach(async () => {
  await resetReports(conn.db);
  await conn.db.delete(users);
});

afterAll(async () => {
  await conn.pool.end();
});

async function user(overrides: Partial<typeof users.$inferInsert> = {}) {
  const [row] = await conn.db
    .insert(users)
    .values({ email: `n${Math.random()}@example.com`, ...overrides })
    .returning();
  if (!row) throw new Error("user not created");
  return row;
}

async function report(reporterId: string) {
  const [category] = await conn.db.select().from(categories).limit(1);
  if (!category) throw new Error("category missing");
  const [row] = await conn.db
    .insert(reports)
    .values({
      reference: `CF-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
      categoryId: category.id,
      reporterId,
      description: "A large pothole on the main road",
      location: sql`ST_SetSRID(ST_MakePoint(3.3792, 6.5244), 4326)::geography` as unknown as string,
      idempotencyKey: crypto.randomUUID(),
    })
    .returning();
  if (!row) throw new Error("report not created");
  return row;
}

describe("user phone and preferences", () => {
  it("defaults to email on, SMS off, no phone", async () => {
    expect(await user()).toMatchObject({ phoneE164: null, phoneVerifiedAt: null, notifyEmail: true, notifySms: false });
  });

  it("accepts a normalized Nigerian mobile and rejects other formats", async () => {
    await user({ phoneE164: "+2348031234567" });
    for (const bad of ["08031234567", "+14155550123", "+2346031234567", "+234803123456"]) {
      await expect(user({ phoneE164: bad })).rejects.toThrow();
    }
  });

  it("refuses a verified time without a phone", async () => {
    await expect(user({ phoneVerifiedAt: new Date() })).rejects.toThrow();
  });

  it("refuses SMS on without a verified phone", async () => {
    await expect(user({ notifySms: true })).rejects.toThrow();
    await expect(user({ phoneE164: "+2348031234567", notifySms: true })).rejects.toThrow();
    await user({ phoneE164: "+2348031234567", phoneVerifiedAt: new Date(), notifySms: true });
  });
});

describe("phone_verifications", () => {
  it("holds one pending verification per user and goes with the user", async () => {
    const u = await user();
    const row = { userId: u.id, phoneE164: "+2348031234567", codeHash: "h", expiresAt: new Date(Date.now() + 60_000) };
    await conn.db.insert(phoneVerifications).values(row);
    await expect(conn.db.insert(phoneVerifications).values(row)).rejects.toThrow();
    await conn.db.delete(users).where(eq(users.id, u.id));
    expect(await conn.db.select().from(phoneVerifications)).toHaveLength(0);
  });
});

describe("notifications", () => {
  const base = { event: "report_received", channel: "email", slaCycle: 0 } as const;

  it("starts pending and due now", async () => {
    const u = await user();
    const r = await report(u.id);
    const [row] = await conn.db
      .insert(notifications)
      .values({ ...base, reportId: r.id, recipientUserId: u.id })
      .returning();
    expect(row).toMatchObject({ status: "pending", attempts: 0, discriminator: "", lastError: null, sentAt: null });
  });

  it("is unique per report, event, channel, recipient, cycle and discriminator", async () => {
    const u = await user();
    const other = await user();
    const r = await report(u.id);
    const insert = (overrides: Partial<typeof notifications.$inferInsert> = {}) =>
      conn.db.insert(notifications).values({ ...base, reportId: r.id, recipientUserId: u.id, ...overrides });

    await insert();
    await expect(insert()).rejects.toThrow();
    await insert({ slaCycle: 1 });
    await insert({ channel: "sms" });
    await insert({ recipientUserId: other.id });
    await insert({ event: "escalation_level_1", discriminator: "acknowledge" });
    await insert({ event: "escalation_level_1", discriminator: "resolve" });
  });
});
