import { expect, test } from "@playwright/test";
import {
  openDashboard,
  runStatus,
  station,
  submitRequest,
  waitForCompletion,
} from "./helpers";

// These tests prove the real pipeline: browser → API routes → Postgres RPCs →
// Realtime, with only the model replaced by AI_PROVIDER=mock. Each creates one
// run in Supabase, so keep this file small (see playwright.config.ts).

test.describe("flujo principal", () => {
  test("crear petición → ver agentes trabajando → tarea completada", async ({
    page,
  }, testInfo) => {
    // Records, for every log row inserted, whether it entered with motion.
    await page.addInitScript(() => {
      const w = window as unknown as { __logEntries: boolean[] };
      w.__logEntries = [];
      new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (!(node instanceof HTMLElement)) {
              continue;
            }
            // A whole list can be inserted at once; count its rows too.
            const rows = node.matches("li.log-item")
              ? [node]
              : [...node.querySelectorAll<HTMLElement>("li.log-item")];
            for (const row of rows) {
              w.__logEntries.push(row.closest<HTMLElement>(".log")?.dataset.live === "true");
            }
          }
        }
      }).observe(document, { childList: true, subtree: true });
    });
    const logEntries = () =>
      page.evaluate(() => (window as unknown as { __logEntries: boolean[] }).__logEntries);

    await openDashboard(page);
    // The shared session may open on an earlier run; only new rows count.
    await page.waitForTimeout(500);
    const entriesBefore = (await logEntries()).length;

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

    await waitForCompletion(page, request);
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

    // Regression (real run): a long artifact path in the file picker made a
    // 390 px phone scroll sideways by 7 px.
    await page.setViewportSize({ width: 390, height: 844 });
    await fileSelect.evaluate((select: HTMLSelectElement) => {
      const option = document.createElement("option");
      option.textContent =
        "app/contacto/_components/formulario-de-contacto.tsx, revisión 3 (actual), T2";
      select.append(option);
    });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
    await page.setViewportSize({ width: 1280, height: 720 });

    // Motion: events that arrived live slid in...
    const liveEntries = (await logEntries()).slice(entriesBefore);
    expect(liveEntries.filter(Boolean).length).toBeGreaterThan(0);

    // ...but reloading shows the same history without animating every row.
    await page.reload();
    await expect(page.getByRole("heading", { level: 2, name: request })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator("li.log-item").first()).toBeVisible();
    await page.waitForTimeout(500);
    const afterReload = await logEntries();
    expect(afterReload.length).toBeGreaterThan(5);
    expect(afterReload.filter(Boolean)).toEqual([]);
  });

  // Real pipeline (API → RPC → delivery gate) with the mock model: Develop
  // writes outside its task, then resends the same README, then fixes it.
  test("alcance de Develop y reenvíos idénticos", async ({ page }) => {
    await openDashboard(page);
    const request = "Crea un README para la demo [simular:alcance-y-reenvio]";
    await submitRequest(page, request);
    await waitForCompletion(page, request);

    const log = page.getByRole("log");
    // Iteration 1: the extra file was never stored and Testing reported it.
    await expect(log).toContainText("Escritura fuera de alcance");
    await expect(log).toContainText("src/fuera-de-alcance.ts. No se guardó.");
    await expect(page.getByLabel("Archivo y revisión")).not.toContainText("fuera-de-alcance");
    // Iteration 2: the unchanged README was returned without being tested.
    await expect(log).toContainText(
      "Develop reenvió los mismos archivos tras el rechazo; no se enviaron a Testing.",
    );
    // Iteration 3: fixed and approved; the resend counted as an iteration.
    const readmeLane = page.getByRole("list", { name: "Tareas" }).locator(":scope > li").first();
    await expect(readmeLane.locator(".lane-iteration")).toHaveText("Iteración 3 de 3");
    await readmeLane.locator("summary").first().click();
    await readmeLane.getByText("Iteración 2", { exact: true }).click();
    await expect(readmeLane).toContainText("sin-cambios:README.md");
    await expect(readmeLane).toContainText("alcance:src/fuera-de-alcance.ts");
  });

  test("Testing rechaza una iteración y Develop la corrige", async ({ page }) => {
    await openDashboard(page);
    const request = "Crea un README para la demo [simular:iteracion]";
    await submitRequest(page, request);
    await waitForCompletion(page, request);

    await expect(runStatus(page)).toHaveText("Completada");
    await expect(page.getByLabel("Archivo y revisión")).toContainText(
      "README.md, revisión 2 (actual)",
    );
  });
});
