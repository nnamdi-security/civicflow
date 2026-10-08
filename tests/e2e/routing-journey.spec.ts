import { expect, test } from "@playwright/test";
import { Pool } from "pg";
import { createDb } from "../../src/db/client";
import { systemClock } from "../../src/domain/clock";
import { runSlaScan } from "../../src/server/sla/scan";
import { signInThroughEmail, stamp, stubMapTiles, submitPothole } from "./helpers";

const AGENCY_NAME = "E2E Roads Agency";
const OTHER_AGENCY_NAME = "E2E Other Agency";
const OFFICER = `e2e-${stamp}-officer@example.com`;
const OTHER_OFFICER = `e2e-${stamp}-other-officer@example.com`;
const RESIDENT = `e2e-${stamp}-routed-resident@example.com`;
// Covers all of Nigeria's submission bounds, so wherever the test clicks on the map is routable.
const COVERAGE = "POLYGON((2 4, 15 4, 15 14.5, 2 14.5, 2 4))";

let pool: Pool;

function databaseUrl() {
  const url = process.env.E2E_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("Set TEST_DATABASE_URL (or E2E_DATABASE_URL) to run the end-to-end tests.");
  return url;
}

// status_events and assignments reject DELETE, so tests clear them with TRUNCATE (test database only).
async function clear() {
  await pool.query("truncate table escalations, assignments, status_events, report_media, reports");
  await pool.query("delete from users where email like 'e2e-%-officer@example.com' or email like 'e2e-%-other-officer@example.com'");
  await pool.query("delete from agencies where name = any($1)", [[AGENCY_NAME, OTHER_AGENCY_NAME]]);
  await pool.query("delete from jurisdictions where name = 'E2E Nigeria'");
}

test.beforeAll(async () => {
  pool = new Pool({ connectionString: databaseUrl() });
  await clear();
  const state = await pool.query<{ id: string }>(
    "insert into jurisdictions (name, level, geom) values ('E2E Nigeria', 'state', ST_Multi(ST_GeomFromText($1, 4326))) returning id",
    [COVERAGE],
  );
  const agencies = await pool.query<{ id: string; name: string }>(
    "insert into agencies (name, type) values ($1, 'roads'), ($2, 'roads') returning id, name",
    [AGENCY_NAME, OTHER_AGENCY_NAME],
  );
  const mine = agencies.rows.find((a) => a.name === AGENCY_NAME);
  const other = agencies.rows.find((a) => a.name === OTHER_AGENCY_NAME);
  const stateId = state.rows[0]?.id;
  if (!mine || !other || !stateId) throw new Error("fixtures not created");
  await pool.query("insert into agency_jurisdictions (agency_id, jurisdiction_id) values ($1, $2)", [mine.id, stateId]);
  await pool.query(
    "insert into users (email, role, agency_id) values ($1, 'agency_officer', $3), ($2, 'agency_officer', $4)",
    [OFFICER, OTHER_OFFICER, mine.id, other.id],
  );
});

test.afterAll(async () => {
  await clear();
  await pool.end();
});

test("a report is routed to its agency, the officer acknowledges it, and the resident sees the progress", async ({
  page,
  browser,
}) => {
  await stubMapTiles(page);
  await signInThroughEmail(page, RESIDENT, "/report/new");
  const reportUrl = await submitPothole(page);
  const reportId = reportUrl.split("/").pop();

  // Routing happened as part of submission.
  await expect(page.getByText("Status: Sent to agency").first()).toBeVisible();
  await expect(page.getByText(AGENCY_NAME)).toBeVisible();

  // A resident has no staff inbox, and cannot open the staff view of the report.
  expect((await page.goto("/agency"))?.status()).toBe(404);
  expect((await page.goto(`/agency/reports/${reportId}`))?.status()).toBe(404);

  // Another agency's officer sees nothing and gets a 404 on the report.
  const otherContext = await browser.newContext();
  const otherPage = await otherContext.newPage();
  await signInThroughEmail(otherPage, OTHER_OFFICER, "/agency");
  await expect(otherPage.getByText("There are no reports to show.")).toBeVisible();
  expect((await otherPage.goto(`/agency/reports/${reportId}`))?.status()).toBe(404);
  await otherContext.close();

  // The assigned agency's officer finds it in the inbox and acknowledges it.
  const staffContext = await browser.newContext();
  const staff = await staffContext.newPage();
  await signInThroughEmail(staff, OFFICER, "/agency");
  await staff.getByRole("link", { name: /^CF-[A-Z0-9]{8}: Roads and potholes$/ }).click();
  await expect(staff.getByText("Status: Sent to agency").first()).toBeVisible();
  await staff.getByRole("button", { name: "Acknowledge" }).click();
  await expect(staff.getByRole("status")).toHaveText("Status updated.");
  await expect(staff.getByText("Status: Acknowledged").first()).toBeVisible();
  // An officer cannot reassign, and can no longer acknowledge.
  await expect(staff.getByRole("button", { name: "Reassign" })).toHaveCount(0);
  await expect(staff.getByRole("button", { name: "Acknowledge" })).toHaveCount(0);
  await staffContext.close();

  // The resident sees the new status and the history.
  await page.goto(reportUrl);
  await expect(page.getByText("Status: Acknowledged").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Progress" })).toBeVisible();
  await expect(page.locator("ol").getByText("Status: Sent to agency")).toBeVisible();
});

test("a report left unacknowledged is flagged overdue and escalated, for staff and for the resident", async ({
  page,
  browser,
}) => {
  await stubMapTiles(page);
  await signInThroughEmail(page, `e2e-${stamp}-overdue-resident@example.com`, "/report/new");
  const reportUrl = await submitPothole(page);
  const reportId = reportUrl.split("/").pop();

  // Nothing is overdue yet.
  await expect(page.getByText(/^Overdue:/)).toHaveCount(0);

  // Pretend the acknowledgement deadline passed 80 hours ago, then run the real scan.
  await pool.query("update reports set ack_due_at = now() - interval '80 hours' where id = $1", [reportId]);
  const { db, pool: scanPool } = createDb(databaseUrl());
  try {
    expect((await runSlaScan(db, systemClock)).recorded).toBe(3);
    expect((await runSlaScan(db, systemClock)).recorded).toBe(0);
  } finally {
    await scanPool.end();
  }

  // The resident is told, in words, and sees the public flag.
  await page.goto(reportUrl);
  await expect(page.getByText(/Overdue: the agency has not yet acknowledged this report\. It has been marked publicly overdue\./)).toBeVisible();

  // Staff see which timer is overdue and how far it escalated.
  const staffContext = await browser.newContext();
  const staff = await staffContext.newPage();
  await signInThroughEmail(staff, OFFICER, `/agency/reports/${reportId}`);
  await expect(staff.getByText("Overdue: acknowledgement (escalated: publicly marked overdue)")).toBeVisible();
  await expect(staff.getByText("Acknowledge by")).toBeVisible();

  // Acknowledging stops that timer, so the notice goes away.
  await staff.getByRole("button", { name: "Acknowledge" }).click();
  await expect(staff.getByRole("status")).toHaveText("Status updated.");
  await expect(staff.getByText(/^Overdue:/)).toHaveCount(0);
  await staffContext.close();
  await page.goto(reportUrl);
  await expect(page.getByText(/^Overdue:/)).toHaveCount(0);
});
