import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, type Page } from "@playwright/test";

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
