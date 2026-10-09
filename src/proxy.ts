/**
 * The "proxy": code Next.js runs on the server BEFORE every page request (it used to be called
 * "middleware"). Ours does one job: attach the Content Security Policy header to every page, with
 * a fresh random nonce per request (see src/server/security/csp.ts for what that means).
 *
 * How the nonce reaches the page: we put the finished policy on the request as well as the
 * response. While Next.js renders the page it reads the nonce out of the request's policy and
 * automatically stamps it on its own script tags. Those scripts then run; anything else does not.
 *
 * Pages must be rendered fresh for each visitor for a per-request nonce to work. Almost every
 * page here already is (they read the signed-in user). The few that were static (the home page
 * and a couple of others) become per-request pages; that costs a little speed and is the price of
 * a strict script policy.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { buildContentSecurityPolicy, generateNonce } from "@/server/security/csp";

export function proxy(request: NextRequest) {
  const nonce = generateNonce();
  const policy = buildContentSecurityPolicy({
    nonce,
    isDevelopment: process.env.NODE_ENV === "development",
    isProduction: process.env.NODE_ENV === "production",
    // Photos live on Cloudinary only when it is configured; otherwise the local dev store is used.
    usesCloudinary: Boolean(process.env.CLOUDINARY_CLOUD_NAME),
  });

  // Copy the incoming headers and add ours, so the page being rendered can see the nonce.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  // The same policy goes back to the browser, which is what actually enforces it.
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  matcher: [
    /*
     * Run on pages only. Skip: API routes (they return data or files, not pages), Next.js's
     * static files and image optimiser, the favicon, and link prefetches (which are not pages
     * the visitor is viewing yet).
     */
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
