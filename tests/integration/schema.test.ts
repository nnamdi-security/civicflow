import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { agencies, users } from "@/db/schema";
import { setupTestDb } from "./test-db";

let conn: Awaited<ReturnType<typeof setupTestDb>>;

beforeAll(async () => {
  conn = await setupTestDb();
});

afterEach(async () => {
  await conn.db.delete(users);
  await conn.db.delete(agencies);
});

afterAll(async () => {
  await conn.pool.end();
});

async function createAgency() {
  const [agency] = await conn.db
    .insert(agencies)
    .values({ name: "Test Roads Agency", type: "roads" })
    .returning();
  if (!agency) throw new Error("agency not created");
  return agency;
}

describe("users table", () => {
  it("defaults new users to the resident role with no agency", async () => {
    const [user] = await conn.db.insert(users).values({ email: "a@example.com" }).returning();
    expect(user?.role).toBe("resident");
    expect(user?.agencyId).toBeNull();
  });

  it("rejects an agency role without an agency", async () => {
    await expect(
      conn.db.insert(users).values({ email: "b@example.com", role: "agency_officer" }),
    ).rejects.toThrow();
  });

  it("rejects a resident attached to an agency", async () => {
    const agency = await createAgency();
    await expect(
      conn.db
        .insert(users)
        .values({ email: "c@example.com", role: "resident", agencyId: agency.id }),
    ).rejects.toThrow();
  });

  it("accepts agency staff attached to an agency", async () => {
    const agency = await createAgency();
    await conn.db
      .insert(users)
      .values({ email: "d@example.com", role: "agency_admin", agencyId: agency.id });
    const rows = await conn.db.select().from(users).where(eq(users.email, "d@example.com"));
    expect(rows).toHaveLength(1);
  });

  it("rejects emails that are not lowercase", async () => {
    await expect(conn.db.insert(users).values({ email: "Mixed@Example.com" })).rejects.toThrow();
  });
});

describe("jurisdictions table", () => {
  it("has a GiST index on the geometry column", async () => {
    const result = await conn.db.execute<{ indexdef: string }>(
      sql`select indexdef from pg_indexes where tablename = 'jurisdictions' and indexname = 'jurisdictions_geom_gist'`,
    );
    expect(result.rows[0]?.indexdef).toContain("USING gist");
  });
});
