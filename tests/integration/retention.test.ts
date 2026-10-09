/**
 * Integration tests for the daily housekeeping job (ADR 0015). They use a real database and
 * insert records of known ages, then check exactly which survive.
 *
 * Two kinds of facts are protected:
 *   - OLD, USELESS data is removed, with the boundary exact: a record at the very cut-off instant
 *     is KEPT, and one a second older is deleted;
 *   - DATA THAT MUST SURVIVE is never touched: reports, their history, the audit log, accounts,
 *     and notifications still waiting to be sent.
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  auditLog,
  categories,
  notifications,
  phoneVerifications,
  rateLimits,
  reports,
  sessions,
  statusEvents,
  users,
  verificationTokens,
} from "@/db/schema";
import { fixedClock } from "@/domain/clock";
import { runRetention } from "@/server/retention/run";
import { resetAudit, resetReports, setupTestDb } from "./test-db";

let conn: Awaited<ReturnType<typeof setupTestDb>>;
let userId: string;
let reportId: string;

const NOW = new Date("2026-06-30T12:00:00Z");
const clock = fixedClock(NOW);
const DAY = 24 * 60 * 60 * 1000;
const SECOND = 1000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

beforeAll(async () => {
  conn = await setupTestDb();
});

beforeEach(async () => {
  await cleanup();
  const [user] = await conn.db.insert(users).values({ email: "retention@example.com" }).returning();
  const [category] = await conn.db.select().from(categories).limit(1);
  const [report] = await conn.db
    .insert(reports)
    .values({
      reference: "CF-RETENTION2",
      categoryId: category?.id ?? "",
      reporterId: user?.id ?? "",
      description: "A large pothole on the main road",
      location: sql`ST_SetSRID(ST_MakePoint(3.3792, 6.5244), 4326)::geography` as unknown as string,
      idempotencyKey: crypto.randomUUID(),
    })
    .returning();
  userId = user?.id ?? "";
  reportId = report?.id ?? "";
});

afterEach(cleanup);

afterAll(async () => {
  await conn.pool.end();
});

async function cleanup() {
  await resetAudit(conn.db);
  await resetReports(conn.db);
  await conn.db.delete(rateLimits);
  await conn.db.delete(verificationTokens);
  await conn.db.delete(users);
}

/** Queues a notification record with a given status and age (how long ago it was created). */
async function notification(status: "pending" | "sent" | "skipped" | "failed", createdAgo: number, marker: string) {
  await conn.db.insert(notifications).values({
    reportId,
    event: "report_received",
    channel: "email",
    recipientUserId: userId,
    slaCycle: 0,
    discriminator: marker, // makes each row unique so several can coexist
    status,
    createdAt: ago(createdAgo),
  });
}

const remainingMarkers = async () =>
  (await conn.db.select({ marker: notifications.discriminator }).from(notifications)).map((n) => n.marker).sort();

describe("rate-limit counters (7 days)", () => {
  it("keeps a counter exactly at the cut-off and deletes one a second older", async () => {
    await conn.db.insert(rateLimits).values([
      { key: "k-at-cutoff", windowStart: ago(7 * DAY), count: 1 },
      { key: "k-older", windowStart: ago(7 * DAY + SECOND), count: 1 },
      { key: "k-recent", windowStart: ago(DAY), count: 1 },
    ]);
    const result = await runRetention(conn.db, clock);
    expect(result.rateLimits).toBe(1);
    const left = (await conn.db.select({ key: rateLimits.key }).from(rateLimits)).map((r) => r.key).sort();
    expect(left).toEqual(["k-at-cutoff", "k-recent"]);
  });
});

describe("expired phone codes, sessions and sign-in tokens", () => {
  it("removes only the expired ones", async () => {
    await conn.db.insert(phoneVerifications).values({ userId, phoneE164: "+2348031234567", codeHash: "h", expiresAt: ago(SECOND) });
    await conn.db.insert(sessions).values([
      { sessionToken: "expired", userId, expires: ago(SECOND) },
      { sessionToken: "valid", userId, expires: new Date(NOW.getTime() + DAY) },
    ]);
    await conn.db.insert(verificationTokens).values([
      { identifier: "a@example.com", token: "old", expires: ago(SECOND) },
      { identifier: "a@example.com", token: "fresh", expires: new Date(NOW.getTime() + 60_000) },
    ]);

    const result = await runRetention(conn.db, clock);
    expect(result).toMatchObject({ phoneVerifications: 1, sessions: 1, verificationTokens: 1 });
    expect((await conn.db.select().from(sessions)).map((s) => s.sessionToken)).toEqual(["valid"]);
    expect((await conn.db.select().from(verificationTokens)).map((t) => t.token)).toEqual(["fresh"]);
  });

  it("keeps a code that has not yet expired, and one expiring exactly now", async () => {
    await conn.db.insert(phoneVerifications).values({ userId, phoneE164: "+2348031234567", codeHash: "h", expiresAt: NOW });
    expect((await runRetention(conn.db, clock)).phoneVerifications).toBe(0);
    expect(await conn.db.select().from(phoneVerifications)).toHaveLength(1);
  });
});

describe("notification records", () => {
  it("deletes delivered and skipped records after 90 days, with an exact boundary", async () => {
    await notification("sent", 90 * DAY, "sent-at-cutoff");
    await notification("sent", 90 * DAY + SECOND, "sent-older");
    await notification("skipped", 90 * DAY + SECOND, "skipped-older");
    await notification("sent", 10 * DAY, "sent-recent");
    const result = await runRetention(conn.db, clock);
    expect(result.notificationsDelivered).toBe(2);
    expect(await remainingMarkers()).toEqual(["sent-at-cutoff", "sent-recent"]);
  });

  it("keeps failed records longer, deleting them only after 180 days", async () => {
    await notification("failed", 100 * DAY, "failed-100");
    await notification("failed", 180 * DAY, "failed-at-cutoff");
    await notification("failed", 180 * DAY + SECOND, "failed-older");
    const result = await runRetention(conn.db, clock);
    expect(result.notificationsFailed).toBe(1);
    expect(await remainingMarkers()).toEqual(["failed-100", "failed-at-cutoff"]);
  });

  it("NEVER deletes a notification that is still waiting to be sent, however old", async () => {
    await notification("pending", 400 * DAY, "pending-ancient");
    await runRetention(conn.db, clock);
    expect(await remainingMarkers()).toEqual(["pending-ancient"]);
  });
});

describe("what must survive", () => {
  it("never touches reports, their history, the audit log or accounts, however old", async () => {
    // A very old report with history, and an old audit entry.
    await conn.db.update(reports).set({ createdAt: ago(1000 * DAY) }).where(eq(reports.id, reportId));
    await conn.db.insert(statusEvents).values({ reportId, fromStatus: null, toStatus: "submitted", createdAt: ago(1000 * DAY) });
    await conn.db.insert(auditLog).values({
      actorId: userId,
      actorRole: "platform_admin",
      action: "agency.created",
      targetType: "agency",
      summary: "created agency",
      createdAt: ago(1000 * DAY),
    });

    await runRetention(conn.db, clock);

    expect(await conn.db.select().from(reports)).toHaveLength(1);
    expect(await conn.db.select().from(statusEvents)).toHaveLength(1);
    expect(await conn.db.select().from(auditLog)).toHaveLength(1);
    expect(await conn.db.select().from(users)).toHaveLength(1);
  });
});

describe("running it repeatedly and in batches", () => {
  it("does nothing the second time", async () => {
    await conn.db.insert(rateLimits).values({ key: "old", windowStart: ago(30 * DAY), count: 1 });
    await notification("sent", 200 * DAY, "old-sent");
    const first = await runRetention(conn.db, clock);
    const second = await runRetention(conn.db, clock);
    expect(first.rateLimits + first.notificationsDelivered).toBe(2);
    expect(Object.values(second).reduce((sum, n) => sum + n, 0)).toBe(0);
  });

  it("works through more rows than fit in one batch", async () => {
    // Seven old counters with a batch size of three: needs three rounds (3 + 3 + 1).
    await conn.db.insert(rateLimits).values(Array.from({ length: 7 }, (_, i) => ({ key: `old-${i}`, windowStart: ago(30 * DAY), count: 1 })));
    await conn.db.insert(rateLimits).values({ key: "recent", windowStart: ago(DAY), count: 1 });
    const result = await runRetention(conn.db, clock, 3);
    expect(result.rateLimits).toBe(7);
    expect((await conn.db.select().from(rateLimits)).map((r) => r.key)).toEqual(["recent"]);
  });

  it("returns only counts, never the deleted data", async () => {
    await notification("sent", 200 * DAY, "secret-marker");
    const result = await runRetention(conn.db, clock);
    expect(JSON.stringify(result)).not.toContain("secret-marker");
    expect(JSON.stringify(result)).not.toContain("retention@example.com");
  });
});
