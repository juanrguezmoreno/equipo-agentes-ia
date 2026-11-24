import { expect, test } from "@playwright/test";
import {
  openDashboard,
  requestInput,
  runStatus,
  station,
  submitRequest,
  waitForCompletion,
} from "./helpers";

test.describe("validación de la petición", () => {
  test("rechaza en el navegador sin llamar a la API", async ({ page }) => {
    const runPosts: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname === "/api/runs") {
        runPosts.push(request.url());
      }
    });
    await openDashboard(page);

    await submitRequest(page, "Haz algo");
    const error = page.locator("#request-error");
    await expect(error).toContainText("mínimo 10 caracteres");
    await expect(requestInput(page)).toHaveAttribute("aria-invalid", "true");

    // Typing clears the message.
    await requestInput(page).press("End");
    await requestInput(page).pressSequentially(" bonito");
    await expect(error).toHaveCount(0);

    await submitRequest(
      page,
      `Usa la clave AIza${"x".repeat(35)} para crear un cliente de la API`,
    );
    await expect(error).toContainText("clave o credencial");

    await submitRequest(page, "x".repeat(2_001));
    await expect(error).toContainText("supera los 2000 caracteres");
    await expect(page.locator('.field-hint [data-over="true"]')).toBeVisible();

    expect(runPosts).toEqual([]);
  });

  test("el servidor valida aunque se salte el formulario", async ({ page }) => {
    await openDashboard(page);
    const result = await page.evaluate(async () => {
      const short = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request: "aaaaaaaaaaaa" }),
      });
      const huge = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request: "a".repeat(20_000) }),
      });
      const notJson = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "hola",
      });
      return {
        short: { status: short.status, body: await short.json() },
        huge: huge.status,
        notJson: notJson.status,
      };
    });
    expect(result.short.status).toBe(400);
    expect(result.short.body).toMatchObject({ code: "invalid_request" });
    expect(result.short.body.detail).toContain("no parece una descripción");
    expect(result.huge).toBe(413);
    expect(result.notJson).toBe(415);
  });
});

test.describe("errores del proveedor", () => {
  test("cuota agotada: reintenta y después explica qué hacer", async ({ page }) => {
    await openDashboard(page);
    await submitRequest(page, "Crea un README para la demo [simular:cuota]");

    // While the backoff runs, the user sees why and when it retries.
    const retryNotice = page.locator(".notice", { hasText: "Reintento automático en marcha" });
    await expect(retryNotice).toBeVisible({ timeout: 20_000 });
    await expect(retryNotice).toContainText("límite de uso (HTTP 429)");

    // After the last attempt the run fails with an actionable explanation.
    await expect(runStatus(page)).toHaveText("Fallida", { timeout: 60_000 });
    const failure = page.locator('.notice[data-tone="danger"]');
    await expect(failure).toContainText("Cuota del proveedor agotada");
    await expect(failure).toContainText("el Orquestador");
    await expect(failure.getByRole("button", { name: "Volver a lanzar la petición" })).toBeVisible();
    await expect(station(page, "orchestrator")).toHaveAttribute("data-state", "error");
    await expect(page.getByText("La ejecución se detuvo antes de que el Orquestador")).toBeVisible();
  });

  test("respuesta mal formada: falla sin reintentar y propone reformular", async ({ page }) => {
    await openDashboard(page);
    await submitRequest(page, "Crea un README para la demo [simular:formato]");

    await expect(runStatus(page)).toHaveText("Fallida", { timeout: 30_000 });
    const failure = page.locator('.notice[data-tone="danger"]');
    await expect(failure).toContainText("respuesta mal formada");
    await failure.getByRole("button", { name: "Editar la petición" }).click();
    await expect(requestInput(page)).toBeFocused();
    await expect(requestInput(page)).toHaveValue(
      "Crea un README para la demo [simular:formato]",
    );
  });
});

test.describe("rate limiting", () => {
  test("bloquea la tercera ejecución del día y dice cuándo volver", async ({ page }) => {
    // The e2e server sets RATE_LIMIT_RUNS_PER_USER_DAY=2 for this test.
    await openDashboard(page);
    await submitRequest(page, "Crea un README para la primera demo");
    await waitForCompletion(page);
    await submitRequest(page, "Crea un README para la segunda demo");
    await waitForCompletion(page);

    await submitRequest(page, "Crea un README para la tercera demo");
    const notice = page.locator('.notice[data-tone="danger"]');
    await expect(notice).toContainText("Has alcanzado el límite diario");
    await expect(notice).toContainText(/Podrás volver a intentarlo en \d+ h/);
    // The text stays in the box so nothing is lost.
    await expect(requestInput(page)).toHaveValue("Crea un README para la tercera demo");

    await notice.getByRole("button", { name: /Cerrar aviso/ }).click();
    await expect(notice).toHaveCount(0);
  });
});
