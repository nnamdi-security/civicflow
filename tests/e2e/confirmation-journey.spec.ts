import { expect, test, type Page } from "@playwright/test";
import { Pool } from "pg";
import { createDb } from "../../src/db/client";
import { systemClock } from "../../src/domain/clock";
import { runSlaScan } from "../../src/server/sla/scan";
import { signInThroughEmail, stamp, stubMapTiles, submitPothole, resetRateLimits } from "./helpers";

const AGENCY_NAME = "E2E Confirm Agency";
const AREA_NAME = "E2E Confirm Area";
const OFFICER = `e2e-${stamp}-confirm-officer@example.com`;
const RESIDENT = `e2e-${stamp}-confirm-resident@example.com`;
const COVERAGE = "POLYGON((2 4, 15 4, 15 14.5, 2 14.5, 2 4))";

let pool: Pool;

function databaseUrl() {
  const url = process.env.E2E_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("Set TEST_DATABASE_URL (or E2E_DATABASE_URL) to run the end-to-end tests.");
  return url;
}

// Append-only tables reject DELETE, so tests clear them with TRUNCATE (test database only).
async function clear() {
  await pool.query("truncate table sla_outcomes, notifications, escalations, assignments, status_events, report_media, reports");
  await pool.query("delete from users where email like 'e2e-%-confirm-officer@example.com'");
  await pool.query("delete from agencies where name = $1", [AGENCY_NAME]);
  await pool.query("delete from jurisdictions where name = $1", [AREA_NAME]);
}

test.beforeAll(async () => {
  await resetRateLimits(); // fresh sign-in counters for this spec (see helpers.ts)
  pool = new Pool({ connectionString: databaseUrl() });
  await clear();
  const area = await pool.query<{ id: string }>(
    "insert into jurisdictions (name, level, geom) values ($1, 'state', ST_Multi(ST_GeomFromText($2, 4326))) returning id",
    [AREA_NAME, COVERAGE],
  );
  const agency = await pool.query<{ id: string }>("insert into agencies (name, type) values ($1, 'roads') returning id", [AGENCY_NAME]);
  const areaId = area.rows[0]?.id;
  const agencyId = agency.rows[0]?.id;
  if (!areaId || !agencyId) throw new Error("fixtures not created");
  await pool.query("insert into agency_jurisdictions (agency_id, jurisdiction_id) values ($1, $2)", [agencyId, areaId]);
  await pool.query("insert into users (email, role, agency_id) values ($1, 'agency_officer', $2)", [OFFICER, agencyId]);
});

test.afterAll(async () => {
  await clear();
  await pool.end();
});

async function reference(page: Page): Promise<string> {
  const heading = await page.getByRole("heading", { name: /^Report CF-[A-Z0-9]{8}$/ }).textContent();
  return (heading ?? "").replace("Report ", "").trim();
}

async function staffStep(staff: Page, button: string, status: string) {
  await staff.getByRole("button", { name: button }).click();
  await expect(staff.getByRole("status")).toHaveText("Status updated.");
  await expect(staff.getByText(status).first()).toBeVisible();
}

test("a resident disputes a resolution, then confirms the second fix, and the public sees progress only", async ({ page, browser }) => {
  await stubMapTiles(page);
  await signInThroughEmail(page, RESIDENT, "/report/new");
  const reportUrl = await submitPothole(page);
  const reportId = reportUrl.split("/").pop() ?? "";
  const ref = await reference(page);

  // The officer works the report through to "resolved".
  const staffContext = await browser.newContext();
  const staff = await staffContext.newPage();
  await signInThroughEmail(staff, OFFICER, `/agency/reports/${reportId}`);
  await staffStep(staff, "Acknowledge", "Status: Acknowledged");
  await staffStep(staff, "Start work", "Status: In progress");

  // While work is under way the resident sees the deadline the agency is held to.
  await page.goto(reportUrl);
  await expect(page.getByText("Agency should resolve by")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Has this been fixed?" })).toHaveCount(0);

  await staffStep(staff, "Mark resolved", "Status: Resolved");

  // Once resolved the timer has stopped, and the resident is asked whether it is really fixed.
  await page.goto(reportUrl);
  await expect(page.getByRole("heading", { name: "Has this been fixed?" })).toBeVisible();
  await expect(page.getByText("Agency should resolve by")).toHaveCount(0);

  // Saying "not fixed" needs a note, and changes nothing without one.
  await page.getByRole("button", { name: "No, it is not fixed" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Error:" })).toContainText("Tell us what is still wrong");
  await expect(page.getByText("Status: Resolved").first()).toBeVisible();

  await page.getByLabel(/what is still wrong/).fill("The hole is still there, only the edges were patched.");
  await page.getByRole("button", { name: "No, it is not fixed" }).click();
  await expect(page.getByRole("status")).toContainText("We reopened your report");
  await expect(page.getByText("Status: Disputed").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Has this been fixed?" })).toHaveCount(0);
  // The dispute restarts the resolution timer.
  await expect(page.getByText("Agency should resolve by")).toBeVisible();

  // Staff see it reopened, and fix it again.
  await staff.goto(`/agency/reports/${reportId}`);
  await expect(staff.getByText("Status: Disputed").first()).toBeVisible();
  await expect(staff.getByText("The hole is still there")).toBeVisible();
  await staffStep(staff, "Reopen", "Status: In progress");
  await staffStep(staff, "Mark resolved", "Status: Resolved");
  await staffContext.close();

  // This time the resident confirms. A second tap on a stale page is harmless.
  await page.goto(reportUrl);
  await page.getByRole("button", { name: "Yes, it is fixed" }).click();
  await expect(page.getByRole("status")).toContainText("recorded that the problem is fixed");
  await expect(page.getByText("Status: Confirmed fixed").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Has this been fixed?" })).toHaveCount(0);

  // A signed-out visitor can look the report up by its code, typed any way, and sees progress only.
  const publicContext = await browser.newContext();
  const visitor = await publicContext.newPage();
  await visitor.goto("/track");
  await visitor.getByLabel("Reference code").fill(ref.toLowerCase().replace("-", " "));
  await visitor.getByRole("button", { name: "Find report" }).click();
  await visitor.waitForURL(new RegExp(`/track/${ref}$`));
  await expect(visitor.getByRole("heading", { name: `Report ${ref}` })).toBeVisible();
  await expect(visitor.getByText("Roads and potholes", { exact: true })).toBeVisible();
  await expect(visitor.getByText(AGENCY_NAME)).toBeVisible();
  await expect(visitor.getByText(AREA_NAME, { exact: true })).toBeVisible();
  await expect(visitor.getByText("Status: Confirmed fixed").first()).toBeVisible();
  await expect(visitor.getByText("Status: Disputed")).toBeVisible();
  await expect(visitor.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);

  const body = (await visitor.locator("body").innerText()) + (await visitor.content());
  for (const secret of ["deep pothole", "floods when it rains", "only the edges were patched", RESIDENT, OFFICER]) {
    expect(body).not.toContain(secret);
  }
  expect(body).not.toMatch(/\d{1,2}\.\d{4,}/); // no coordinates
  // No photos. Scoped to <main> because the dev server can overlay its own badge outside the page content.
  await expect(visitor.locator("main").getByRole("img")).toHaveCount(0);

  // Unknown and malformed codes are plain 404s, and a bad code in the form is explained.
  expect((await visitor.goto("/track/CF-ZZZZZZZZ"))?.status()).toBe(404);
  expect((await visitor.goto("/track/banana"))?.status()).toBe(404);
  await visitor.goto("/track");
  await visitor.getByLabel("Reference code").fill("not a code");
  await visitor.getByRole("button", { name: "Find report" }).click();
  await expect(visitor.getByRole("alert").filter({ hasText: "Error:" })).toContainText("does not look like a report reference");
  await publicContext.close();
});

test("a publicly overdue report appears on the overdue board and its public page, without private details", async ({ page, browser }) => {
  await stubMapTiles(page);
  await signInThroughEmail(page, `e2e-${stamp}-confirm-late@example.com`, "/report/new");
  const reportUrl = await submitPothole(page);
  const reportId = reportUrl.split("/").pop() ?? "";
  const ref = await reference(page);

  const publicContext = await browser.newContext();
  const visitor = await publicContext.newPage();

  // Not overdue yet: not on the board.
  await visitor.goto("/overdue");
  await expect(visitor.getByRole("heading", { name: "Overdue reports" })).toBeVisible();
  await expect(visitor.getByText(ref)).toHaveCount(0);

  // The acknowledgement deadline passed 80 hours ago; the real scan marks it publicly overdue.
  await pool.query("update reports set ack_due_at = now() - interval '80 hours' where id = $1", [reportId]);
  const { db, pool: scanPool } = createDb(databaseUrl());
  try {
    await runSlaScan(db, systemClock);
  } finally {
    await scanPool.end();
  }

  await visitor.goto("/overdue");
  const item = visitor.getByRole("listitem").filter({ hasText: ref });
  await expect(item).toContainText("Roads and potholes");
  await expect(item).toContainText(AGENCY_NAME);
  await expect(item).toContainText(AREA_NAME);
  await expect(item).toContainText("Overdue by 3 day(s)");

  await visitor.goto(`/track/${ref}`);
  await expect(visitor.getByText("This report is marked publicly overdue.")).toBeVisible();
  await expect(visitor.getByText("Overdue: the agency has not yet acknowledged this report.")).toBeVisible();
  await expect(visitor.getByText("Agency should acknowledge by")).toBeVisible();
  const body = (await visitor.locator("body").innerText()) + (await visitor.content());
  expect(body).not.toContain("deep pothole");
  expect(body).not.toContain("confirm-late@example.com");
  await publicContext.close();
});
