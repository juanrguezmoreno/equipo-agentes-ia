import { expect, test } from "@playwright/test";
import {
  openDashboard,
  runStatus,
  station,
  submitRequest,
  waitForCompletion,
} from "./helpers";

test.describe("flujo principal", () => {
  test("crear petición → ver agentes trabajando → tarea completada", async ({
    page,
  }, testInfo) => {
    await openDashboard(page);

    const request = "Crea un README para la demo del equipo de agentes";
    await submitRequest(page, request);

    // The run becomes the page title and the Orchestrator starts planning.
    await expect(page.getByRole("heading", { level: 2, name: request })).toBeVisible();
    await expect(page.getByRole("button", { name: "Trabajando…" })).toBeVisible();
    await expect(station(page, "orchestrator")).toHaveAttribute("data-state", "active");

    // Develop and Testing each take a turn while the plan's tasks advance.
    await expect(station(page, "develop")).toHaveAttribute("data-state", "active", {
      timeout: 30_000,
    });
    await expect(station(page, "testing")).toHaveAttribute("data-state", "active", {
      timeout: 30_000,
    });

    await waitForCompletion(page);
    await testInfo.attach("ejecucion-completada", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });

    // Both planned tasks reached the last stop and every agent is done.
    const tasks = page.getByRole("list", { name: "Tareas" }).locator(":scope > li");
    await expect(tasks).toHaveCount(2);
    for (const agent of ["orchestrator", "develop", "testing"] as const) {
      await expect(station(page, agent)).toHaveAttribute("data-state", "done");
    }
    await expect(page.getByText("2 de 2", { exact: true })).toBeVisible();

    // The provider is visible and it is the mock, not a real model.
    await expect(station(page, "orchestrator").locator(".station-provider")).toHaveText(
      "Simulado",
    );
    await expect(page.getByRole("log")).toContainText("Simulado (mock-agents) respondió");

    // The generated files can be opened in the code viewer.
    const fileSelect = page.getByLabel("Archivo y revisión");
    await fileSelect.selectOption({ label: "README.md, revisión 1 (actual), T1" });
    await expect(page.getByRole("region", { name: "Contenido de README.md" })).toContainText(
      "## Resumen",
    );

    // No failure notice is shown for a completed run.
    await expect(page.locator('.notice[data-tone="danger"]')).toHaveCount(0);
  });

  test("Testing rechaza una iteración y Develop la corrige", async ({ page }) => {
    await openDashboard(page);
    await submitRequest(page, "Crea un README para la demo [simular:iteracion]");
    await waitForCompletion(page);

    await expect(runStatus(page)).toHaveText("Completada");
    await expect(page.getByLabel("Archivo y revisión")).toContainText(
      "README.md, revisión 2 (actual)",
    );
  });
});
