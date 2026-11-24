import { defineConfig, devices } from "@playwright/test";
import { AUTH_FILE } from "./e2e/paths";

const PORT = Number(process.env.E2E_PORT ?? 3200);
const baseURL = `http://127.0.0.1:${PORT}`;

/**
 * End-to-end tests run against a production build with the deterministic
 * mock provider (AI_PROVIDER=mock), so they never spend model quota. They do
 * use the Supabase project configured in .env.local, but sparingly:
 *
 * - One anonymous sign-in per suite run (setup project + storageState).
 * - Only the tests that must prove the real pipeline (flow, iteration) create
 *   runs: two per suite, three with screenshots, under the 5-per-hour owner
 *   limit enforced in Postgres.
 * - Validation tests hit the real API but are rejected before any write.
 * - Failure and rate-limit UI tests use e2e/fake-backend.ts and never reach
 *   Supabase or the API.
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
  projects: [
    // Signs in anonymously once per suite run; see e2e/auth.setup.ts.
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: AUTH_FILE },
      dependencies: ["setup"],
    },
  ],
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
      // All tests share one user, so their steps add up within a minute. The
      // app's own per-minute step limit (not Supabase's) would pause the
      // suite for ~45 s; it is covered by lib/rate-limit unit tests instead.
      RATE_LIMIT_STEPS_PER_USER_MINUTE: "60",
    },
  },
});
