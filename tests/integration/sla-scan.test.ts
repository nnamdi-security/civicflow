import { eq, sql } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { agencies, categories, escalations, reports, users } from "@/db/schema";
import { fixedClock } from "@/domain/clock";
import { agencyScopeFor } from "@/domain/permissions";
import { findReportForReporter } from "@/server/repositories/reports";
import { findReportForScope, listReportsForScope } from "@/server/repositories/report-workflow";
import type { ScanResult } from "@/server/sla/scan";
import { runSlaScan } from "@/server/sla/scan";
import { SLA_SCAN_QUEUE, registerSlaScan } from "@/server/jobs/sla-scan-job";
import { resetReports, setupTestDb } from "./test-db";

let conn: Awaited<ReturnType<typeof setupTestDb>>;
let agencyId: string;
let reporterId: string;
let categoryId: string;

const DUE = new Date("2026-03-02T09:00:00Z");
const SECOND = 1000;
const HOUR = 3_600_000;
const at = (ms: number) => fixedClock(new Date(DUE.getTime() + ms));

beforeAll(async () => {
  conn = await setupTestDb();
});

beforeEach(async () => {
  await resetReports(conn.db);
  await conn.db.delete(users);
  await conn.db.delete(agencies).where(sql`name like 'scan-%'`);
  const [agency] = await conn.db.insert(agencies).values({ name: "scan-agency", type: "roads" }).returning();
  const [user] = await conn.db.insert(users).values({ email: "scan@example.com" }).returning();
  const [category] = await conn.db.select().from(categories).limit(1);
  if (!agency || !user || !category) throw new Error("fixtures missing");
  agencyId = agency.id;
  reporterId = user.id;
  categoryId = category.id;
});

afterEach(async () => {
  await resetReports(conn.db);
  await conn.db.delete(users);
  await conn.db.delete(agencies).where(sql`name like 'scan-%'`);
});

afterAll(async () => {
  await conn.pool.end();
});

async function report(timers: Partial<typeof reports.$inferInsert> = {}) {
  const [row] = await conn.db
    .insert(reports)
    .values({
      reference: `CF-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
      categoryId,
      reporterId,
      description: "A large pothole on the main road",
      location: sql`ST_SetSRID(ST_MakePoint(3.3792, 6.5244), 4326)::geography` as unknown as string,
      idempotencyKey: crypto.randomUUID(),
      status: "routed",
      agencyId,
      routedAt: new Date("2026-03-01T09:00:00Z"),
      slaCycle: 1,
      ackDueAt: DUE,
      ...timers,
    })
    .returning();
  if (!row) throw new Error("report not created");
  return row;
}

async function recordedFor(reportId: string) {
  const rows = await conn.db.select().from(escalations).where(eq(escalations.reportId, reportId));
  return rows.map((r) => `${r.timer}:${r.level}:c${r.slaCycle}`).sort();
}

describe("runSlaScan: ladder timing", () => {
  it("records nothing before, or exactly at, the deadline", async () => {
    const r = await report();
    expect(await runSlaScan(conn.db, at(-SECOND))).toEqual({ recorded: 0 });
    expect(await runSlaScan(conn.db, at(0))).toEqual({ recorded: 0 });
    expect(await recordedFor(r.id)).toEqual([]);
  });

  it("records level 1 one second after the deadline", async () => {
    const r = await report();
    expect(await runSlaScan(conn.db, at(SECOND))).toEqual({ recorded: 1 });
    expect(await recordedFor(r.id)).toEqual(["acknowledge:1:c1"]);
  });

  it("adds level 2 only after 24 hours and level 3 only after 72 hours", async () => {
    const r = await report();
    await runSlaScan(conn.db, at(SECOND));
    expect(await runSlaScan(conn.db, at(24 * HOUR))).toEqual({ recorded: 0 });
    expect(await runSlaScan(conn.db, at(24 * HOUR + SECOND))).toEqual({ recorded: 1 });
    expect(await runSlaScan(conn.db, at(72 * HOUR))).toEqual({ recorded: 0 });
    expect(await runSlaScan(conn.db, at(72 * HOUR + SECOND))).toEqual({ recorded: 1 });
    expect(await recordedFor(r.id)).toEqual(["acknowledge:1:c1", "acknowledge:2:c1", "acknowledge:3:c1"]);
  });

  it("catches up on every missed level in one run after downtime", async () => {
    const r = await report();
    expect(await runSlaScan(conn.db, at(100 * HOUR))).toEqual({ recorded: 3 });
    expect(await recordedFor(r.id)).toHaveLength(3);
  });

  it("escalates the resolve timer separately from the acknowledgement timer", async () => {
    const r = await report({ ackDueAt: null, resolveDueAt: DUE, status: "in_progress" });
    expect(await runSlaScan(conn.db, at(SECOND))).toEqual({ recorded: 1 });
    expect(await recordedFor(r.id)).toEqual(["resolve:1:c1"]);
  });

  it("ignores reports whose timers are not running", async () => {
    await report({ ackDueAt: null, resolveDueAt: null, status: "resolved", resolvedAt: DUE });
    expect(await runSlaScan(conn.db, at(500 * HOUR))).toEqual({ recorded: 0 });
  });
});

describe("runSlaScan: idempotency", () => {
  it("records nothing the second time", async () => {
    await report();
    expect(await runSlaScan(conn.db, at(25 * HOUR))).toEqual({ recorded: 2 });
    expect(await runSlaScan(conn.db, at(25 * HOUR))).toEqual({ recorded: 0 });
    expect(await conn.db.select().from(escalations)).toHaveLength(2);
  });

  it("never duplicates when two scans run at the same time", async () => {
    const r = await report();
    const results = await Promise.all([runSlaScan(conn.db, at(80 * HOUR)), runSlaScan(conn.db, at(80 * HOUR))]);
    expect(results.reduce((sum, x) => sum + x.recorded, 0)).toBe(3);
    expect(await recordedFor(r.id)).toHaveLength(3);
  });

  it("escalates again in a new SLA cycle while keeping the old record", async () => {
    const r = await report();
    await runSlaScan(conn.db, at(SECOND));
    const newDue = new Date(DUE.getTime() + 10 * HOUR);
    await conn.db.update(reports).set({ slaCycle: 2, ackDueAt: newDue }).where(eq(reports.id, r.id));
    expect(await runSlaScan(conn.db, fixedClock(new Date(newDue.getTime() + SECOND)))).toEqual({ recorded: 1 });
    expect(await recordedFor(r.id)).toEqual(["acknowledge:1:c1", "acknowledge:1:c2"]);
  });
});

describe("escalation levels in read models", () => {
  it("expose the highest level of the current cycle to staff and to the reporter", async () => {
    const r = await report();
    await runSlaScan(conn.db, at(25 * HOUR));
    const scope = agencyScopeFor({ role: "platform_admin", agencyId: null });

    const [listed] = await listReportsForScope(conn.db, scope);
    expect(listed).toMatchObject({ id: r.id, ackLevel: 2, resolveLevel: null, ackDueAt: DUE });
    const detail = await findReportForScope(conn.db, r.id, scope);
    expect(detail).toMatchObject({ ackLevel: 2, resolveLevel: null });
    const own = await findReportForReporter(conn.db, r.id, reporterId);
    expect(own).toMatchObject({ ackLevel: 2, resolveLevel: null, ackDueAt: DUE });
  });

  it("forget old levels once the SLA cycle restarts", async () => {
    const r = await report();
    await runSlaScan(conn.db, at(25 * HOUR));
    await conn.db.update(reports).set({ slaCycle: 2, ackDueAt: new Date(DUE.getTime() + 30 * HOUR) }).where(eq(reports.id, r.id));
    const [listed] = await listReportsForScope(conn.db, agencyScopeFor({ role: "platform_admin", agencyId: null }));
    expect(listed?.ackLevel).toBeNull();
  });
});

describe("SLA scan job", () => {
  it("is scheduled every minute and runs the scan when a job is sent", async () => {
    const url = process.env.TEST_DATABASE_URL;
    if (!url) throw new Error("TEST_DATABASE_URL is not set");
    const r = await report();
    const scans: ScanResult[] = [];
    const boss = new PgBoss(url);
    boss.on("error", () => undefined);
    await boss.start();
    try {
      await registerSlaScan(boss, { db: conn.db, clock: at(SECOND), onScan: (result) => scans.push(result) });
      const schedules = await boss.getSchedules(SLA_SCAN_QUEUE);
      expect(schedules.map((s) => s.cron)).toEqual(["* * * * *"]);

      await boss.send(SLA_SCAN_QUEUE, {});
      const deadline = Date.now() + 20_000;
      while (scans.length === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 250));
      expect(scans.length).toBeGreaterThan(0);
      expect(await recordedFor(r.id)).toEqual(["acknowledge:1:c1"]);
    } finally {
      await boss.stop({ graceful: true, timeout: 5000 });
    }
  }, 40_000);
});
