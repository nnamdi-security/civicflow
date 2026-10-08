import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { categories, rateLimits, reportMedia, reports, statusEvents, users } from "@/db/schema";
import { fixedClock } from "@/domain/clock";
import { REFERENCE_PATTERN } from "@/domain/reports/reference";
import { FakeMediaStorage } from "@/server/adapters/media";
import { UnauthenticatedError } from "@/server/auth/errors";
import type { AuthenticatedActor } from "@/server/auth/session-user";
import { PostgresRateLimiter } from "@/server/rate-limit/postgres-rate-limiter";
import { findReportForReporter, listReportsForReporter } from "@/server/repositories/reports";
import {
  SUBMIT_RATE_RULES,
  createReport,
  type CreateReportDeps,
} from "@/server/reports/create-report";
import { resetReports, setupTestDb } from "./test-db";

let conn: Awaited<ReturnType<typeof setupTestDb>>;
let media: FakeMediaStorage;
let deps: CreateReportDeps;
let alice: AuthenticatedActor;
let bob: AuthenticatedActor;
let categoryId: string;

beforeAll(async () => {
  conn = await setupTestDb();
});

beforeEach(async () => {
  await resetReports(conn.db);
  await conn.db.delete(rateLimits);
  await conn.db.delete(users);

  const [a, b] = await conn.db
    .insert(users)
    .values([{ email: "alice@example.com" }, { email: "bob@example.com" }])
    .returning();
  if (!a || !b) throw new Error("users not created");
  alice = { userId: a.id, role: "resident", agencyId: null };
  bob = { userId: b.id, role: "resident", agencyId: null };

  const [category] = await conn.db.select().from(categories).where(eq(categories.slug, "roads"));
  if (!category) throw new Error("category missing");
  categoryId = category.id;

  media = new FakeMediaStorage();
  deps = {
    db: conn.db,
    media,
    limiter: new PostgresRateLimiter(conn.db, fixedClock(new Date("2026-01-01T00:00:00Z"))),
    secret: "s".repeat(32),
    randomBytes: (n) => randomBytes(n),
  };
});

afterAll(async () => {
  await resetReports(conn.db);
  await conn.db.delete(rateLimits);
  await conn.db.delete(users);
  await conn.pool.end();
});

function input(actor: AuthenticatedActor, overrides: Record<string, unknown> = {}) {
  return {
    categoryId,
    description: "  A large pothole on the main road near the market  ",
    lon: 3.3792,
    lat: 6.5244,
    photoPublicIds: [media.simulateUpload(actor.userId).publicId],
    idempotencyKey: crypto.randomUUID(),
    ...overrides,
  };
}

async function counts() {
  const [r, m, e] = await Promise.all([
    conn.db.select().from(reports),
    conn.db.select().from(reportMedia),
    conn.db.select().from(statusEvents),
  ]);
  return { reports: r.length, media: m.length, events: e.length };
}

describe("createReport: success", () => {
  it("saves the report, photos and first status event together", async () => {
    const photoA = media.simulateUpload(alice.userId);
    const photoB = media.simulateUpload(alice.userId, { format: "png" });
    const result = await createReport(
      deps,
      alice,
      input(alice, { photoPublicIds: [photoA.publicId, photoB.publicId] }),
    );

    expect(result).toMatchObject({ ok: true, created: true });
    if (!result.ok) return;
    expect(result.report.reference).toMatch(REFERENCE_PATTERN);

    const [report] = await conn.db.select().from(reports);
    expect(report).toMatchObject({
      reporterId: alice.userId,
      status: "submitted",
      description: "A large pothole on the main road near the market",
    });
    const photos = await conn.db.select().from(reportMedia).orderBy(reportMedia.position);
    expect(photos.map((p) => [p.publicId, p.position, p.format])).toEqual([
      [photoA.publicId, 0, "jpg"],
      [photoB.publicId, 1, "png"],
    ]);
    const [event] = await conn.db.select().from(statusEvents);
    expect(event).toMatchObject({
      reportId: report?.id,
      fromStatus: null,
      toStatus: "submitted",
      actorId: alice.userId,
    });
  });

  it("stores the location in lon/lat order", async () => {
    const result = await createReport(deps, alice, input(alice));
    if (!result.ok) throw new Error("expected success");
    const detail = await findReportForReporter(conn.db, result.report.id, alice.userId);
    expect(detail?.lon).toBeCloseTo(3.3792, 4);
    expect(detail?.lat).toBeCloseTo(6.5244, 4);
  });

  it("returns the existing report for a repeated idempotency key without duplicating anything", async () => {
    const body = input(alice);
    const first = await createReport(deps, alice, body);
    const second = await createReport(deps, alice, body);
    expect(first.ok && second.ok && first.report.id === second.report.id).toBe(true);
    expect(second).toMatchObject({ ok: true, created: false });
    expect(await counts()).toEqual({ reports: 1, media: 1, events: 1 });
  });

  it("does not count a repeated submit against the rate limit", async () => {
    const body = input(alice);
    for (let i = 0; i < SUBMIT_RATE_RULES.hour.limit + 3; i++) {
      expect(await createReport(deps, alice, body)).toMatchObject({ ok: true });
    }
  });

  it("lets different reporters use the same idempotency key", async () => {
    const key = crypto.randomUUID();
    const a = await createReport(deps, alice, input(alice, { idempotencyKey: key }));
    const b = await createReport(deps, bob, input(bob, { idempotencyKey: key }));
    expect(a).toMatchObject({ ok: true, created: true });
    expect(b).toMatchObject({ ok: true, created: true });
  });
});

describe("createReport: access", () => {
  it("rejects an unauthenticated caller and writes nothing", async () => {
    await expect(createReport(deps, null, input(alice))).rejects.toBeInstanceOf(UnauthenticatedError);
    expect(await counts()).toEqual({ reports: 0, media: 0, events: 0 });
  });

  it("is open to agency staff too", async () => {
    // The role is recorded but not restricted (ADR 0007); the DB role/agency check is for users rows.
    const staff: AuthenticatedActor = { userId: alice.userId, role: "platform_admin", agencyId: null };
    expect(await createReport(deps, staff, input(staff))).toMatchObject({ ok: true });
  });

  it("never lets one reporter read another's report", async () => {
    const result = await createReport(deps, alice, input(alice));
    if (!result.ok) throw new Error("expected success");
    expect(await findReportForReporter(conn.db, result.report.id, bob.userId)).toBeNull();
    expect(await findReportForReporter(conn.db, result.report.id, alice.userId)).not.toBeNull();
    expect(await listReportsForReporter(conn.db, bob.userId)).toEqual([]);
    expect(await listReportsForReporter(conn.db, alice.userId)).toHaveLength(1);
  });

});

describe("createReport: validation", () => {
  it("rejects malformed input", async () => {
    expect(await createReport(deps, alice, { nope: true })).toEqual({ ok: false, reason: "malformed" });
    expect(await createReport(deps, alice, input(alice, { categoryId: "not-a-uuid" }))).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("rejects duplicated photo ids in one submission", async () => {
    const photo = media.simulateUpload(alice.userId);
    const result = await createReport(
      deps,
      alice,
      input(alice, { photoPublicIds: [photo.publicId, photo.publicId] }),
    );
    expect(result).toEqual({ ok: false, reason: "malformed" });
  });

  it("returns every domain issue and writes nothing", async () => {
    const result = await createReport(
      deps,
      alice,
      input(alice, { description: "short", lon: 3.38, lat: 60, photoPublicIds: [] }),
    );
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    if (result.ok || result.reason !== "invalid") return;
    expect(result.issues.map((i) => i.code).sort()).toEqual(
      ["description_too_short", "location_outside_nigeria", "photos_missing"].sort(),
    );
    expect(await counts()).toEqual({ reports: 0, media: 0, events: 0 });
  });

  it("rejects an unknown or inactive category", async () => {
    expect(await createReport(deps, alice, input(alice, { categoryId: crypto.randomUUID() }))).toEqual({
      ok: false,
      reason: "category_unavailable",
    });

    await conn.db.update(categories).set({ active: false }).where(eq(categories.id, categoryId));
    try {
      expect(await createReport(deps, alice, input(alice))).toEqual({
        ok: false,
        reason: "category_unavailable",
      });
    } finally {
      await conn.db.update(categories).set({ active: true }).where(eq(categories.id, categoryId));
    }
  });
});

describe("createReport: photos", () => {
  it("rejects another reporter's photo and writes nothing", async () => {
    const bobs = media.simulateUpload(bob.userId);
    const result = await createReport(deps, alice, input(alice, { photoPublicIds: [bobs.publicId] }));
    expect(result).toEqual({ ok: false, reason: "photo_rejected", code: "not_owner" });
    expect(await counts()).toEqual({ reports: 0, media: 0, events: 0 });
  });

  it("rejects a photo that was never uploaded", async () => {
    const result = await createReport(
      deps,
      alice,
      input(alice, { photoPublicIds: [`civicflow/reports/${alice.userId}/ghost`] }),
    );
    expect(result).toEqual({ ok: false, reason: "photo_rejected", code: "not_found" });
  });

  it("rejects a disallowed format and an oversized file", async () => {
    const gif = media.simulateUpload(alice.userId, { format: "gif" });
    const big = media.simulateUpload(alice.userId, { bytes: 50 * 1024 * 1024 });
    expect(await createReport(deps, alice, input(alice, { photoPublicIds: [gif.publicId] }))).toEqual({
      ok: false,
      reason: "photo_rejected",
      code: "format",
    });
    expect(await createReport(deps, alice, input(alice, { photoPublicIds: [big.publicId] }))).toEqual({
      ok: false,
      reason: "photo_rejected",
      code: "too_large",
    });
  });

  it("will not attach a photo already used by another report", async () => {
    const photo = media.simulateUpload(alice.userId);
    const first = await createReport(deps, alice, input(alice, { photoPublicIds: [photo.publicId] }));
    expect(first).toMatchObject({ ok: true });
    const second = await createReport(deps, alice, input(alice, { photoPublicIds: [photo.publicId] }));
    expect(second).toEqual({ ok: false, reason: "photo_rejected", code: "already_used" });
    expect(await counts()).toEqual({ reports: 1, media: 1, events: 1 });
  });

  it("reports a provider outage as retryable and writes nothing", async () => {
    media.unavailable = true;
    expect(await createReport(deps, alice, input(alice))).toEqual({ ok: false, reason: "media_unavailable" });
    expect(await counts()).toEqual({ reports: 0, media: 0, events: 0 });
  });
});

describe("createReport: rate limit", () => {
  it("allows five submissions per hour and blocks the sixth", async () => {
    for (let i = 0; i < SUBMIT_RATE_RULES.hour.limit; i++) {
      expect(await createReport(deps, alice, input(alice))).toMatchObject({ ok: true });
    }
    expect(await createReport(deps, alice, input(alice))).toEqual({ ok: false, reason: "rate_limited" });
    expect((await counts()).reports).toBe(SUBMIT_RATE_RULES.hour.limit);
  });

  it("limits each reporter separately", async () => {
    for (let i = 0; i < SUBMIT_RATE_RULES.hour.limit + 1; i++) await createReport(deps, alice, input(alice));
    expect(await createReport(deps, bob, input(bob))).toMatchObject({ ok: true });
  });

  it("does not burn quota on invalid submissions", async () => {
    for (let i = 0; i < SUBMIT_RATE_RULES.hour.limit + 2; i++) {
      await createReport(deps, alice, input(alice, { description: "x" }));
    }
    expect(await createReport(deps, alice, input(alice))).toMatchObject({ ok: true });
  });
});

describe("createReport: atomicity", () => {
  it("rolls back the report and photos when the last insert in the transaction fails", async () => {
    // Make the status event insert (the final step) fail, then check nothing else survived.
    await conn.db.execute(sql`
      create or replace function test_fail_status_event() returns trigger as $$
      begin raise exception 'forced failure'; end; $$ language plpgsql`);
    await conn.db.execute(sql`
      create trigger test_fail_status_event before insert on status_events
      for each row execute function test_fail_status_event()`);
    try {
      await expect(createReport(deps, alice, input(alice))).rejects.toThrow();
      expect(await counts()).toEqual({ reports: 0, media: 0, events: 0 });
    } finally {
      await conn.db.execute(sql`drop trigger if exists test_fail_status_event on status_events`);
      await conn.db.execute(sql`drop function if exists test_fail_status_event()`);
    }
  });

  it("succeeds again once the failure is removed", async () => {
    expect(await createReport(deps, alice, input(alice))).toMatchObject({ ok: true });
  });
});
