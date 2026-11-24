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

export async function waitForCompletion(page: Page) {
  await expect(runStatus(page)).toHaveText("Completada", { timeout: 60_000 });
  // The submit button returns once the browser stops driving steps.
  await expect(page.getByRole("button", { name: "Iniciar equipo" })).toBeVisible();
}
