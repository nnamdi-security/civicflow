import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "@/db/client";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  throw new Error("TEST_DATABASE_URL is not set. Start the database with `pnpm db:up`.");
}

const { db, pool } = createDb(url);

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
});

afterAll(async () => {
  await pool.end();
});

describe("database bootstrap", () => {
  it("has the PostGIS extension enabled by migrations", async () => {
    const result = await db.execute<{ version: string }>(sql`select postgis_version() as version`);
    expect(result.rows[0]?.version).toMatch(/^\d+\.\d+/);
  });

  it("stores and queries a geography point in lon/lat order", async () => {
    const result = await db.execute<{ lon: number }>(
      sql`select ST_X(ST_GeogFromText('SRID=4326;POINT(3.3792 6.5244)')::geometry) as lon`,
    );
    expect(result.rows[0]?.lon).toBeCloseTo(3.3792, 4);
  });
});
