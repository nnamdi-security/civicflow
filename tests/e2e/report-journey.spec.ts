import { expect, test } from "@playwright/test";
import { PHOTO, signInThroughEmail, stamp, stubMapTiles, sentLink } from "./helpers";

test("a signed-out visitor is sent to sign in and returns to the report form", async ({ page }) => {
  await stubMapTiles(page);
  await page.goto("/report/new");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Freport%2Fnew/);

  await page.getByLabel("Email address").fill(`e2e-${stamp}-return@example.com`);
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();

  await page.goto(await sentLink(`e2e-${stamp}-return@example.com`));
  await expect(page).toHaveURL(/\/report\/new$/);
  await expect(page.getByRole("heading", { name: "Report an issue" })).toBeVisible();
});

test("a resident reports an issue end to end, and nobody else can open it", async ({ page, browser }) => {
  await stubMapTiles(page);
  const resident = `e2e-${stamp}-resident@example.com`;
  await signInThroughEmail(page, resident, "/report/new");
  await expect(page.getByRole("heading", { name: "Report an issue" })).toBeVisible();

  // An empty form explains every problem and sends nothing.
  await page.getByRole("button", { name: "Send report" }).click();
  await expect(page.getByText("Error: Choose a category.")).toBeVisible();
  await expect(page.getByText("Error: Place the pin on the map.")).toBeVisible();
  await expect(page.getByText(/Error: Describe the problem in at least/)).toBeVisible();
  await expect(page.getByText("Error: Add at least one photo of the problem.")).toBeVisible();
  await expect(page).toHaveURL(/\/report\/new$/);

  // Fill it in: category, a pin on the map, a description, a photo.
  await page.getByLabel("What is the problem?").selectOption({ label: "Roads and potholes" });
  await page.locator(".leaflet-container").click();
  await expect(page.getByText(/Pin placed at/)).toBeVisible();
  await page.getByLabel("Describe the problem").fill("A deep pothole at the junction near the market,\nit floods when it rains.");
  await page.getByLabel("Add a photo").setInputFiles(PHOTO);
  await expect(page.getByText("Uploaded", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Send report" }).click();
  await page.waitForURL(/\/reports\/[0-9a-f-]{36}$/);
  const reportUrl = page.url();

  // The report page shows what was sent.
  await expect(page.getByRole("heading", { name: /^Report CF-[A-Z0-9]{8}$/ })).toBeVisible();
  // With no agency covering the pin the report waits in triage; the status also appears in the history.
  await expect(page.getByText("Status: Submitted").first()).toBeVisible();
  await expect(page.getByText("Not assigned to an agency yet")).toBeVisible();
  await expect(page.getByText("Roads and potholes", { exact: true })).toBeVisible();
  await expect(page.getByText(/A deep pothole at the junction/)).toBeVisible();
  const photo = page.getByRole("img", { name: "Photo 1 of the reported problem" });
  await expect(photo).toBeVisible();
  await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

  // It is listed under "My reports".
  await page.goto("/reports");
  await expect(page.getByRole("link", { name: /^CF-[A-Z0-9]{8}: Roads and potholes$/ })).toBeVisible();

  // A different resident gets a 404, not the report and not a hint that it exists.
  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  await signInThroughEmail(other, `e2e-${stamp}-other@example.com`, "/reports");
  const response = await other.goto(reportUrl);
  expect(response?.status()).toBe(404);
  await expect(other.getByText(/pothole/i)).toHaveCount(0);
  await other.goto("/reports");
  await expect(other.getByText("You have not reported anything yet.")).toBeVisible();
  await otherContext.close();
});
