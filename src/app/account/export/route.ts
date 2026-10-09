/**
 * The "Download my data" file: GET /account/export (ADR 0015).
 *
 * A route handler returns a raw response instead of a page. This one returns the signed-in
 * person's data as a JSON file the browser saves rather than displays.
 *
 * Details that matter for a privacy feature:
 *   - `Content-Disposition: attachment` makes the browser download it as a file.
 *   - `Cache-Control: no-store` stops the browser, proxies or a CDN from keeping a copy of
 *     someone's personal data.
 *   - Who is asked for comes only from the session. There is no id in the address to change.
 *   - It is rate limited (5 per hour per account).
 */
import { NextResponse } from "next/server";
import { systemClock } from "@/domain/clock";
import { exportMyData } from "@/server/account/export";
import { createMediaStorage } from "@/server/adapters/media";
import { getActor } from "@/server/auth/guards";
import { getDb } from "@/server/db";
import { parseMediaEnv } from "@/server/env";
import { PostgresRateLimiter } from "@/server/rate-limit/postgres-rate-limiter";

// Always computed fresh for the person asking; never prerendered.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor = await getActor();
  if (!actor) {
    // Not signed in: send them to sign in, then back to the account page (where the download link is).
    return NextResponse.redirect(new URL("/sign-in?next=%2Faccount", request.url), 303);
  }

  const env = parseMediaEnv(process.env);
  const db = getDb();
  const result = await exportMyData(
    {
      db,
      clock: systemClock,
      media: createMediaStorage(env),
      limiter: new PostgresRateLimiter(db, systemClock),
      secret: env.AUTH_SECRET,
    },
    actor,
  );

  if (!result.ok) {
    const status = result.reason === "rate_limited" ? 429 : 404;
    return new NextResponse(
      result.reason === "rate_limited" ? "Too many downloads. Please try again in a while." : "Not found",
      { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } },
    );
  }

  const day = systemClock.now().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(result.data, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="civicflow-my-data-${day}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
