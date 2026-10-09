import { defineConfig, devices } from "@playwright/test";

const PORT = 3201;
// E2E runs against the test database so development data is never touched.
const databaseUrl = process.env.E2E_DATABASE_URL ?? process.env.TEST_DATABASE_URL ?? "";

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Pixel 7"] } }],
  webServer: {
    // `next dev`, not `next start`: production refuses to start without Resend and Cloudinary,
    // and these tests rely on the dev outbox and dev media store.
    command: `node_modules/.bin/next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: databaseUrl,
      AUTH_SECRET: "e2e-only-secret-not-for-real-use-0123456789abcdef",
      AUTH_URL: `http://localhost:${PORT}`,
      AUTH_TRUST_HOST: "true",
      // On here so the E2E suite can see the overdue board; it is off by default (ADR 0013).
      PUBLIC_OVERDUE_BOARD: "true",
      RESEND_API_KEY: "",
      EMAIL_FROM: "",
      CLOUDINARY_CLOUD_NAME: "",
      CLOUDINARY_API_KEY: "",
      CLOUDINARY_API_SECRET: "",
    },
  },
});
