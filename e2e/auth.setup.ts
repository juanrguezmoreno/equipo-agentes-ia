import { expect, test as setup } from "@playwright/test";
import { AUTH_FILE } from "./paths";

/**
 * Opens ONE anonymous Supabase session per suite run and saves it, so every
 * test reuses it instead of signing in again. Supabase rate-limits anonymous
 * sign-ins per IP; one sign-in per test exhausted it after a few runs.
 *
 * A new session per suite run (rather than one stored forever) keeps the
 * per-owner run limits of the app (5 runs per hour in Postgres) from carrying
 * over between suite runs.
 */
setup("abrir una sesión anónima compartida", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "¿Qué tiene que construir el equipo?" }),
  ).toBeVisible({ timeout: 30_000 });
  await page.context().storageState({ path: AUTH_FILE });
});
