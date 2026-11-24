import { expect, type Page } from "@playwright/test";

export async function openDashboard(page: Page) {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "¿Qué tiene que construir el equipo?" }),
  ).toBeVisible({ timeout: 30_000 });
}

export function requestInput(page: Page) {
  return page.getByLabel("Describe la tarea para el equipo");
}

export function station(page: Page, agent: "orchestrator" | "develop" | "testing") {
  return page.locator(`li.station[data-agent="${agent}"]`);
}

export function runStatus(page: Page) {
  return page.locator(".run-status");
}

export async function submitRequest(page: Page, text: string) {
  await requestInput(page).fill(text);
  await page.getByRole("button", { name: "Iniciar equipo" }).click();
}

/**
 * Waits until the run created for `request` completes. Tests share one
 * session, so the page may open on an earlier, already completed run: the
 * title check makes sure the status belongs to the new run.
 */
export async function waitForCompletion(page: Page, request: string) {
  await expect(page.getByRole("heading", { level: 2, name: request })).toBeVisible({
    timeout: 20_000,
  });
  await expect(runStatus(page)).toHaveText("Completada", { timeout: 60_000 });
  // The submit button returns once the browser stops driving steps.
  await expect(page.getByRole("button", { name: "Iniciar equipo" })).toBeVisible();
}
