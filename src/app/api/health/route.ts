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
import { systemClock } from "@/domain/clock";
import { getDb } from "@/server/db";
import { getWorkerHealth } from "@/server/operations/health";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // The shared connection pool, NOT a new one per call. This endpoint is public and unthrottled,
    // so opening a fresh pool each time would let anyone exhaust the database's connections.
    const db = getDb();
    await db.execute(sql`select 1`);
    const worker = await getWorkerHealth(db, systemClock);
    return NextResponse.json({ status: "ok", worker }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    // Deliberately no error detail: it could leak connection info.
    return NextResponse.json({ status: "error" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
