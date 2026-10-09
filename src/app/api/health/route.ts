/**
 * The public health check: GET /api/health.
 *
 * Hosting platforms and monitoring tools call this to ask "is the app alive?". It returns:
 *   { "status": "ok", "worker": "ok" | "degraded" | "unknown" }
 * with HTTP 200, or { "status": "error" } with HTTP 503 if the database cannot be reached.
 *
 *   - `status` is about the WEBSITE and its database. A 503 means the site cannot serve people.
 *   - `worker` is about the separate background worker. It does NOT change the HTTP status,
 *     because the website itself is fine without it. But "degraded" means deadlines may not be
 *     enforced and messages may not be going out, so a monitor should alert on it.
 *     "unknown" means no job has ever reported in (a fresh install).
 *
 * Deliberately minimal and public: one word each, no counts, no error details that could leak
 * connection information. The detailed picture is on the platform-admin health page.
 */
import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { createDb } from "@/db/client";
import { systemClock } from "@/domain/clock";
import { parseEnv } from "@/server/env";
import { getWorkerHealth } from "@/server/operations/health";

export const dynamic = "force-dynamic";

export async function GET() {
  let pool: ReturnType<typeof createDb>["pool"] | undefined;
  try {
    const env = parseEnv(process.env);
    const conn = createDb(env.DATABASE_URL);
    pool = conn.pool;
    await conn.db.execute(sql`select 1`);
    const worker = await getWorkerHealth(conn.db, systemClock);
    return NextResponse.json({ status: "ok", worker }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    // Deliberately no error detail: it could leak connection info.
    return NextResponse.json({ status: "error" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  } finally {
    await pool?.end();
  }
}
