import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { Pool } from "pg";

const OUTBOX = path.join(process.cwd(), ".dev-outbox", "emails.jsonl");
export const PHOTO = path.join(process.cwd(), "tests", "e2e", "fixtures", "pothole.png");
export const stamp = Date.now();

// Tiles come from the network; stub them so the tests do not depend on OpenStreetMap.
export async function stubMapTiles(page: Page) {
  const tile = await readFile(PHOTO);
  await page.route(/tile\.openstreetmap\.org/, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: tile }),
  );
}

/** Reads the newest sign-in link written to the dev outbox for `email`. */
export async function sentLink(email: string): Promise<string> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const lines = (await readFile(OUTBOX, "utf8").catch(() => "")).split("\n").filter(Boolean);
    for (const line of lines.reverse()) {
      const message = JSON.parse(line) as { to: string; text: string };
      const link = message.to === email ? /https?:\/\/\S+\/api\/auth\/callback\/email\S*/.exec(message.text) : null;
      if (link) return link[0];
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("No sign-in email arrived in the dev outbox");
}

export async function signInThroughEmail(page: Page, email: string, next: string) {
  await page.goto(`/sign-in?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await page.goto(await sentLink(email));
}


/** Fills the report form (category, pin, description, photo), sends it, and returns the report page URL. */
export async function submitPothole(page: Page): Promise<string> {
  await page.getByLabel("What is the problem?").selectOption({ label: "Roads and potholes" });
  await page.locator(".leaflet-container").click();
  await expect(page.getByText(/Pin placed at/)).toBeVisible();
  await page.getByLabel("Describe the problem").fill("A deep pothole at the junction near the market,\nit floods when it rains.");
  await page.getByLabel("Add a photo").setInputFiles(PHOTO);
  await expect(page.getByText("Uploaded", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Send report" }).click();
  await page.waitForURL(/\/reports\/[0-9a-f-]{36}$/);
  return page.url();
}

interface OutboxLine {
  to: string;
  subject?: string;
  text: string;
}

/** Reads a dev outbox file (emails.jsonl or sms.jsonl) as parsed lines, oldest first. */
export async function readOutbox(file: "emails.jsonl" | "sms.jsonl"): Promise<OutboxLine[]> {
  const raw = await readFile(path.join(process.cwd(), ".dev-outbox", file), "utf8").catch(() => "");
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as OutboxLine);
}

/** The newest SMS sent to `to`, waiting briefly for the app to write it. */
export async function latestSms(to: string): Promise<OutboxLine> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const match = (await readOutbox("sms.jsonl")).filter((m) => m.to === to).at(-1);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("No SMS arrived in the dev outbox");
}

/**
 * Clears the sign-in rate-limit counters.
 *
 * Why this exists: the app limits sign-in requests to 20 per 15 minutes per client address, to
 * slow down abuse. In the test run EVERY simulated visitor comes from the same address, so a long
 * suite of tests would eventually hit that limit even though each test behaves normally. The
 * limit itself is not under test here, so each spec resets the counters when it starts.
 * (This only touches the test database; it never runs against real data.)
 */
export async function resetRateLimits(): Promise<void> {
  const url = process.env.E2E_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("Set TEST_DATABASE_URL (or E2E_DATABASE_URL) to run the end-to-end tests.");
  const pool = new Pool({ connectionString: url });
  try {
    await pool.query("delete from rate_limits");
  } finally {
    await pool.end();
  }
}
