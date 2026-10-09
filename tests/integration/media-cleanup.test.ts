/**
 * Integration tests for the photo-deletion queue (ADR 0015), against a real database with a fake
 * photo provider.
 *
 * The promise being tested: once an erasure has written a photo into the queue, that photo WILL
 * be deleted from the provider eventually, even if the provider is down for a while, and the
 * queue is safe to run repeatedly or from several workers at once.
 */
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mediaDeletions } from "@/db/schema";
import { fixedClock } from "@/domain/clock";
import { FakeMediaStorage } from "@/server/adapters/media";
import { countMediaDeletions, queueMediaDeletions, runMediaCleanup } from "@/server/media/cleanup";
import { setupTestDb } from "./test-db";

let conn: Awaited<ReturnType<typeof setupTestDb>>;
let storage: FakeMediaStorage;
let clock: ReturnType<typeof fixedClock>;

const START = new Date("2026-03-01T09:00:00Z");
const MINUTE = 60_000;
const run = (batchSize?: number) => runMediaCleanup({ db: conn.db, clock, storage, batchSize });
/**
 * Queues photos the way the erasure does, then makes them due at the test clock's start time.
 * (New rows are due at the database's real "now"; these tests use a fixed clock set in the past,
 * so the due time is set explicitly. In production both clocks are the real one.)
 */
async function queue(...ids: string[]) {
  await conn.db.transaction((tx) => queueMediaDeletions(tx, ids));
  await conn.db.update(mediaDeletions).set({ nextAttemptAt: START });
}
const rows = () => conn.db.select().from(mediaDeletions);

beforeAll(async () => {
  conn = await setupTestDb();
});

beforeEach(async () => {
  clock = fixedClock(START);
  storage = new FakeMediaStorage();
  await conn.db.delete(mediaDeletions);
});

afterEach(async () => {
  await conn.db.delete(mediaDeletions);
});

afterAll(async () => {
  await conn.pool.end();
});

describe("queueing", () => {
  it("records each photo once, even if it is queued twice", async () => {
    await queue("photo-a", "photo-b");
    await queue("photo-a");
    expect((await rows()).map((r) => r.publicId).sort()).toEqual(["photo-a", "photo-b"]);
  });

  it("does nothing for an empty list", async () => {
    await queue();
    expect(await rows()).toEqual([]);
  });

  it("is part of the caller's transaction: a rolled-back erasure queues nothing", async () => {
    await conn.db
      .transaction(async (tx) => {
        await queueMediaDeletions(tx, ["photo-x"]);
        throw new Error("the erasure failed halfway");
      })
      .catch(() => undefined);
    expect(await rows()).toEqual([]);
  });
});

describe("deleting", () => {
  it("deletes queued photos from the provider and removes their queue rows", async () => {
    await queue("photo-a", "photo-b");
    expect(await run()).toEqual({ deleted: 2, retrying: 0, failed: 0 });
    expect(storage.deleted.sort()).toEqual(["photo-a", "photo-b"]);
    expect(await rows()).toEqual([]);
  });

  it("does nothing on a second run, and never deletes the same photo twice", async () => {
    await queue("photo-a");
    await run();
    expect(await run()).toEqual({ deleted: 0, retrying: 0, failed: 0 });
    expect(storage.deleted).toEqual(["photo-a"]);
  });

  it("works through a backlog in batches", async () => {
    await queue("p1", "p2", "p3");
    expect(await run(2)).toMatchObject({ deleted: 2 });
    expect(await run(2)).toMatchObject({ deleted: 1 });
    expect(storage.deleted).toHaveLength(3);
  });

  it("deletes each photo once even when two workers run at the same moment", async () => {
    await queue("p1", "p2", "p3", "p4");
    const results = await Promise.all([run(), run()]);
    expect(results.reduce((sum, r) => sum + r.deleted, 0)).toBe(4);
    expect(storage.deleted.sort()).toEqual(["p1", "p2", "p3", "p4"]);
  });
});

describe("when the provider has trouble", () => {
  it("retries a temporary failure after the backoff and then succeeds", async () => {
    await queue("photo-a");
    storage.failNextDeletion(); // retryable
    expect(await run()).toEqual({ deleted: 0, retrying: 1, failed: 0 });

    const [row] = await rows();
    expect(row).toMatchObject({ status: "pending", attempts: 1, lastError: "provider_unavailable" });
    expect(row?.nextAttemptAt).toEqual(new Date(START.getTime() + 1 * MINUTE)); // first backoff: 1 minute

    clock.advance(30_000);
    expect(await run()).toEqual({ deleted: 0, retrying: 0, failed: 0 }); // not due yet
    clock.advance(31_000);
    expect(await run()).toEqual({ deleted: 1, retrying: 0, failed: 0 });
    expect(await rows()).toEqual([]);
  });

  it("gives up after the last retry, keeping the row for a person to see", async () => {
    await queue("photo-a");
    for (let i = 0; i < 5; i++) storage.failNextDeletion();
    for (const minutes of [1, 5, 30, 120, 0]) {
      await run();
      clock.advance(minutes * MINUTE + 1000);
    }
    expect(await rows()).toMatchObject([{ status: "failed", attempts: 5, lastError: "retries_exhausted" }]);
    // A failed row is not tried again.
    expect(await run()).toEqual({ deleted: 0, retrying: 0, failed: 0 });
    expect(await countMediaDeletions(conn.db)).toEqual({ pending: 0, failed: 1 });
  });

  it("fails straight away, without retrying, when the provider refuses", async () => {
    await queue("photo-a");
    storage.failNextDeletion({ retryable: false });
    expect(await run()).toEqual({ deleted: 0, retrying: 0, failed: 1 });
    expect(await rows()).toMatchObject([{ status: "failed", attempts: 1, lastError: "rejected_by_provider" }]);
  });

  it("does not let one failing photo stop the others", async () => {
    await queue("photo-a", "photo-b");
    storage.failNextDeletion({ retryable: false });
    const result = await run();
    expect(result.deleted + result.failed).toBe(2);
    expect(result).toMatchObject({ deleted: 1, failed: 1 });
  });

  it("recovers a photo whose worker died mid-way, once the lease runs out", async () => {
    await queue("photo-a");
    // Simulate a worker that claimed the row and then crashed: the lease pushed its due time 5 minutes out.
    await conn.db.update(mediaDeletions).set({ nextAttemptAt: new Date(START.getTime() + 5 * MINUTE) }).where(eq(mediaDeletions.publicId, "photo-a"));
    expect(await run()).toMatchObject({ deleted: 0 });
    clock.advance(5 * MINUTE + 1000);
    expect(await run()).toMatchObject({ deleted: 1 });
  });
});

describe("what is recorded", () => {
  it("stores error codes only, never the provider's words", async () => {
    await queue("photo-a");
    storage.failNextDeletion();
    await run();
    const [row] = await rows();
    expect(row?.lastError).toBe("provider_unavailable");
    expect(JSON.stringify(row)).not.toMatch(/ECONN|secret|http/i);
  });

  it("counts pending and failed rows for the operations page", async () => {
    await queue("a", "b", "c");
    storage.failNextDeletion({ retryable: false });
    await run(1); // the first photo fails permanently
    expect(await countMediaDeletions(conn.db)).toEqual({ pending: 2, failed: 1 });
  });
});
