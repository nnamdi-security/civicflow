/**
 * End-to-end test of the resident's privacy rights (ADR 0015), through a real browser:
 *   1. download a copy of their own data;
 *   2. try to delete the account with the wrong confirmation (refused), then with the right one;
 *   3. afterwards: they are signed out, the old address gets a confirmation email, the report
 *      stays publicly trackable without their details, and their photo is really deleted once the
 *      background cleanup runs.
 * Nothing is faked inside the app: real pages, real server, real database, real files.
 */
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { Pool } from "pg";
import { createDb } from "../../src/db/client";
import { systemClock } from "../../src/domain/clock";
import { DevMediaStorage } from "../../src/server/adapters/media/dev-media-storage";
import { runMediaCleanup } from "../../src/server/media/cleanup";
import { readOutbox, resetRateLimits, signInThroughEmail, stamp, stubMapTiles, submitPothole } from "./helpers";

const RESIDENT = `e2e-${stamp}-priv-resident@example.com`;

let pool: Pool;

function databaseUrl() {
  const url = process.env.E2E_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("Set TEST_DATABASE_URL (or E2E_DATABASE_URL) to run the end-to-end tests.");
  return url;
}

/** Removes everything this spec creates, including the erased account's placeholder row and its audit entry. */
async function clear() {
  await pool.query(
    "truncate table audit_log, media_deletions, sla_outcomes, notifications, escalations, assignments, status_events, report_media, reports",
  );
  await pool.query("delete from users where email like 'e2e-%-priv-%@example.com' or email like 'erased-%@erased.invalid'");
}

test.beforeAll(async () => {
  await resetRateLimits();
  pool = new Pool({ connectionString: databaseUrl() });
  await clear();
});

test.afterAll(async () => {
  await clear();
  await pool.end();
});

test("a resident downloads their data, then erases their account, and what should remain remains", async ({ page, browser }) => {
  await stubMapTiles(page);
  await signInThroughEmail(page, RESIDENT, "/report/new");
  const reportUrl = await submitPothole(page);
  const reference = (await page.getByRole("heading", { name: /^Report CF-/ }).textContent())?.replace("Report ", "").trim() ?? "";

  // ---- 1. Download a copy of their own data. ---------------------------------------------------
  await page.goto("/account");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Download my data" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^civicflow-my-data-\d{4}-\d{2}-\d{2}\.json$/);
  const file = JSON.parse(await readFile((await download.path()) ?? "", "utf8"));
  expect(file.format).toBe("civicflow-data-export-v1");
  expect(file.profile).toMatchObject({ email: RESIDENT, role: "resident" });
  expect(file.reports).toHaveLength(1);
  expect(file.reports[0]).toMatchObject({ reference, category: "Roads and potholes" });
  expect(file.reports[0].description).toContain("deep pothole");
  expect(file.reports[0].photos).toHaveLength(1);
  const photoId: string = file.reports[0].photos[0].id;
  // No secrets in the file.
  const fileText = JSON.stringify(file);
  expect(fileText).not.toMatch(/session|token|hash/i);

  // The photo is currently served.
  expect((await page.request.get(`/api/dev-media/file?id=${encodeURIComponent(photoId)}`)).status()).toBe(200);

  // ---- 2. The wrong confirmation is refused; the right one erases the account. ------------------
  await page.getByText("I want to permanently delete my account").click();
  await page.getByLabel("Type DELETE to confirm").fill("please");
  await page.getByRole("button", { name: "Delete my account permanently" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Error:" })).toContainText("type the word DELETE");
  // Still a working account.
  await page.goto("/reports");
  await expect(page.getByRole("link", { name: new RegExp(reference) })).toBeVisible();

  await page.goto("/account");
  await page.getByText("I want to permanently delete my account").click();
  await page.getByLabel("Type DELETE to confirm").fill("DELETE");
  await page.getByRole("button", { name: "Delete my account permanently" }).click();
  await expect(page).toHaveURL(/\/\?erased=1$/);
  await expect(page.getByRole("status")).toContainText("Your account has been deleted");

  // ---- 3. What this leaves behind. -------------------------------------------------------------
  // They are signed out for good.
  await page.goto("/reports");
  await expect(page).toHaveURL(/\/sign-in/);

  // The old address was told, once.
  const notices = (await readOutbox("emails.jsonl")).filter((m) => m.to === RESIDENT && m.subject === "Your CivicFlow account was deleted");
  expect(notices).toHaveLength(1);

  // The report is still on public record, but with nothing personal.
  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  await visitor.goto(`/track/${reference}`);
  await expect(visitor.getByRole("heading", { name: `Report ${reference}` })).toBeVisible();
  const publicText = await visitor.locator("body").innerText();
  expect(publicText).not.toContain("deep pothole");
  expect(publicText).not.toContain(RESIDENT);
  await visitorContext.close();

  // The photo is queued for deletion; once the background cleanup runs, it is really gone.
  const queued = await pool.query<{ public_id: string }>("select public_id from media_deletions");
  expect(queued.rows.map((r) => r.public_id)).toEqual([photoId]);
  const { db, pool: cleanupPool } = createDb(databaseUrl());
  try {
    const result = await runMediaCleanup({ db, clock: systemClock, storage: new DevMediaStorage({ secret: "x".repeat(32) }) });
    expect(result).toEqual({ deleted: 1, retrying: 0, failed: 0 });
  } finally {
    await cleanupPool.end();
  }
  expect((await page.request.get(`/api/dev-media/file?id=${encodeURIComponent(photoId)}`)).status()).toBe(404);

  // Signing in again with the same address starts a brand-new, empty account.
  await resetRateLimits();
  await signInThroughEmail(page, RESIDENT, "/reports");
  await expect(page.getByText("You have not reported anything yet.")).toBeVisible();
});
