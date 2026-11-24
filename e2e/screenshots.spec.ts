import { expect, test, type Page } from "@playwright/test";
import {
  openDashboard,
  runStatus,
  submitRequest,
  waitForCompletion,
} from "./helpers";

// Documentation screenshots, not assertions. Run with:
//   E2E_SCREENSHOTS=1 npx playwright test e2e/screenshots.spec.ts
test.skip(!process.env.E2E_SCREENSHOTS, "Set E2E_SCREENSHOTS=1 to refresh docs/screenshots/fase4.");

const dir = "docs/screenshots/fase4";

async function shot(page: Page, name: string) {
  // Let entry transitions settle so the capture is stable.
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

test.use({ viewport: { width: 1280, height: 900 } });

test("flujo completado y validación", async ({ page }) => {
  await openDashboard(page);
  await submitRequest(page, "Haz algo");
  await expect(page.locator("#request-error")).toBeVisible();
  await shot(page, "validacion-claro");

  await submitRequest(page, "Crea un README para la demo del equipo de agentes");
  await expect(page.locator('li.station[data-agent="develop"]')).toHaveAttribute(
    "data-state",
    "active",
    { timeout: 30_000 },
  );
  await shot(page, "en-curso-claro");
  await waitForCompletion(page);
  await shot(page, "completada-claro");
});

test("cuota agotada: reintento y fallo", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await openDashboard(page);
  await submitRequest(page, "Crea un README para la demo [simular:cuota]");
  await expect(
    page.locator(".notice", { hasText: "Reintento automático en marcha" }),
  ).toBeVisible({ timeout: 20_000 });
  await shot(page, "reintento-oscuro");
  await expect(runStatus(page)).toHaveText("Fallida", { timeout: 60_000 });
  await shot(page, "cuota-agotada-oscuro");
});

test("límite diario en móvil", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDashboard(page);
  await submitRequest(page, "Crea un README para la primera demo");
  await waitForCompletion(page);
  await submitRequest(page, "Crea un README para la segunda demo");
  await waitForCompletion(page);
  await submitRequest(page, "Crea un README para la tercera demo");
  await expect(page.locator('.notice[data-tone="danger"]')).toBeVisible();
  await page.screenshot({ path: `${dir}/limite-diario-movil.png` });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
});
