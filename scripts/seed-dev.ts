import { createDb } from "../src/db/client";
import { seedDevData } from "../src/db/seed-dev";

// Usage: pnpm db:seed   (needs DATABASE_URL; refuses to run in production)
async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed in production");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const { db, pool } = createDb(url);
  try {
    await seedDevData(db);
    console.log("Sample jurisdictions and agency seeded (not real boundaries).");
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Failed");
  process.exit(1);
});
