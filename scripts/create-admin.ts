import { createDb } from "../src/db/client";
import { ensurePlatformAdmin } from "../src/server/users/provisioning";

// Usage: pnpm admin:create <email>   (needs DATABASE_URL)
async function main() {
  const email = process.argv[2];
  const url = process.env.DATABASE_URL;
  if (!email) throw new Error("Usage: pnpm admin:create <email>");
  if (!url) throw new Error("DATABASE_URL is not set");

  const { db, pool } = createDb(url);
  try {
    await ensurePlatformAdmin(db, email);
    console.log("Platform admin ready. They can now sign in with a magic link.");
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Failed");
  process.exit(1);
});
