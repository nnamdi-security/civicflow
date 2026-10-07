import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "./client";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const { db, pool } = createDb(url);
  try {
    await migrate(db, { migrationsFolder: "drizzle" });
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Migration failed");
  process.exit(1);
});
