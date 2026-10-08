import type { NextRequest } from "next/server";
import { handlers } from "@/server/auth";
import { allowSignInAttempt } from "@/server/auth/sign-in-limits";

export const GET = handlers.GET;

export async function POST(request: NextRequest) {
  // Direct POSTs to the sign-in endpoint bypass our form action, so limit by address here too.
  if (new URL(request.url).pathname.startsWith("/api/auth/signin")) {
    if (!(await allowSignInAttempt(request.headers))) {
      return new Response("Too many requests", { status: 429 });
    }
  }
  return handlers.POST(request);
}
