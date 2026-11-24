import { expect, test, type Page } from "@playwright/test";
import { useFakeBackend } from "./fake-backend";
import {
  openDashboard,
  runStatus,
  submitRequest,
  waitForCompletion,
} from "./helpers";

// Documentation screenshots, not assertions. Run with:
//   E2E_SCREENSHOTS=1 npx playwright test e2e/screenshots.spec.ts
// Only "completada" creates a real run; failure states use the fake backend.
test.skip(!process.env.E2E_SCREENSHOTS, "Set E2E_SCREENSHOTS=1 to refresh docs/screenshots/fase4.");

const dir = "docs/screenshots/fase4";

async function shot(page: Page, name: string) {
  // Let entry transitions settle so the capture is stable.
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

test.use({ viewport: { width: 1280, height: 900 } });

test("validación (backend simulado)", async ({ page }) => {
  await useFakeBackend(page, "quota");
  await openDashboard(page);
  await submitRequest(page, "Haz algo");
  await expect(page.locator("#request-error")).toBeVisible();
  await shot(page, "validacion-claro");
});

test("flujo en curso y completado", async ({ page }) => {
  await openDashboard(page);
  const request = "Crea un README para la demo del equipo de agentes";
  await submitRequest(page, request);
  await expect(page.locator('li.station[data-agent="develop"]')).toHaveAttribute(
    "data-state",
    "active",
    { timeout: 30_000 },
  );
  await shot(page, "en-curso-claro");
  await waitForCompletion(page, request);
  await shot(page, "completada-claro");
});

test("cuota agotada: reintento y fallo (backend simulado)", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await useFakeBackend(page, "quota");
  await openDashboard(page);
  await submitRequest(page, "Crea un README para la demo del equipo");
  await expect(
    page.locator(".notice", { hasText: "Reintento automático en marcha" }),
  ).toBeVisible({ timeout: 20_000 });
  await shot(page, "reintento-oscuro");
  await expect(runStatus(page)).toHaveText("Fallida", { timeout: 30_000 });
  await shot(page, "cuota-agotada-oscuro");
});

test("límite diario en móvil (backend simulado)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await useFakeBackend(page, "rate_limited_day");
  await openDashboard(page);
  await submitRequest(page, "Crea un README para la tercera demo");
  await expect(page.locator('.notice[data-tone="danger"]')).toBeVisible();
  await page.screenshot({ path: `${dir}/limite-diario-movil.png` });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
});
