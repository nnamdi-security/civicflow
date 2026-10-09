import { expect, test } from "@playwright/test";
import { Pool } from "pg";
import { createDb } from "../../src/db/client";
import { systemClock } from "../../src/domain/clock";
import { DevOutboxEmailSender } from "../../src/server/adapters/email/dev-outbox-email-sender";
import { DevOutboxSmsSender } from "../../src/server/adapters/sms/dev-outbox-sms-sender";
import { runDispatch } from "../../src/server/notifications/dispatch";
import { latestSms, readOutbox, signInThroughEmail, stamp, stubMapTiles, submitPothole, resetRateLimits } from "./helpers";

const AGENCY_NAME = "E2E Notify Agency";
const OFFICER = `e2e-${stamp}-notify-officer@example.com`;
const RESIDENT = `e2e-${stamp}-notify-resident@example.com`;
const PHONE_INPUT = "0803 123 4567";
const PHONE_E164 = "+2348031234567";
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
  await pool.query("delete from users where email like 'e2e-%-notify-officer@example.com'");
  await pool.query("delete from agencies where name = $1", [AGENCY_NAME]);
  await pool.query("delete from jurisdictions where name = 'E2E Notify Nigeria'");
}

test.beforeAll(async () => {
  await resetRateLimits(); // fresh sign-in counters for this spec (see helpers.ts)
  pool = new Pool({ connectionString: databaseUrl() });
  await clear();
  const state = await pool.query<{ id: string }>(
    "insert into jurisdictions (name, level, geom) values ('E2E Notify Nigeria', 'state', ST_Multi(ST_GeomFromText($1, 4326))) returning id",
    [COVERAGE],
  );
  const agency = await pool.query<{ id: string }>("insert into agencies (name, type) values ($1, 'roads') returning id", [AGENCY_NAME]);
  const stateId = state.rows[0]?.id;
  const agencyId = agency.rows[0]?.id;
  if (!stateId || !agencyId) throw new Error("fixtures not created");
  await pool.query("insert into agency_jurisdictions (agency_id, jurisdiction_id) values ($1, $2)", [agencyId, stateId]);
  await pool.query("insert into users (email, role, agency_id) values ($1, 'agency_officer', $2)", [OFFICER, agencyId]);
});

test.afterAll(async () => {
  await clear();
  await pool.end();
});

/** Runs the real dispatcher against the dev outbox, as the worker would each minute. */
async function dispatch() {
  const { db, pool: dispatchPool } = createDb(databaseUrl());
  try {
    return await runDispatch({
      db,
      clock: systemClock,
      email: new DevOutboxEmailSender(),
      sms: new DevOutboxSmsSender(),
      baseUrl: "http://localhost:3201",
    });
  } finally {
    await dispatchPool.end();
  }
}

const emailsTo = async (to: string) => (await readOutbox("emails.jsonl")).filter((m) => m.to === to);

test("a resident confirms a phone number, then gets email and SMS updates as the report progresses", async ({ page, browser }) => {
  await stubMapTiles(page);
  await signInThroughEmail(page, RESIDENT, "/account");

  // Add and confirm a phone number with the code texted to it.
  await page.getByLabel("Add a mobile number").fill("12345");
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Error:" })).toContainText("Enter a Nigerian mobile number");

  await page.getByLabel("Add a mobile number").fill(PHONE_INPUT);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByRole("status")).toContainText("We sent a 6-digit code");
  const code = /\d{6}/.exec((await latestSms(PHONE_E164)).text)?.[0];
  expect(code).toBeTruthy();

  await page.getByLabel(/^Code sent to \+234\*+67/).fill("000000" === code ? "111111" : "000000");
  await page.getByRole("button", { name: "Confirm number" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Error:" })).toContainText("That code is not right");

  await page.getByLabel(/^Code sent to/).fill(code ?? "");
  await page.getByRole("button", { name: "Confirm number" }).click();
  await expect(page.getByRole("status")).toContainText("Phone number confirmed");
  await expect(page.getByText("Confirmed: +234********67")).toBeVisible();
  // The full number is never shown back.
  await expect(page.getByText("8031234567")).toHaveCount(0);

  // SMS is off until the resident turns it on.
  const smsBox = page.getByLabel(/^Text me when a report is resolved/);
  await expect(smsBox).not.toBeChecked();
  await smsBox.check();
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByRole("status")).toContainText("Notification settings saved");
  await expect(page.getByLabel(/^Text me when a report is resolved/)).toBeChecked();

  // File a report: routing queues two emails.
  await page.goto("/report/new");
  const reportUrl = await submitPothole(page);
  const reportId = reportUrl.split("/").pop() ?? "";
  expect(await dispatch()).toMatchObject({ sent: 2, failed: 0 });
  let mine = await emailsTo(RESIDENT);
  expect(mine.map((m) => m.subject).filter((s) => /received|sent to/.test(s ?? ""))).toEqual([
    expect.stringMatching(/^We received your report CF-/),
    expect.stringMatching(/^Your report CF-.* was sent to E2E Notify Agency$/),
  ]);
  expect(mine.at(-1)?.text).toContain(`/reports/${reportId}`);
  // Messages never carry the description or the location.
  for (const message of mine.filter((m) => m.subject?.includes("CF-"))) {
    expect(message.text).not.toContain("deep pothole");
    expect(message.text).not.toMatch(/\d+\.\d{4,}/);
  }

  // The officer acknowledges, starts work and resolves.
  const staffContext = await browser.newContext();
  const staff = await staffContext.newPage();
  await signInThroughEmail(staff, OFFICER, `/agency/reports/${reportId}`);
  for (const [button, status] of [
    ["Acknowledge", "Status: Acknowledged"],
    ["Start work", "Status: In progress"],
    ["Mark resolved", "Status: Resolved"],
  ] as const) {
    await staff.getByRole("button", { name: button }).click();
    await expect(staff.getByRole("status")).toHaveText("Status updated.");
    await expect(staff.getByText(status).first()).toBeVisible();
  }
  await staffContext.close();

  // Acknowledged (email), resolved (email + SMS); in progress says nothing.
  expect(await dispatch()).toMatchObject({ sent: 3, failed: 0, skipped: 0 });
  mine = await emailsTo(RESIDENT);
  const subjects = mine.map((m) => m.subject ?? "");
  expect(subjects.some((s) => /has acknowledged your report/.test(s))).toBe(true);
  expect(subjects.some((s) => /was marked resolved/.test(s))).toBe(true);
  expect(subjects.some((s) => /in progress/i.test(s))).toBe(false);
  const sms = await latestSms(PHONE_E164);
  expect(sms.text).toMatch(/^CivicFlow: report CF-[A-Z0-9]{8} is marked resolved/);
  expect(sms.text).toContain(`/reports/${reportId}`);

  // Running the dispatcher again sends nothing more.
  expect(await dispatch()).toEqual({ sent: 0, retrying: 0, failed: 0, skipped: 0 });

  // Switching email off stops later report emails, and removing the number stops SMS.
  await page.goto("/account");
  await page.getByLabel("Email me updates about my reports").uncheck();
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByRole("status")).toContainText("Notification settings saved");
  await page.getByRole("button", { name: "Remove number" }).click();
  await expect(page.getByRole("status")).toContainText("Phone number removed");
  await expect(page.getByText("Confirmed:")).toHaveCount(0);
});
