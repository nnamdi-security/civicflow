/**
 * Automated accessibility checks (Phase 8 Part B).
 *
 * "Accessibility" means people with disabilities (blind users with screen readers, people who
 * cannot use a mouse, people with low vision) can use the site. This spec opens every kind of
 * page in a real browser and runs axe-core, an industry-standard checker, which finds problems
 * such as: form fields with no label, images with no description, buttons with no name, text with
 * too little colour contrast, missing page headings, and broken page structure.
 *
 * Automated checks catch roughly a third of real accessibility problems, so passing here is a
 * floor, not proof of full accessibility: a person should still try the site with a keyboard and a
 * screen reader before launch (the launch checklist says so).
 *
 * The pages are checked in the states people actually see (a resolved report asking for
 * confirmation, an overdue report, a full staff list), so this spec first builds realistic data.
 * One exclusion: the interactive map itself (the third-party Leaflet widget) is not checked;
 * the report form offers typed coordinates and "use my location" as accessible alternatives.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { Pool } from "pg";
import { createDb } from "../../src/db/client";
import { systemClock } from "../../src/domain/clock";
import { runSlaScan } from "../../src/server/sla/scan";
import { resetRateLimits, signInThroughEmail, stamp, stubMapTiles, submitPothole } from "./helpers";

const PLATFORM = `e2e-${stamp}-a11y-platform@example.com`;
const AGENCY_ADMIN = `e2e-${stamp}-a11y-agencyadmin@example.com`;
const OFFICER = `e2e-${stamp}-a11y-officer@example.com`;
const RESIDENT = `e2e-${stamp}-a11y-resident@example.com`;
const RESIDENT_LATE = `e2e-${stamp}-a11y-late@example.com`;
const AGENCY = "E2E A11y Agency";
const AREA = "E2E A11y Area";
const COVERAGE = "POLYGON((2 4, 15 4, 15 14.5, 2 14.5, 2 4))";

let pool: Pool;

function databaseUrl() {
  const url = process.env.E2E_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("Set TEST_DATABASE_URL (or E2E_DATABASE_URL) to run the end-to-end tests.");
  return url;
}

async function clear() {
  await pool.query(
    "truncate table audit_log, sla_outcomes, notifications, escalations, assignments, status_events, report_media, reports",
  );
  await pool.query("delete from users where email like 'e2e-%-a11y-%@example.com'");
  await pool.query("delete from agencies where name = $1", [AGENCY]);
  await pool.query("delete from jurisdictions where name = $1", [AREA]);
}

test.beforeAll(async () => {
  await resetRateLimits();
  pool = new Pool({ connectionString: databaseUrl() });
  await clear();
  const area = await pool.query<{ id: string }>(
    "insert into jurisdictions (name, level, geom) values ($1, 'state', ST_Multi(ST_GeomFromText($2, 4326))) returning id",
    [AREA, COVERAGE],
  );
  const agency = await pool.query<{ id: string }>("insert into agencies (name, type) values ($1, 'roads') returning id", [AGENCY]);
  const agencyId = agency.rows[0]?.id;
  await pool.query("insert into agency_jurisdictions (agency_id, jurisdiction_id, priority) values ($1, $2, 0)", [agencyId, area.rows[0]?.id]);
  await pool.query(
    "insert into users (email, role, agency_id) values ($1, 'platform_admin', null), ($2, 'agency_admin', $4), ($3, 'agency_officer', $4)",
    [PLATFORM, AGENCY_ADMIN, OFFICER, agencyId],
  );
});

test.afterAll(async () => {
  await clear();
  await pool.end();
});

/**
 * Runs axe on the current page and fails with a readable list of problems.
 * Tags select which rules apply: WCAG 2.0 and 2.1, levels A and AA, the usual legal/industry target.
 */
async function expectAccessible(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .exclude(".leaflet-container") // the third-party map widget; alternatives are offered on the page
    .analyze();
  const problems = results.violations.map(
    (v) => `${v.id} [${v.impact}] ${v.help}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
  );
  expect(problems, `accessibility problems on ${label}`).toEqual([]);
}

test("public pages are accessible", async ({ page }) => {
  for (const [path, label] of [
    ["/", "home page"],
    ["/track", "track a report"],
    ["/track?error=invalid", "track a report (with an error message)"],
    ["/sign-in", "sign in"],
    ["/privacy", "privacy notice"],
    ["/terms", "terms of use"],
    ["/this-page-does-not-exist", "page not found"],
  ] as const) {
    await page.goto(path);
    await expectAccessible(page, label);
  }
});

test("every page for residents, staff and admins is accessible, in the states people really see", async ({ browser }) => {
  // ---- A resident files a report, and an officer resolves it. -----------------------------
  const residentContext = await browser.newContext();
  const resident = await residentContext.newPage();
  await stubMapTiles(resident);
  await signInThroughEmail(resident, RESIDENT, "/report/new");
  await expectAccessible(resident, "report form");
  const reportUrl = await submitPothole(resident);
  const reportId = reportUrl.split("/").pop() ?? "";
  const reference = (await resident.getByRole("heading", { name: /^Report CF-/ }).textContent())?.replace("Report ", "").trim() ?? "";

  const officerContext = await browser.newContext();
  const officer = await officerContext.newPage();
  await signInThroughEmail(officer, OFFICER, `/agency/reports/${reportId}`);
  await expectAccessible(officer, "staff report page (routed)");
  for (const button of ["Acknowledge", "Start work", "Mark resolved"]) {
    await officer.getByRole("button", { name: button }).click();
    await expect(officer.getByRole("status")).toHaveText("Status updated.");
  }
  await expectAccessible(officer, "staff report page (resolved)");
  await officer.goto("/agency");
  await expectAccessible(officer, "staff inbox");

  // ---- The resident's pages, including the "has this been fixed?" form. ---------------------
  await resident.goto(reportUrl);
  await expect(resident.getByRole("heading", { name: "Has this been fixed?" })).toBeVisible();
  await expectAccessible(resident, "resident report page (resolved, asking for confirmation)");
  await resident.getByRole("button", { name: "No, it is not fixed" }).click(); // shows the error notice
  await expectAccessible(resident, "resident report page (with an error message)");
  await resident.goto("/reports");
  await expectAccessible(resident, "my reports");
  await resident.goto("/account");
  await expectAccessible(resident, "account and notification settings");
  await resident.goto(`/track/${reference}`);
  await expectAccessible(resident, "public tracking page");
  await residentContext.close();

  // ---- A second report that becomes publicly overdue, for the board and overdue notices. ------
  const lateContext = await browser.newContext();
  const late = await lateContext.newPage();
  await stubMapTiles(late);
  await signInThroughEmail(late, RESIDENT_LATE, "/report/new");
  const lateUrl = await submitPothole(late);
  const lateId = lateUrl.split("/").pop() ?? "";
  await pool.query("update reports set ack_due_at = now() - interval '80 hours' where id = $1", [lateId]);
  const { db, pool: scanPool } = createDb(databaseUrl());
  try {
    await runSlaScan(db, systemClock);
  } finally {
    await scanPool.end();
  }
  await late.goto(lateUrl);
  await expectAccessible(late, "resident report page (overdue notice)");
  await late.goto("/overdue");
  await expectAccessible(late, "public overdue board");
  await officer.goto(`/agency/reports/${lateId}`);
  await expectAccessible(officer, "staff report page (overdue notice)");
  await lateContext.close();
  await officerContext.close();

  // ---- The agency admin's pages. -------------------------------------------------------------
  const adminContext = await browser.newContext();
  const agencyAdmin = await adminContext.newPage();
  await signInThroughEmail(agencyAdmin, AGENCY_ADMIN, "/agency/performance");
  await expectAccessible(agencyAdmin, "performance dashboard (agency admin)");
  await agencyAdmin.goto("/agency/staff");
  await expectAccessible(agencyAdmin, "staff management (agency admin)");
  await adminContext.close();

  // ---- The platform admin's pages. -----------------------------------------------------------
  const platformContext = await browser.newContext();
  const platform = await platformContext.newPage();
  await signInThroughEmail(platform, PLATFORM, "/admin");
  const agencyRow = await pool.query<{ id: string }>("select id from agencies where name = $1", [AGENCY]);
  for (const [path, label] of [
    ["/admin", "admin home"],
    ["/admin/agencies", "agencies list"],
    [`/admin/agencies/${agencyRow.rows[0]?.id}`, "agency details and coverage"],
    ["/admin/sla", "SLA deadlines"],
    ["/admin/categories", "report categories"],
    ["/admin/audit", "audit log"],
    ["/admin/health", "system health"],
    ["/admin/triage", "triage queue"],
    ["/agency/performance", "performance dashboard (platform admin)"],
    ["/agency/staff", "staff management (platform admin)"],
  ] as const) {
    await platform.goto(path);
    await expectAccessible(platform, label);
  }
  await platformContext.close();
});
