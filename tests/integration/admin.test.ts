/**
 * Integration tests for the platform-admin actions (ADR 0014): agencies, coverage, SLA policy,
 * categories and the audit log. They run the real use cases against a real PostgreSQL database.
 *
 * What these tests protect, in plain terms:
 *   1. ONLY platform admins can do any of this (everyone else is refused, and nothing changes);
 *   2. bad input is refused with a clear reason and changes nothing;
 *   3. every successful change writes exactly one audit entry, in the same transaction;
 *   4. changing an SLA policy does NOT touch reports whose timers are already running.
 *
 * NOTE ON CLEAN-UP: some tests change the SEEDED categories and SLA policies, which other test
 * files rely on. `beforeEach`/`afterEach` below snapshot and restore them so tests cannot leak
 * changes into each other.
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { agencies, agencyJurisdictions, auditLog, categories, jurisdictions, reports, slaPolicies, users } from "@/db/schema";
import { ForbiddenError, UnauthenticatedError } from "@/server/auth/errors";
import type { AuthenticatedActor } from "@/server/auth/session-user";
import { addCoverage, createAgency, removeCoverage, setCoveragePriority, updateAgency } from "@/server/admin/agencies";
import { setCategoryActive } from "@/server/admin/categories";
import { updateSlaPolicy } from "@/server/admin/sla-policy";
import { listRecentAudit } from "@/server/repositories/audit";
import { resetAudit, resetReports, setupTestDb } from "./test-db";

let conn: Awaited<ReturnType<typeof setupTestDb>>;
let platformAdmin: AuthenticatedActor;
let agencyAdmin: AuthenticatedActor;
let officer: AuthenticatedActor;
let resident: AuthenticatedActor;
let areaId: string;
let existingAgencyId: string;

// Snapshots of the seeded rows we are about to modify, so we can put them back afterwards.
let originalPolicies: Array<typeof slaPolicies.$inferSelect>;
let originalCategoryActive: Array<{ id: string; active: boolean }>;

const deps = () => ({ db: conn.db });

beforeAll(async () => {
  conn = await setupTestDb();
});

beforeEach(async () => {
  originalPolicies = await conn.db.select().from(slaPolicies);
  originalCategoryActive = (await conn.db.select({ id: categories.id, active: categories.active }).from(categories));
  await cleanup();

  const [existing] = await conn.db.insert(agencies).values({ name: "adm-existing", type: "roads" }).returning();
  const [area] = await conn.db
    .insert(jurisdictions)
    .values({
      name: "adm-area",
      level: "lga",
      geom: sql`ST_Multi(ST_GeomFromText('POLYGON((100 0, 101 0, 101 1, 100 1, 100 0))', 4326))`,
    })
    .returning();
  const staff = await conn.db
    .insert(users)
    .values([
      { email: "adm-platform@example.com", role: "platform_admin" },
      { email: "adm-agency-admin@example.com", role: "agency_admin", agencyId: existing?.id },
      { email: "adm-officer@example.com", role: "agency_officer", agencyId: existing?.id },
      { email: "adm-resident@example.com" },
    ])
    .returning();
  if (!existing || !area) throw new Error("fixtures missing");
  existingAgencyId = existing.id;
  areaId = area.id;
  const as = (email: string): AuthenticatedActor => {
    const row = staff.find((u) => u.email === email);
    if (!row) throw new Error("user missing");
    return { userId: row.id, role: row.role, agencyId: row.agencyId };
  };
  platformAdmin = as("adm-platform@example.com");
  agencyAdmin = as("adm-agency-admin@example.com");
  officer = as("adm-officer@example.com");
  resident = as("adm-resident@example.com");
});

afterEach(async () => {
  // Put the shared seeded data back exactly as we found it, then remove everything we created.
  for (const policy of originalPolicies) {
    await conn.db
      .update(slaPolicies)
      .set({ ackMinutes: policy.ackMinutes, resolveMinutes: policy.resolveMinutes })
      .where(eq(slaPolicies.categoryId, policy.categoryId));
  }
  for (const category of originalCategoryActive) {
    await conn.db.update(categories).set({ active: category.active }).where(eq(categories.id, category.id));
  }
  await cleanup();
});

afterAll(async () => {
  await conn.pool.end();
});

/** Removes every row these tests create. Order matters: audit rows point at users, so they go first. */
async function cleanup() {
  await resetAudit(conn.db);
  await resetReports(conn.db);
  await conn.db.delete(users);
  await conn.db.delete(agencyJurisdictions);
  await conn.db.delete(agencies).where(sql`name like 'adm-%'`);
  await conn.db.delete(jurisdictions).where(sql`name like 'adm-%'`);
}

/** All audit entries so far, oldest first, as simple (action, summary) pairs. */
async function auditEntries() {
  const rows = await conn.db.select().from(auditLog).orderBy(auditLog.createdAt, auditLog.id);
  return rows.map((r) => ({ action: r.action, summary: r.summary, actorRole: r.actorRole, actorId: r.actorId }));
}

// -------------------------------------------------------------------------------------------
describe("who may use the admin actions", () => {
  // Every admin action must refuse everybody except a platform admin, BEFORE doing anything.
  const attempts: Array<[string, (actor: AuthenticatedActor | null) => Promise<unknown>]> = [
    ["createAgency", (a) => createAgency(deps(), a, { name: "adm-new", type: "roads" })],
    ["updateAgency", (a) => updateAgency(deps(), a, { agencyId: existingAgencyId, name: "adm-renamed", type: "roads" })],
    ["addCoverage", (a) => addCoverage(deps(), a, { agencyId: existingAgencyId, jurisdictionId: areaId, priority: 1 })],
    ["removeCoverage", (a) => removeCoverage(deps(), a, { agencyId: existingAgencyId, jurisdictionId: areaId })],
    ["setCoveragePriority", (a) => setCoveragePriority(deps(), a, { agencyId: existingAgencyId, jurisdictionId: areaId, priority: 2 })],
    ["updateSlaPolicy", (a) => updateSlaPolicy(deps(), a, { categoryId: crypto.randomUUID(), ackMinutes: 60, resolveMinutes: 120, note: "a good reason" })],
    ["setCategoryActive", (a) => setCategoryActive(deps(), a, { categoryId: crypto.randomUUID(), active: false })],
  ];

  it.each(attempts)("%s refuses an agency admin, an officer and a resident", async (_name, attempt) => {
    for (const who of [agencyAdmin, officer, resident]) {
      await expect(attempt(who)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it.each(attempts)("%s refuses someone who is not signed in", async (_name, attempt) => {
    await expect(attempt(null)).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("changes nothing and writes no audit entry when refused", async () => {
    await createAgency(deps(), officer, { name: "adm-sneaky", type: "roads" }).catch(() => undefined);
    expect(await conn.db.select().from(agencies).where(eq(agencies.name, "adm-sneaky"))).toHaveLength(0);
    expect(await auditEntries()).toEqual([]);
  });
});

// -------------------------------------------------------------------------------------------
describe("createAgency and updateAgency", () => {
  it("creates an agency and records who did it", async () => {
    const result = await createAgency(deps(), platformAdmin, { name: "  adm-new   agency ", type: "water" });
    expect(result).toMatchObject({ ok: true, changed: true });
    const [row] = await conn.db.select().from(agencies).where(eq(agencies.name, "adm-new agency"));
    expect(row).toMatchObject({ name: "adm-new agency", type: "water" }); // name was tidied
    expect(await auditEntries()).toEqual([
      expect.objectContaining({
        action: "agency.created",
        summary: 'created agency "adm-new agency" (water)',
        actorRole: "platform_admin",
        actorId: platformAdmin.userId,
      }),
    ]);
  });

  it("refuses a bad name or type, saving nothing", async () => {
    expect(await createAgency(deps(), platformAdmin, { name: "x", type: "roads" })).toEqual({ ok: false, reason: "name_invalid" });
    expect(await createAgency(deps(), platformAdmin, { name: "adm-valid", type: "parks" })).toEqual({ ok: false, reason: "type_invalid" });
    expect(await createAgency(deps(), platformAdmin, "nonsense")).toEqual({ ok: false, reason: "malformed" });
    expect(await auditEntries()).toEqual([]);
  });

  it("refuses a duplicate name, ignoring capital letters", async () => {
    expect(await createAgency(deps(), platformAdmin, { name: "ADM-EXISTING", type: "roads" })).toEqual({
      ok: false,
      reason: "name_taken",
    });
    expect(await auditEntries()).toEqual([]); // the failed attempt left no audit entry behind
  });

  it("renames an agency and describes the change", async () => {
    const result = await updateAgency(deps(), platformAdmin, { agencyId: existingAgencyId, name: "adm-renamed", type: "roads" });
    expect(result).toMatchObject({ ok: true, changed: true });
    expect((await auditEntries())[0]).toMatchObject({
      action: "agency.updated",
      summary: 'renamed "adm-existing" to "adm-renamed"',
    });
  });

  it("does nothing, and logs nothing, when nothing changed", async () => {
    const result = await updateAgency(deps(), platformAdmin, { agencyId: existingAgencyId, name: "adm-existing", type: "roads" });
    expect(result).toMatchObject({ ok: true, changed: false });
    expect(await auditEntries()).toEqual([]);
  });

  it("refuses to rename to a name another agency already has, and to edit one that does not exist", async () => {
    await createAgency(deps(), platformAdmin, { name: "adm-other", type: "roads" });
    expect(await updateAgency(deps(), platformAdmin, { agencyId: existingAgencyId, name: "adm-other", type: "roads" })).toEqual({
      ok: false,
      reason: "name_taken",
    });
    expect(await updateAgency(deps(), platformAdmin, { agencyId: crypto.randomUUID(), name: "adm-ghost", type: "roads" })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });
});

// -------------------------------------------------------------------------------------------
describe("coverage", () => {
  it("adds, re-prioritises and removes coverage, with an audit entry for each", async () => {
    expect(await addCoverage(deps(), platformAdmin, { agencyId: existingAgencyId, jurisdictionId: areaId, priority: 5 })).toEqual({
      ok: true,
      changed: true,
    });
    expect(await setCoveragePriority(deps(), platformAdmin, { agencyId: existingAgencyId, jurisdictionId: areaId, priority: 2 })).toEqual({
      ok: true,
      changed: true,
    });
    const [row] = await conn.db.select().from(agencyJurisdictions).where(eq(agencyJurisdictions.agencyId, existingAgencyId));
    expect(row?.priority).toBe(2);

    expect(await removeCoverage(deps(), platformAdmin, { agencyId: existingAgencyId, jurisdictionId: areaId })).toEqual({
      ok: true,
      changed: true,
    });
    expect(await conn.db.select().from(agencyJurisdictions).where(eq(agencyJurisdictions.agencyId, existingAgencyId))).toHaveLength(0);

    expect((await auditEntries()).map((e) => e.action)).toEqual([
      "coverage.added",
      "coverage.priority_changed",
      "coverage.removed",
    ]);
    expect((await auditEntries())[1]?.summary).toContain("changed from 5 to 2");
  });

  it("refuses an invalid priority, a duplicate, and things that do not exist", async () => {
    const base = { agencyId: existingAgencyId, jurisdictionId: areaId };
    for (const bad of [-1, 1001, 1.5, "3", null]) {
      expect(await addCoverage(deps(), platformAdmin, { ...base, priority: bad })).toEqual({ ok: false, reason: "priority_invalid" });
    }
    await addCoverage(deps(), platformAdmin, { ...base, priority: 1 });
    expect(await addCoverage(deps(), platformAdmin, { ...base, priority: 1 })).toEqual({ ok: false, reason: "already_covered" });
    expect(await addCoverage(deps(), platformAdmin, { agencyId: crypto.randomUUID(), jurisdictionId: areaId, priority: 1 })).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(await removeCoverage(deps(), platformAdmin, { agencyId: existingAgencyId, jurisdictionId: crypto.randomUUID() })).toEqual({
      ok: false,
      reason: "not_found",
    });
    // Only the one successful add was audited.
    expect((await auditEntries()).map((e) => e.action)).toEqual(["coverage.added"]);
  });

  it("logs nothing when the priority is set to the value it already has", async () => {
    const base = { agencyId: existingAgencyId, jurisdictionId: areaId };
    await addCoverage(deps(), platformAdmin, { ...base, priority: 4 });
    expect(await setCoveragePriority(deps(), platformAdmin, { ...base, priority: 4 })).toEqual({ ok: true, changed: false });
    expect(await auditEntries()).toHaveLength(1);
  });
});

// -------------------------------------------------------------------------------------------
describe("updateSlaPolicy", () => {
  // Reads the "roads" category and its current policy.
  async function roads() {
    const [category] = await conn.db.select().from(categories).where(eq(categories.slug, "roads"));
    const [policy] = await conn.db.select().from(slaPolicies).where(eq(slaPolicies.categoryId, category?.id ?? ""));
    if (!category || !policy) throw new Error("roads policy missing");
    return { category, policy };
  }

  it("changes the policy and records the old and new numbers with the reason", async () => {
    const { category } = await roads();
    const result = await updateSlaPolicy(deps(), platformAdmin, {
      categoryId: category.id,
      ackMinutes: 720,
      resolveMinutes: 4320,
      note: "Faster targets agreed with the state ministry",
    });
    expect(result).toEqual({ ok: true, changed: true });
    expect((await roads()).policy).toMatchObject({ ackMinutes: 720, resolveMinutes: 4320 });
    expect(await auditEntries()).toEqual([
      expect.objectContaining({
        action: "sla_policy.updated",
        summary: `${category.name}: acknowledge 1440 -> 720 min; resolve 20160 -> 4320 min. Reason: Faster targets agreed with the state ministry`,
      }),
    ]);
  });

  it("refuses bad numbers or a missing note, changing nothing", async () => {
    const { category, policy } = await roads();
    const base = { categoryId: category.id, ackMinutes: 720, resolveMinutes: 4320, note: "a good reason" };
    expect(await updateSlaPolicy(deps(), platformAdmin, { ...base, ackMinutes: 1 })).toEqual({ ok: false, reason: "ack_invalid" });
    expect(await updateSlaPolicy(deps(), platformAdmin, { ...base, resolveMinutes: 10 })).toEqual({ ok: false, reason: "resolve_before_ack" });
    expect(await updateSlaPolicy(deps(), platformAdmin, { ...base, note: "" })).toEqual({ ok: false, reason: "note_invalid" });
    expect(await updateSlaPolicy(deps(), platformAdmin, { ...base, categoryId: crypto.randomUUID() })).toEqual({ ok: false, reason: "not_found" });
    expect((await roads()).policy).toMatchObject({ ackMinutes: policy.ackMinutes, resolveMinutes: policy.resolveMinutes });
    expect(await auditEntries()).toEqual([]);
  });

  it("does nothing, and logs nothing, if the numbers are unchanged", async () => {
    const { category, policy } = await roads();
    const result = await updateSlaPolicy(deps(), platformAdmin, {
      categoryId: category.id,
      ackMinutes: policy.ackMinutes,
      resolveMinutes: policy.resolveMinutes,
      note: "no actual change",
    });
    expect(result).toEqual({ ok: true, changed: false });
    expect(await auditEntries()).toEqual([]);
  });

  it("never touches reports whose timers are already running", async () => {
    const { category } = await roads();
    // A report already routed, with its deadlines fixed at the time it started.
    const [reporter] = await conn.db.select().from(users).where(eq(users.id, resident.userId));
    const ackDueAt = new Date("2026-03-02T09:00:00Z");
    const resolveDueAt = new Date("2026-03-15T09:00:00Z");
    const [report] = await conn.db
      .insert(reports)
      .values({
        reference: "CF-ADMINRPT2",
        categoryId: category.id,
        reporterId: reporter?.id ?? "",
        description: "A large pothole on the main road",
        location: sql`ST_SetSRID(ST_MakePoint(3.3792, 6.5244), 4326)::geography` as unknown as string,
        idempotencyKey: crypto.randomUUID(),
        status: "routed",
        agencyId: existingAgencyId,
        routedAt: new Date("2026-03-01T09:00:00Z"),
        slaCycle: 1,
        slaStartedAt: new Date("2026-03-01T09:00:00Z"),
        ackDueAt,
        resolveDueAt,
      })
      .returning();

    await updateSlaPolicy(deps(), platformAdmin, {
      categoryId: category.id,
      ackMinutes: 60,
      resolveMinutes: 120,
      note: "Much stricter targets for new reports",
    });

    const [after] = await conn.db.select().from(reports).where(eq(reports.id, report?.id ?? ""));
    expect(after?.ackDueAt).toEqual(ackDueAt);
    expect(after?.resolveDueAt).toEqual(resolveDueAt);
  });
});

// -------------------------------------------------------------------------------------------
describe("setCategoryActive", () => {
  it("switches a category off and on, auditing each change", async () => {
    const [category] = await conn.db.select().from(categories).where(eq(categories.slug, "waste"));
    if (!category) throw new Error("category missing");
    expect(await setCategoryActive(deps(), platformAdmin, { categoryId: category.id, active: false })).toEqual({ ok: true, changed: true });
    expect((await conn.db.select().from(categories).where(eq(categories.id, category.id)))[0]?.active).toBe(false);
    expect(await setCategoryActive(deps(), platformAdmin, { categoryId: category.id, active: true })).toEqual({ ok: true, changed: true });
    expect((await auditEntries()).map((e) => e.action)).toEqual(["category.deactivated", "category.activated"]);
  });

  it("does nothing when the category is already in the requested state", async () => {
    const [category] = await conn.db.select().from(categories).where(eq(categories.slug, "waste"));
    expect(await setCategoryActive(deps(), platformAdmin, { categoryId: category?.id ?? "", active: true })).toEqual({ ok: true, changed: false });
    expect(await auditEntries()).toEqual([]);
  });

  it("never lets the last active category be switched off", async () => {
    const all = await conn.db.select().from(categories);
    const [keep, ...rest] = all;
    for (const category of rest) await setCategoryActive(deps(), platformAdmin, { categoryId: category.id, active: false });
    expect(await setCategoryActive(deps(), platformAdmin, { categoryId: keep?.id ?? "", active: false })).toEqual({
      ok: false,
      reason: "last_active_category",
    });
    expect((await conn.db.select().from(categories).where(eq(categories.id, keep?.id ?? "")))[0]?.active).toBe(true);
  });

  it("reports bad input and unknown categories", async () => {
    expect(await setCategoryActive(deps(), platformAdmin, { categoryId: "nope", active: true })).toEqual({ ok: false, reason: "malformed" });
    expect(await setCategoryActive(deps(), platformAdmin, { categoryId: crypto.randomUUID(), active: true })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });
});

// -------------------------------------------------------------------------------------------
describe("the audit log itself", () => {
  it("lists entries newest first, with who made each change", async () => {
    await createAgency(deps(), platformAdmin, { name: "adm-first", type: "roads" });
    await createAgency(deps(), platformAdmin, { name: "adm-second", type: "water" });
    const rows = await listRecentAudit(conn.db);
    expect(rows.map((r) => r.summary)).toEqual(['created agency "adm-second" (water)', 'created agency "adm-first" (roads)']);
    expect(rows[0]).toMatchObject({ actorRole: "platform_admin", actorEmail: "adm-platform@example.com" });
  });

  it("honours the limit", async () => {
    for (const name of ["adm-a1", "adm-a2", "adm-a3"]) await createAgency(deps(), platformAdmin, { name, type: "roads" });
    expect(await listRecentAudit(conn.db, 2)).toHaveLength(2);
  });

  it("cannot be edited or deleted, even directly in the database", async () => {
    await createAgency(deps(), platformAdmin, { name: "adm-permanent", type: "roads" });
    const [row] = await conn.db.select().from(auditLog);
    await expect(conn.db.update(auditLog).set({ summary: "rewritten" }).where(eq(auditLog.id, row?.id ?? ""))).rejects.toThrow();
    await expect(conn.db.delete(auditLog).where(eq(auditLog.id, row?.id ?? ""))).rejects.toThrow();
  });

  it("stores no email addresses or phone numbers in any entry", async () => {
    await createAgency(deps(), platformAdmin, { name: "adm-private", type: "roads" });
    const text = JSON.stringify(await conn.db.select().from(auditLog));
    expect(text).not.toContain("@example.com");
    expect(text).not.toMatch(/\+234\d{10}/);
  });
});
