import { eq, inArray, sql } from "drizzle-orm";
import { agencies, agencyJurisdictions, jurisdictions } from "./schema";
import type { Db } from "./client";

// Development data only. These polygons are rough rectangles, NOT real administrative
// boundaries. Real state/LGA boundaries are imported in a later phase.
const LAGOS_SAMPLE = "POLYGON((2.70 6.37, 4.35 6.37, 4.35 6.70, 2.70 6.70, 2.70 6.37))";
const IKEJA_SAMPLE = "POLYGON((3.30 6.58, 3.40 6.58, 3.40 6.65, 3.30 6.65, 3.30 6.58))";

const LAGOS_NAME = "Lagos (sample)";
const IKEJA_NAME = "Ikeja (sample)";
const AGENCY_NAME = "Lagos Roads Agency (sample)";

const wkt = (value: string) => sql`ST_Multi(ST_GeomFromText(${value}, 4326))`;

/** Idempotent: replaces the sample rows each run. */
export async function seedDevData(db: Db) {
  return db.transaction(async (tx) => {
    const old = await tx
      .select({ id: agencies.id })
      .from(agencies)
      .where(eq(agencies.name, AGENCY_NAME));
    if (old.length > 0) {
      await tx.delete(agencies).where(
        inArray(
          agencies.id,
          old.map((a) => a.id),
        ),
      );
    }
    await tx.delete(jurisdictions).where(eq(jurisdictions.name, IKEJA_NAME));
    await tx.delete(jurisdictions).where(eq(jurisdictions.name, LAGOS_NAME));

    const [lagos] = await tx
      .insert(jurisdictions)
      .values({ name: LAGOS_NAME, level: "state", geom: wkt(LAGOS_SAMPLE) })
      .returning({ id: jurisdictions.id });
    if (!lagos) throw new Error("seed failed: state");

    const [ikeja] = await tx
      .insert(jurisdictions)
      .values({ name: IKEJA_NAME, level: "lga", parentId: lagos.id, geom: wkt(IKEJA_SAMPLE) })
      .returning({ id: jurisdictions.id });
    if (!ikeja) throw new Error("seed failed: lga");

    const [agency] = await tx
      .insert(agencies)
      .values({ name: AGENCY_NAME, type: "roads" })
      .returning({ id: agencies.id });
    if (!agency) throw new Error("seed failed: agency");

    await tx
      .insert(agencyJurisdictions)
      .values({ agencyId: agency.id, jurisdictionId: lagos.id, priority: 0 });

    return { stateId: lagos.id, lgaId: ikeja.id, agencyId: agency.id };
  });
}
