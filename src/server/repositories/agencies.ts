import { eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { agencies } from "../../db/schema";

export async function findAgencyName(db: Db, agencyId: string): Promise<string | null> {
  const [row] = await db
    .select({ name: agencies.name })
    .from(agencies)
    .where(eq(agencies.id, agencyId))
    .limit(1);
  return row?.name ?? null;
}
