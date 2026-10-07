import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { createDb } from "@/db/client";
import { parseEnv } from "@/server/env";

export const dynamic = "force-dynamic";

export async function GET() {
  let pool: ReturnType<typeof createDb>["pool"] | undefined;
  try {
    const env = parseEnv(process.env);
    const conn = createDb(env.DATABASE_URL);
    pool = conn.pool;
    await conn.db.execute(sql`select 1`);
    return NextResponse.json({ status: "ok" });
  } catch {
    // Deliberately no error detail: it could leak connection info.
    return NextResponse.json({ status: "error" }, { status: 503 });
  } finally {
    await pool?.end();
  }
}
