import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { agencies, categories, notifications, reports, statusEvents, users } from "@/db/schema";
import { fixedClock } from "@/domain/clock";
import type { NotificationChannel, NotificationEvent } from "@/domain/notifications/events";
import { FakeEmailSender } from "@/server/adapters/email";
import { FakeSmsSender } from "@/server/adapters/sms";
import { runDispatch, type DispatchDeps } from "@/server/notifications/dispatch";
import { resetReports, setupTestDb } from "./test-db";

let conn: Awaited<ReturnType<typeof setupTestDb>>;
let email: FakeEmailSender;
let sms: FakeSmsSender;
let clock: ReturnType<typeof fixedClock>;
let agencyId: string;
let residentId: string;
let adminId: string;
let reportId: string;
const REF = "CF-DISPATCH";
const DESCRIPTION = "A large pothole on the main road near the market";
const START = new Date("2026-03-01T09:00:00Z");
const MINUTE = 60_000;

const deps = (overrides: Partial<DispatchDeps> = {}): DispatchDeps => ({
  db: conn.db,
  clock,
  email,
  sms,
  baseUrl: "https://civicflow.test",
  ...overrides,
});

beforeAll(async () => {
  conn = await setupTestDb();
});

beforeEach(async () => {
  clock = fixedClock(START);
  email = new FakeEmailSender();
  sms = new FakeSmsSender();
  await reset();
  const [agency] = await conn.db.insert(agencies).values({ name: "dispatch-agency", type: "roads" }).returning();
  if (!agency) throw new Error("agency missing");
  agencyId = agency.id;
  const [resident, admin] = await conn.db
    .insert(users)
    .values([
      { email: "resident@example.com", phoneE164: "+2348031234567", phoneVerifiedAt: START, notifySms: true },
      { email: "admin@example.com", role: "agency_admin", agencyId },
    ])
    .returning();
  const [category] = await conn.db.select().from(categories).limit(1);
  if (!resident || !admin || !category) throw new Error("fixtures missing");
  residentId = resident.id;
  adminId = admin.id;
  const [report] = await conn.db
    .insert(reports)
    .values({
      reference: REF,
      categoryId: category.id,
      reporterId: residentId,
      description: DESCRIPTION,
      location: sql`ST_SetSRID(ST_MakePoint(3.3792, 6.5244), 4326)::geography` as unknown as string,
      idempotencyKey: crypto.randomUUID(),
      status: "routed",
      agencyId,
      routedAt: START,
      slaCycle: 1,
    })
    .returning();
  if (!report) throw new Error("report missing");
  reportId = report.id;
});

afterEach(reset);

afterAll(async () => {
  await conn.pool.end();
});

async function reset() {
  await resetReports(conn.db);
  await conn.db.delete(users);
  await conn.db.delete(agencies).where(sql`name like 'dispatch-%'`);
}

async function queue(
  event: NotificationEvent,
  channel: NotificationChannel,
  recipientUserId = residentId,
  overrides: Partial<typeof notifications.$inferInsert> = {},
) {
  const [row] = await conn.db
    .insert(notifications)
    .values({ reportId, event, channel, recipientUserId, slaCycle: 1, nextAttemptAt: START, ...overrides })
    .returning();
  if (!row) throw new Error("notification missing");
  return row;
}

async function rowOf(id: string) {
  const [row] = await conn.db.select().from(notifications).where(eq(notifications.id, id));
  if (!row) throw new Error("row missing");
  return row;
}

describe("sending", () => {
  it("emails the resident once, with the reference and a link, and no description or location", async () => {
    const row = await queue("report_routed", "email");
    expect(await runDispatch(deps())).toEqual({ sent: 1, retrying: 0, failed: 0, skipped: 0 });

    expect(email.sent).toHaveLength(1);
    const message = email.sent[0];
    expect(message?.to).toBe("resident@example.com");
    expect(message?.subject).toContain(REF);
    expect(message?.text).toContain(`https://civicflow.test/reports/${reportId}`);
    expect(message?.text).toContain("dispatch-agency");
    expect(message?.idempotencyKey).toBe(row.id);
    for (const secret of [DESCRIPTION, "3.3792", "6.5244"]) {
      expect(`${message?.subject}${message?.text}${message?.html}`).not.toContain(secret);
    }
    expect(await rowOf(row.id)).toMatchObject({ status: "sent", attempts: 1, lastError: null, sentAt: START });
  });

  it("sends staff the staff link", async () => {
    await queue("escalation_level_1", "email", adminId, { discriminator: "acknowledge" });
    await runDispatch(deps());
    expect(email.sent[0]?.to).toBe("admin@example.com");
    expect(email.sent[0]?.text).toContain(`https://civicflow.test/agency/reports/${reportId}`);
    expect(email.sent[0]?.subject).toContain("acknowledged");
  });

  it("includes the staff reason in a rejection email", async () => {
    await conn.db.insert(statusEvents).values({ reportId, fromStatus: "routed", toStatus: "rejected", reason: "Not a civic issue" });
    await queue("report_rejected", "email");
    await runDispatch(deps());
    expect(email.sent[0]?.text).toContain("Not a civic issue");
  });

  it("texts a verified, opted-in resident", async () => {
    await queue("report_resolved", "sms");
    expect(await runDispatch(deps())).toMatchObject({ sent: 1 });
    expect(sms.sent).toEqual([
      { to: "+2348031234567", text: expect.stringContaining(`${REF}`) },
    ]);
    expect(sms.sent[0]?.text).toContain(`https://civicflow.test/reports/${reportId}`);
    expect(sms.sent[0]?.text.length).toBeLessThanOrEqual(160);
  });

  it("does not send rows that are not due yet", async () => {
    await queue("report_routed", "email", residentId, { nextAttemptAt: new Date(START.getTime() + MINUTE) });
    expect(await runDispatch(deps())).toEqual({ sent: 0, retrying: 0, failed: 0, skipped: 0 });
    expect(email.sent).toHaveLength(0);
  });

  it("works through a backlog in batches", async () => {
    for (const event of ["report_received", "report_routed", "report_acknowledged"] as const) await queue(event, "email");
    expect(await runDispatch(deps({ batchSize: 2 }))).toMatchObject({ sent: 2 });
    expect(await runDispatch(deps({ batchSize: 2 }))).toMatchObject({ sent: 1 });
    expect(email.sent).toHaveLength(3);
  });
});

describe("idempotency", () => {
  it("does not send a row again on a second run", async () => {
    await queue("report_routed", "email");
    await runDispatch(deps());
    expect(await runDispatch(deps())).toEqual({ sent: 0, retrying: 0, failed: 0, skipped: 0 });
    expect(email.sent).toHaveLength(1);
  });

  it("sends once even when two dispatchers run at the same time", async () => {
    for (const event of ["report_received", "report_routed", "report_acknowledged"] as const) await queue(event, "email");
    const results = await Promise.all([runDispatch(deps()), runDispatch(deps())]);
    expect(results.reduce((sum, r) => sum + r.sent, 0)).toBe(3);
    expect(email.sent).toHaveLength(3);
  });

  it("leaves a claimed row alone while its lease lasts, then retries it (crash recovery)", async () => {
    const row = await queue("report_routed", "email");
    // Simulate a worker that claimed the row and died: the lease pushes next_attempt_at forward.
    await conn.db.update(notifications).set({ nextAttemptAt: new Date(START.getTime() + 5 * MINUTE) }).where(eq(notifications.id, row.id));
    expect(await runDispatch(deps())).toMatchObject({ sent: 0 });
    clock.advance(5 * MINUTE + 1);
    expect(await runDispatch(deps())).toMatchObject({ sent: 1 });
  });
});

describe("failures", () => {
  it("retries a transient failure after the backoff, then succeeds", async () => {
    const row = await queue("report_routed", "email");
    email.failOnNextSend();
    expect(await runDispatch(deps())).toEqual({ sent: 0, retrying: 1, failed: 0, skipped: 0 });
    expect(await rowOf(row.id)).toMatchObject({
      status: "pending",
      attempts: 1,
      lastError: "provider_unavailable",
      nextAttemptAt: new Date(START.getTime() + 1 * MINUTE),
    });

    clock.advance(30_000);
    expect(await runDispatch(deps())).toMatchObject({ sent: 0 }); // still waiting
    clock.advance(31_000);
    expect(await runDispatch(deps())).toMatchObject({ sent: 1 });
    expect(await rowOf(row.id)).toMatchObject({ status: "sent", attempts: 2, lastError: null });
    expect(email.sent).toHaveLength(1);
  });

  it("gives up after the last retry", async () => {
    const row = await queue("report_routed", "email");
    for (let i = 0; i < 5; i++) email.failOnNextSend();
    const waits = [1, 5, 30, 120, 0];
    for (const minutes of waits) {
      await runDispatch(deps());
      clock.advance(minutes * MINUTE + 1000);
    }
    expect(await rowOf(row.id)).toMatchObject({ status: "failed", attempts: 5, lastError: "retries_exhausted" });
    expect(await runDispatch(deps())).toMatchObject({ sent: 0, retrying: 0, failed: 0 });
  });

  it("fails straight away, without retrying, when the provider rejects the message", async () => {
    const row = await queue("report_routed", "email");
    email.failOnNextSend({ retryable: false });
    expect(await runDispatch(deps())).toEqual({ sent: 0, retrying: 0, failed: 1, skipped: 0 });
    expect(await rowOf(row.id)).toMatchObject({ status: "failed", attempts: 1, lastError: "rejected_by_provider" });
    clock.advance(10 * 60 * MINUTE);
    expect(await runDispatch(deps())).toMatchObject({ failed: 0 });
  });

  it("keeps a failure on one row from stopping the others", async () => {
    const first = await queue("report_received", "email");
    const second = await queue("report_routed", "email");
    email.failOnNextSend({ retryable: false });
    expect(await runDispatch(deps())).toMatchObject({ failed: 1, sent: 1 });
    expect([(await rowOf(first.id)).status, (await rowOf(second.id)).status].sort()).toEqual(["failed", "sent"]);
  });

  it("stores error codes only: nothing from the recipient or the message", async () => {
    const row = await queue("report_routed", "email");
    email.failOnNextSend();
    await runDispatch(deps());
    const stored = JSON.stringify(await rowOf(row.id));
    for (const pii of ["resident@example.com", "+2348031234567", REF, DESCRIPTION]) expect(stored).not.toContain(pii);
  });
});

describe("preferences and consent", () => {
  it("skips a resident's report email once they opt out, even if it was queued earlier", async () => {
    const row = await queue("report_routed", "email");
    await conn.db.update(users).set({ notifyEmail: false }).where(eq(users.id, residentId));
    expect(await runDispatch(deps())).toEqual({ sent: 0, retrying: 0, failed: 0, skipped: 1 });
    expect(await rowOf(row.id)).toMatchObject({ status: "skipped", skippedReason: "email_opted_out" });
    expect(email.sent).toHaveLength(0);
  });

  it("still sends staff escalation emails when their personal email setting is off", async () => {
    await conn.db.update(users).set({ notifyEmail: false }).where(eq(users.id, adminId));
    await queue("escalation_level_1", "email", adminId, { discriminator: "acknowledge" });
    expect(await runDispatch(deps())).toMatchObject({ sent: 1 });
  });

  it("skips SMS for a resident with SMS off, no phone, or an unverified phone", async () => {
    const cases: Array<Partial<typeof users.$inferInsert>> = [
      { notifySms: false },
      { phoneE164: null, phoneVerifiedAt: null, notifySms: false },
      { phoneVerifiedAt: null, notifySms: false },
    ];
    let cycle = 10;
    for (const change of cases) {
      await conn.db.update(users).set({ phoneE164: "+2348031234567", phoneVerifiedAt: START, notifySms: true }).where(eq(users.id, residentId));
      await conn.db.update(users).set(change).where(eq(users.id, residentId));
      const row = await queue("report_resolved", "sms", residentId, { slaCycle: cycle++ });
      await runDispatch(deps());
      expect(await rowOf(row.id)).toMatchObject({ status: "skipped", skippedReason: "sms_not_enabled" });
    }
    expect(sms.sent).toHaveLength(0);
  });

  it("skips SMS, rather than failing, when SMS is switched off for the deployment", async () => {
    const row = await queue("report_resolved", "sms");
    expect(await runDispatch(deps({ sms: null }))).toEqual({ sent: 0, retrying: 0, failed: 0, skipped: 1 });
    expect(await rowOf(row.id)).toMatchObject({ status: "skipped", skippedReason: "sms_disabled" });
  });

  it("sends an SMS-only retry without re-sending the email for the same event", async () => {
    await queue("report_resolved", "email");
    const smsRow = await queue("report_resolved", "sms");
    sms.failOnNextSend();
    await runDispatch(deps());
    expect(email.sent).toHaveLength(1);
    expect(await rowOf(smsRow.id)).toMatchObject({ status: "pending", attempts: 1 });
    clock.advance(61_000);
    await runDispatch(deps());
    expect(email.sent).toHaveLength(1);
    expect(sms.sent).toHaveLength(1);
  });
});
