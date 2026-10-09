/**
 * Integration tests for background-job heartbeats and the system health picture (Phase 8 Part B).
 * Real database, fake clock.
 *
 * What they protect: the people running the system can trust the health page. A job that runs
 * must leave a heartbeat; a job that throws must be recorded as failing but still fail loudly to
 * the job system; a heartbeat that cannot be written must never turn a healthy job into a failed
 * one; and the backlog numbers must count the right messages.
 */
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { categories, jobHeartbeats, mediaDeletions, notifications, reports, users } from "@/db/schema";
import type { Db } from "@/db/client";
import { fixedClock } from "@/domain/clock";
import { JOB_NAMES } from "@/domain/operations";
import { withHeartbeat } from "@/server/jobs/heartbeat";
import { getSystemHealth, getWorkerHealth, STUCK_AFTER_MINUTES } from "@/server/operations/health";
import { listHeartbeats, recordHeartbeat } from "@/server/repositories/heartbeats";
import { resetReports, setupTestDb } from "./test-db";

let conn: Awaited<ReturnType<typeof setupTestDb>>;
const NOW = new Date("2026-06-30T12:00:00Z");
const MINUTE = 60_000;
const clock = fixedClock(NOW);
const ago = (ms: number) => new Date(NOW.getTime() - ms);

beforeAll(async () => {
  conn = await setupTestDb();
});

beforeEach(cleanup);
afterEach(cleanup);

afterAll(async () => {
  await conn.pool.end();
});

async function cleanup() {
  await resetReports(conn.db);
  await conn.db.delete(jobHeartbeats);
  await conn.db.delete(mediaDeletions);
  await conn.db.delete(users);
}

describe("recording heartbeats", () => {
  it("creates a row on the first run and updates the same row after that", async () => {
    await recordHeartbeat(conn.db, "sla-scan", ago(5 * MINUTE), { status: "ok" });
    await recordHeartbeat(conn.db, "sla-scan", NOW, { status: "error", code: "job_failed" });
    const rows = await conn.db.select().from(jobHeartbeats);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ job: "sla-scan", lastRunAt: NOW, lastStatus: "error", lastError: "job_failed" });

    await recordHeartbeat(conn.db, "sla-scan", NOW, { status: "ok" });
    expect((await conn.db.select().from(jobHeartbeats))[0]).toMatchObject({ lastStatus: "ok", lastError: null });
  });

  it("keeps a separate row for each job", async () => {
    await recordHeartbeat(conn.db, "sla-scan", NOW, { status: "ok" });
    await recordHeartbeat(conn.db, "retention", NOW, { status: "ok" });
    expect([...(await listHeartbeats(conn.db)).keys()].sort()).toEqual(["retention", "sla-scan"]);
  });

  it("refuses a status other than ok or error (database rule)", async () => {
    await expect(
      conn.db.insert(jobHeartbeats).values({ job: "x", lastRunAt: NOW, lastStatus: "maybe" }),
    ).rejects.toThrow();
  });
});

describe("withHeartbeat", () => {
  it("runs the work, returns its result, and records an ok heartbeat", async () => {
    const result = await withHeartbeat(conn.db, clock, "retention", async () => 42);
    expect(result).toBe(42);
    expect((await listHeartbeats(conn.db)).get("retention")).toMatchObject({ lastStatus: "ok", lastRunAt: NOW });
  });

  it("records a failure with a short code, then re-throws so the job system still sees it", async () => {
    await expect(
      withHeartbeat(conn.db, clock, "retention", async () => {
        throw new Error("secret database detail alice@example.com");
      }),
    ).rejects.toThrow("secret database detail");
    const beat = (await listHeartbeats(conn.db)).get("retention");
    expect(beat).toMatchObject({ lastStatus: "error", lastError: "job_failed" });
    // Only the code was stored, never the message.
    expect(JSON.stringify(beat)).not.toContain("alice");
  });

  it("never lets a heartbeat that cannot be written break a healthy job", async () => {
    // A fake database whose every write fails, to stand in for "the database blinked".
    const broken = { insert: () => { throw new Error("db blinked"); } } as unknown as Db;
    await expect(withHeartbeat(broken, clock, "retention", async () => "done")).resolves.toBe("done");
  });

  it("also survives a heartbeat failure when the work itself threw: the ORIGINAL error wins", async () => {
    const broken = { insert: () => { throw new Error("db blinked"); } } as unknown as Db;
    await expect(
      withHeartbeat(broken, clock, "retention", async () => {
        throw new Error("the real problem");
      }),
    ).rejects.toThrow("the real problem");
  });
});

describe("the health picture", () => {
  it("is 'unknown' for every job on a fresh install", async () => {
    const health = await getSystemHealth(conn.db, clock);
    expect(health.worker).toBe("unknown");
    expect(health.jobs.map((j) => j.job)).toEqual([...JOB_NAMES]);
    expect(health.jobs.every((j) => j.health === "never_run" && j.lastRunAt === null)).toBe(true);
    expect(await getWorkerHealth(conn.db, clock)).toBe("unknown");
  });

  it("is ok when every job ran recently", async () => {
    for (const job of JOB_NAMES) await recordHeartbeat(conn.db, job, ago(10_000), { status: "ok" });
    const health = await getSystemHealth(conn.db, clock);
    expect(health.worker).toBe("ok");
    expect(health.jobs.every((j) => j.health === "ok")).toBe(true);
    expect(await getWorkerHealth(conn.db, clock)).toBe("ok");
  });

  it("is degraded and names the late or failing job", async () => {
    for (const job of JOB_NAMES) await recordHeartbeat(conn.db, job, ago(10_000), { status: "ok" });
    await recordHeartbeat(conn.db, "notification-dispatch", ago(10 * MINUTE), { status: "ok" }); // 1-minute job, 10 minutes ago
    await recordHeartbeat(conn.db, "sla-scan", ago(10_000), { status: "error", code: "job_failed" });
    const health = await getSystemHealth(conn.db, clock);
    expect(health.worker).toBe("degraded");
    const byJob = Object.fromEntries(health.jobs.map((j) => [j.job, j.health]));
    expect(byJob["notification-dispatch"]).toBe("late");
    expect(byJob["sla-scan"]).toBe("failing");
    expect(byJob.retention).toBe("ok");
    expect(await getWorkerHealth(conn.db, clock)).toBe("degraded");
  });

  it("answers 'unknown' rather than failing when the heartbeat table cannot be read", async () => {
    const broken = { select: () => { throw new Error("db down"); } } as unknown as Db;
    expect(await getWorkerHealth(broken, clock)).toBe("unknown");
  });
});

describe("message and photo backlogs", () => {
  /** A report and user to hang notification rows on. */
  async function fixture() {
    const [user] = await conn.db.insert(users).values({ email: "ops@example.com" }).returning();
    const [category] = await conn.db.select().from(categories).limit(1);
    const [report] = await conn.db
      .insert(reports)
      .values({
        reference: "CF-OPSBACKLG2",
        categoryId: category?.id ?? "",
        reporterId: user?.id ?? "",
        description: "A large pothole on the main road",
        location: sql`ST_SetSRID(ST_MakePoint(3.3792, 6.5244), 4326)::geography` as unknown as string,
        idempotencyKey: crypto.randomUUID(),
      })
      .returning();
    return { userId: user?.id ?? "", reportId: report?.id ?? "" };
  }

  const queue = (ids: { userId: string; reportId: string }, marker: string, status: "pending" | "sent" | "failed", dueAgo: number) =>
    conn.db.insert(notifications).values({
      reportId: ids.reportId,
      event: "report_received",
      channel: "email",
      recipientUserId: ids.userId,
      slaCycle: 0,
      discriminator: marker,
      status,
      nextAttemptAt: ago(dueAgo),
    });

  it("counts waiting, stuck and failed messages and how long the oldest has been due", async () => {
    const ids = await fixture();
    await queue(ids, "recent", "pending", 2 * MINUTE); // due 2 minutes ago: waiting, not stuck
    await queue(ids, "stuck-1", "pending", 30 * MINUTE); // due 30 minutes ago: stuck
    await queue(ids, "stuck-2", "pending", 45 * MINUTE); // the oldest: 45 minutes
    await queue(ids, "future", "pending", -10 * MINUTE); // due in the FUTURE (a retry): waiting, not due
    await queue(ids, "done", "sent", 60 * MINUTE); // not pending
    await queue(ids, "dead", "failed", 60 * MINUTE);

    const { notifications: backlog } = await getSystemHealth(conn.db, clock);
    expect(backlog).toEqual({ pending: 4, failed: 1, stuck: 2, oldestDueMinutes: 45 });
  });

  it("treats exactly 15 minutes as not yet stuck", async () => {
    const ids = await fixture();
    await queue(ids, "edge", "pending", STUCK_AFTER_MINUTES * MINUTE);
    await queue(ids, "over", "pending", STUCK_AFTER_MINUTES * MINUTE + 1000);
    expect((await getSystemHealth(conn.db, clock)).notifications.stuck).toBe(1);
  });

  it("reports an empty queue as zeros and 'nothing is due'", async () => {
    expect((await getSystemHealth(conn.db, clock)).notifications).toEqual({ pending: 0, failed: 0, stuck: 0, oldestDueMinutes: null });
  });

  it("counts waiting and failed photo deletions", async () => {
    await conn.db.insert(mediaDeletions).values([
      { publicId: "a" },
      { publicId: "b" },
      { publicId: "c", status: "failed", lastError: "rejected_by_provider" },
    ]);
    expect((await getSystemHealth(conn.db, clock)).photoDeletions).toEqual({ pending: 2, failed: 1 });
  });

  it("contains only counts, times and words: no personal data", async () => {
    const ids = await fixture();
    await queue(ids, "x", "pending", MINUTE);
    const text = JSON.stringify(await getSystemHealth(conn.db, clock));
    expect(text).not.toContain("ops@example.com");
    expect(text).not.toContain("CF-OPSBACKLG2");
  });
});
