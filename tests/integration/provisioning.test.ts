import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { agencies, agencyJurisdictions, jurisdictions, users } from "@/db/schema";
import { seedDevData } from "@/db/seed-dev";
import type { Actor } from "@/domain/permissions";
import { ForbiddenError } from "@/server/auth/errors";
import {
  AgencyNotFoundError,
  UserExistsError,
  ensurePlatformAdmin,
  provisionUser,
} from "@/server/users/provisioning";
import { setupTestDb } from "./test-db";

let conn: Awaited<ReturnType<typeof setupTestDb>>;

const platformAdmin: Actor = { role: "platform_admin", agencyId: null };

beforeAll(async () => {
  conn = await setupTestDb();
});

async function clearStaffData() {
  await conn.db.delete(users);
  await conn.db.delete(agencyJurisdictions);
  await conn.db.delete(agencies);
  await conn.db.delete(jurisdictions);
}

beforeEach(clearStaffData);

afterAll(async () => {
  // Leave no sample agencies or jurisdictions behind: routing tests in other files would pick them up.
  await clearStaffData();
  await conn.pool.end();
});

describe("provisionUser", () => {
  it("lets a platform admin create agency staff, with the email lowercased", async () => {
    const { agencyId } = await seedDevData(conn.db);
    const created = await provisionUser(conn.db, platformAdmin, {
      email: "Officer@Example.com",
      role: "agency_officer",
      agencyId,
    });
    const [row] = await conn.db.select().from(users);
    expect(row).toMatchObject({ id: created.id, email: "officer@example.com", role: "agency_officer" });
  });

  it("lets an agency admin create officers in their own agency only", async () => {
    const { agencyId } = await seedDevData(conn.db);
    const admin: Actor = { role: "agency_admin", agencyId };
    await provisionUser(conn.db, admin, { email: "o@example.com", role: "agency_officer", agencyId });
    await expect(
      provisionUser(conn.db, admin, {
        email: "p@example.com",
        role: "agency_officer",
        agencyId: crypto.randomUUID(),
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("denies residents and officers before touching the database", async () => {
    for (const role of ["resident", "agency_officer"] as const) {
      await expect(
        provisionUser(
          conn.db,
          { role, agencyId: role === "resident" ? null : crypto.randomUUID() },
          { email: "x@example.com", role: "platform_admin", agencyId: null },
        ),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect(await conn.db.select().from(users)).toHaveLength(0);
  });

  it("rejects an unknown agency", async () => {
    await expect(
      provisionUser(conn.db, platformAdmin, {
        email: "o@example.com",
        role: "agency_officer",
        agencyId: crypto.randomUUID(),
      }),
    ).rejects.toBeInstanceOf(AgencyNotFoundError);
  });

  it("never changes an existing account", async () => {
    await conn.db.insert(users).values({ email: "existing@example.com" });
    await expect(
      provisionUser(conn.db, platformAdmin, {
        email: "EXISTING@example.com",
        role: "platform_admin",
        agencyId: null,
      }),
    ).rejects.toBeInstanceOf(UserExistsError);
    const [row] = await conn.db.select().from(users);
    expect(row?.role).toBe("resident");
  });
});

describe("ensurePlatformAdmin", () => {
  it("creates a platform admin and is idempotent", async () => {
    await ensurePlatformAdmin(conn.db, "Boss@Example.com");
    await ensurePlatformAdmin(conn.db, "boss@example.com");
    const rows = await conn.db.select().from(users);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: "boss@example.com", role: "platform_admin" });
  });

  it("promotes an existing resident and clears any agency", async () => {
    await conn.db.insert(users).values({ email: "r@example.com" });
    await ensurePlatformAdmin(conn.db, "r@example.com");
    const [row] = await conn.db.select().from(users);
    expect(row).toMatchObject({ role: "platform_admin", agencyId: null });
  });
});

describe("seedDevData", () => {
  it("is idempotent", async () => {
    await seedDevData(conn.db);
    await seedDevData(conn.db);
    expect(await conn.db.select().from(jurisdictions)).toHaveLength(2);
    expect(await conn.db.select().from(agencies)).toHaveLength(1);
  });

  it("produces polygons that contain points in lon/lat order", async () => {
    const { lgaId } = await seedDevData(conn.db);
    // Ikeja sample: lon 3.30-3.40, lat 6.58-6.65. A point inside, and the same point with lat/lon swapped.
    const result = await conn.db.execute<{ inside: boolean; swapped: boolean }>(sql`
      select
        ST_Covers(geom, ST_SetSRID(ST_MakePoint(3.35, 6.60), 4326)) as inside,
        ST_Covers(geom, ST_SetSRID(ST_MakePoint(6.60, 3.35), 4326)) as swapped
      from jurisdictions where id = ${lgaId}`);
    expect(result.rows[0]).toEqual({ inside: true, swapped: false });
  });
});
