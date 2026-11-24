import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3200);
const baseURL = `http://127.0.0.1:${PORT}`;

/**
 * End-to-end tests run against a production build with the deterministic
 * mock provider (AI_PROVIDER=mock), so they never spend model quota. They do
 * use the Supabase project configured in .env.local: each test signs in as a
 * fresh anonymous user and creates a few runs there.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  forbidOnly: Boolean(process.env.CI),
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  outputDir: "test-results",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "es-ES",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: process.env.E2E_SKIP_BUILD
      ? `npx next start --port ${PORT}`
      : `npm run build && npx next start --port ${PORT}`,
    url: baseURL,
    timeout: 300_000,
    // Never reuse a server: one started without AI_PROVIDER=mock would call
    // the real providers and spend quota.
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      AI_PROVIDER: "mock",
      AI_MOCK_LATENCY_MS: "900",
      // Low enough for the rate-limit test to reach it with three runs.
      RATE_LIMIT_RUNS_PER_USER_DAY: "2",
    },
  },
});
