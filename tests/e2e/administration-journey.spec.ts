/**
 * End-to-end test for Phase 8 Part A (ADR 0014), driven through a real browser:
 *   - a platform admin creates an agency, gives it coverage, changes an SLA deadline and invites staff;
 *   - a resident's report is routed to the new agency and the officer acknowledges it;
 *   - the agency admin sees that agency's performance (and ONLY that agency's);
 *   - officers cannot see admin or dashboard pages;
 *   - deactivating an officer signs them out at once and stops new sign-in links.
 *
 * "End-to-end" means nothing is faked inside the app: real pages, real server, real database.
 * Because it creates real rows, the `clear()` helper removes everything it made, before and after.
 */
import { expect, test } from "@playwright/test";
import { Pool } from "pg";
import { readOutbox, signInThroughEmail, stamp, stubMapTiles, submitPothole, resetRateLimits } from "./helpers";

const PLATFORM = `e2e-${stamp}-adm-platform@example.com`;
const AGENCY_ADMIN = `e2e-${stamp}-adm-agencyadmin@example.com`;
const OFFICER = `e2e-${stamp}-adm-officer@example.com`;
const RESIDENT = `e2e-${stamp}-adm-resident@example.com`;
const AGENCY = "E2E Admin Agency";
const AGENCY_TWO = "E2E Admin Agency Two"; // used only by the second test, which sets up its own data
const OFFICER_TWO = `e2e-${stamp}-adm-officer2@example.com`;
const AREA = "E2E Admin Area";
// A shape that covers all of Nigeria's allowed report locations, so wherever the test clicks is routable.
const COVERAGE = "POLYGON((2 4, 15 4, 15 14.5, 2 14.5, 2 4))";

let pool: Pool;
// The roads SLA policy as we found it, so the test can put it back.
let originalRoadsPolicy: { ack_minutes: number; resolve_minutes: number };

function databaseUrl() {
  const url = process.env.E2E_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("Set TEST_DATABASE_URL (or E2E_DATABASE_URL) to run the end-to-end tests.");
  return url;
}

/** Removes everything this spec creates. Append-only tables are emptied with TRUNCATE (test database only). */
async function clear() {
  await pool.query(
    "truncate table audit_log, sla_outcomes, notifications, escalations, assignments, status_events, report_media, reports",
  );
  await pool.query("delete from users where email like 'e2e-%-adm-%@example.com'");
  await pool.query("delete from agencies where name = any($1)", [[AGENCY, AGENCY_TWO]]);
  await pool.query("delete from jurisdictions where name = $1", [AREA]);
}

test.beforeAll(async () => {
  await resetRateLimits(); // fresh sign-in counters for this spec (see helpers.ts)
  pool = new Pool({ connectionString: databaseUrl() });
  const policy = await pool.query<{ ack_minutes: number; resolve_minutes: number }>(
    "select p.ack_minutes, p.resolve_minutes from sla_policies p join categories c on c.id = p.category_id where c.slug = 'roads'",
  );
  originalRoadsPolicy = policy.rows[0] ?? { ack_minutes: 1440, resolve_minutes: 20160 };
  await clear();
  // The area an admin will assign, and the first platform admin (who in real life is created with `pnpm admin:create`).
  await pool.query("insert into jurisdictions (name, level, geom) values ($1, 'state', ST_Multi(ST_GeomFromText($2, 4326)))", [AREA, COVERAGE]);
  await pool.query("insert into users (email, role) values ($1, 'platform_admin')", [PLATFORM]);
});

test.afterAll(async () => {
  // Put the shared roads SLA policy back exactly as it was.
  await pool.query(
    "update sla_policies set ack_minutes = $1, resolve_minutes = $2 where category_id = (select id from categories where slug = 'roads')",
    [originalRoadsPolicy.ack_minutes, originalRoadsPolicy.resolve_minutes],
  );
  await clear();
  await pool.end();
});

test("a platform admin sets up an agency and staff; the agency admin then sees only their agency's performance", async ({
  page,
  browser,
}) => {
  await stubMapTiles(page);

  // ---- 1. The platform admin creates an agency and gives it an area. -------------------------
  await signInThroughEmail(page, PLATFORM, "/admin");
  await expect(page.getByRole("heading", { name: "Administration" })).toBeVisible();

  await page.getByRole("link", { name: "Agencies and the areas they cover" }).click();
  // A name that is too short is refused with a clear message.
  await page.getByLabel("Name").fill("X");
  await page.getByLabel(/^Type/).selectOption("roads");
  await page.getByRole("button", { name: "Create agency" }).click();
  // (The browser's own `minlength` check may stop a one-letter name before the server sees it; either way nothing is created.)
  await expect(page.getByRole("link", { name: AGENCY })).toHaveCount(0);

  await page.getByLabel("Name").fill(AGENCY);
  await page.getByLabel(/^Type/).selectOption("roads");
  await page.getByRole("button", { name: "Create agency" }).click();
  await expect(page.getByRole("heading", { name: AGENCY })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Agency created.");

  // Add coverage with priority 3, then change it to 7.
  await page.getByRole("combobox", { name: /^Area/ }).selectOption({ label: `${AREA} (state)` });
  await page.getByLabel(/^Priority \(0 to 1000/).fill("3");
  await page.getByRole("button", { name: "Add area" }).click();
  await expect(page.getByRole("status")).toHaveText("Coverage added.");
  const coverageRow = page.getByRole("listitem").filter({ hasText: AREA });
  await expect(coverageRow.getByLabel(/^Priority/)).toHaveValue("3");
  await coverageRow.getByLabel(/^Priority/).fill("7");
  await coverageRow.getByRole("button", { name: "Save priority" }).click();
  await expect(page.getByRole("status")).toHaveText("Priority saved.");
  await expect(page.getByRole("listitem").filter({ hasText: AREA }).getByLabel(/^Priority/)).toHaveValue("7");

  // ---- 2. The platform admin changes an SLA deadline (a reason is required). ------------------
  await page.goto("/admin/sla");
  const roadsForm = page.locator("form").filter({ has: page.getByRole("heading", { name: "Roads and potholes" }) });
  await roadsForm.getByLabel(/^Acknowledge within/).fill("720");
  await roadsForm.getByLabel(/^Resolve within/).fill("4320");
  // The box has a `required` attribute, so the browser itself asks for a reason first.
  await roadsForm.getByLabel(/^Reason for the change/).fill("Faster targets agreed for the pilot");
  await roadsForm.getByRole("button", { name: /^Save/ }).click();
  await expect(page.getByRole("status")).toContainText("SLA policy saved");
  await expect(page.getByText("acknowledge within 12 h, resolve within 3 d").first()).toBeVisible();

  // ---- 3. The platform admin invites an agency admin and an officer for the new agency. --------
  await page.goto("/agency/staff");
  for (const [email, role] of [
    [AGENCY_ADMIN, "agency_admin"],
    [OFFICER, "agency_officer"],
  ] as const) {
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Role").selectOption(role);
    await page.getByLabel(/^Agency/).selectOption({ label: AGENCY });
    await page.getByRole("button", { name: "Invite", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Invitation created");
  }
  // Inviting the same address twice is refused.
  await page.getByLabel("Email address").fill(OFFICER);
  await page.getByRole("button", { name: "Invite", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Error:" })).toContainText("already exists");

  // ---- 4. A resident reports a problem; it is routed to the new agency; the officer acknowledges it.
  const residentContext = await browser.newContext();
  const resident = await residentContext.newPage();
  await stubMapTiles(resident);
  await signInThroughEmail(resident, RESIDENT, "/report/new");
  const reportUrl = await submitPothole(resident);
  const reportId = reportUrl.split("/").pop() ?? "";
  await expect(resident.getByText(AGENCY).first()).toBeVisible(); // "Handled by" the new agency
  await residentContext.close();

  const officerContext = await browser.newContext();
  const officer = await officerContext.newPage();
  await signInThroughEmail(officer, OFFICER, `/agency/reports/${reportId}`);
  await officer.getByRole("button", { name: "Acknowledge" }).click();
  await expect(officer.getByRole("status")).toHaveText("Status updated.");

  // ---- 5. Officers cannot reach admin, staff-management or performance pages. -----------------
  for (const path of ["/admin", "/admin/agencies", "/admin/audit", "/admin/health", "/agency/staff", "/agency/performance"]) {
    expect((await officer.goto(path))?.status(), `officer opening ${path}`).toBe(404);
  }
  await officerContext.close();

  // ---- 6. The agency admin sees their own agency's performance, and only theirs. --------------
  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  await signInThroughEmail(admin, AGENCY_ADMIN, "/agency/performance");
  await expect(admin.getByRole("heading", { name: "Your agency's performance" })).toBeVisible();
  const row = admin.getByRole("row").filter({ hasText: AGENCY });
  await expect(row).toContainText("100% (1 of 1), small sample"); // acknowledged on time, but one report is a small sample
  await expect(row).toContainText("None overdue");
  // Other agencies (such as the sample agency, if present) must not appear anywhere on the page.
  await expect(admin.getByRole("row")).toHaveCount(2); // one header row + this agency's row
  // A longer window can be chosen, and a nonsense window falls back to the default instead of failing.
  await admin.getByRole("link", { name: "Last 90 days" }).click();
  await expect(admin.getByRole("link", { name: "Last 90 days" })).toHaveAttribute("aria-current", "page");
  await admin.goto("/agency/performance?days=banana");
  await expect(admin.getByRole("link", { name: "Last 30 days" })).toHaveAttribute("aria-current", "page");

  // The agency admin sees only their own agency's people, and cannot choose another role or agency.
  await admin.goto("/agency/staff");
  // (The email appears twice on a row: as the name and inside the button label, so check the row.)
  await expect(admin.getByRole("listitem").filter({ hasText: OFFICER })).toBeVisible();
  await expect(admin.getByText(PLATFORM)).toHaveCount(0);
  await expect(admin.getByLabel("Role")).toHaveCount(0);
  // They cannot open platform-admin pages.
  expect((await admin.goto("/admin/sla"))?.status()).toBe(404);
  await adminContext.close();

  // ---- 7. The platform admin sees every agency, and the audit log records the changes. ---------
  await page.goto("/agency/performance");
  await expect(page.getByRole("heading", { name: "Agency performance" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: AGENCY })).toBeVisible();

  // The system health page lists every background job (the worker is not running in this test, so
  // they have not reported in) and shows no personal data.
  await page.goto("/admin/health");
  await expect(page.getByRole("heading", { name: "System health" })).toBeVisible();
  for (const job of ["sla-scan", "notification-dispatch", "auto-confirm", "retention", "media-cleanup"]) {
    await expect(page.getByRole("row").filter({ hasText: job })).toBeVisible();
  }
  expect(await page.locator("main").innerText()).not.toContain(OFFICER);

  await page.goto("/admin/audit");
  const auditText = await page.locator("main").innerText();
  for (const action of ["agency.created", "coverage.added", "coverage.priority_changed", "sla_policy.updated", "staff.invited"]) {
    expect(auditText).toContain(action);
  }
  // The log names the admin who acted, but never the people who were invited.
  expect(auditText).toContain(PLATFORM);
  expect(auditText).not.toContain(OFFICER);
  expect(auditText).not.toContain(AGENCY_ADMIN);
});

test("deactivating an officer signs them out at once and stops new sign-in links; reactivating restores access", async ({
  page,
  browser,
}) => {
  // This test sets up its own data (it does not rely on the first test): one agency with one officer.
  const created = await pool.query<{ id: string }>("insert into agencies (name, type) values ($1, 'roads') returning id", [AGENCY_TWO]);
  await pool.query("insert into users (email, role, agency_id) values ($1, 'agency_officer', $2)", [OFFICER_TWO, created.rows[0]?.id]);

  // Sign in as the platform admin, who manages staff.
  await signInThroughEmail(page, PLATFORM, "/agency/staff");

  const officerContext = await browser.newContext();
  const officer = await officerContext.newPage();
  await signInThroughEmail(officer, OFFICER_TWO, "/agency");
  await expect(officer.getByRole("heading", { name: "Your agency's reports" })).toBeVisible();

  // Deactivate the officer. A platform admin cannot deactivate themselves, so no button is offered for that row.
  await expect(page.getByRole("button", { name: `Deactivate ${PLATFORM}` })).toHaveCount(0);
  await page.getByRole("button", { name: `Deactivate ${OFFICER_TWO}` }).click();
  await expect(page.getByRole("status")).toContainText("Account deactivated");
  await expect(page.getByRole("listitem").filter({ hasText: OFFICER_TWO })).toContainText("Deactivated");

  // The officer's open session is dead: their next page load sends them to sign in.
  await officer.goto("/agency");
  await expect(officer).toHaveURL(/\/sign-in/);

  // Asking for a new sign-in link looks normal ("check your email") but no email is sent.
  const emailsBefore = (await readOutbox("emails.jsonl")).filter((m) => m.to === OFFICER_TWO).length;
  await officer.getByLabel("Email address").fill(OFFICER_TWO);
  await officer.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(officer.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await officer.waitForTimeout(1500); // give a (wrongly) sent email time to be written
  const emailsAfter = (await readOutbox("emails.jsonl")).filter((m) => m.to === OFFICER_TWO).length;
  expect(emailsAfter).toBe(emailsBefore);

  // Reactivate: the officer can sign in again.
  await page.getByRole("button", { name: `Reactivate ${OFFICER_TWO}` }).click();
  await expect(page.getByRole("status")).toContainText("Account reactivated");
  await signInThroughEmail(officer, OFFICER_TWO, "/agency");
  await expect(officer.getByRole("heading", { name: "Your agency's reports" })).toBeVisible();
  await officerContext.close();
});
