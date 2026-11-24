import { expect, test } from "@playwright/test";
import { useFakeBackend } from "./fake-backend";
import {
  openDashboard,
  requestInput,
  runStatus,
  station,
  submitRequest,
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

  // Real API with the shared session: every request is rejected before any
  // write, so it creates no runs.
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

// The UI's handling of failures is tested against a fake backend: these
// scenarios need no real runs, sessions or model calls.
test.describe("errores del proveedor (backend simulado)", () => {
  test("cuota agotada: reintenta y después explica qué hacer", async ({ page }) => {
    await useFakeBackend(page, "quota");
    await openDashboard(page);
    await submitRequest(page, "Crea un README para la demo");

    // While the backoff runs, the user sees why and when it retries.
    const retryNotice = page.locator(".notice", { hasText: "Reintento automático en marcha" });
    await expect(retryNotice).toBeVisible({ timeout: 20_000 });
    await expect(retryNotice).toContainText("límite de uso (HTTP 429)");

    // After the last attempt the run fails with an actionable explanation.
    await expect(runStatus(page)).toHaveText("Fallida", { timeout: 30_000 });
    const failure = page.locator('.notice[data-tone="danger"]');
    await expect(failure).toContainText("Cuota del proveedor agotada");
    await expect(failure).toContainText("del Orquestador");
    await expect(failure.getByRole("button", { name: "Volver a lanzar la petición" })).toBeVisible();
    await expect(station(page, "orchestrator")).toHaveAttribute("data-state", "error");
    await expect(page.getByText("La ejecución se detuvo antes de que el Orquestador")).toBeVisible();
    // Stored English summaries are shown in Spanish.
    await expect(page.getByRole("log")).toContainText(
      "El proveedor rechazó la llamada por límite de uso (HTTP 429).",
    );
  });

  test("respuesta mal formada: falla sin reintentar y propone reformular", async ({ page }) => {
    await useFakeBackend(page, "malformed");
    await openDashboard(page);
    const request = "Crea un README para la demo rota";
    await submitRequest(page, request);

    await expect(runStatus(page)).toHaveText("Fallida", { timeout: 15_000 });
    const failure = page.locator('.notice[data-tone="danger"]');
    await expect(failure).toContainText("respuesta mal formada");
    await failure.getByRole("button", { name: "Editar la petición" }).click();
    await expect(requestInput(page)).toBeFocused();
    await expect(requestInput(page)).toHaveValue(request);
  });
});

test.describe("rate limiting (backend simulado)", () => {
  test("explica el límite diario, dice cuándo volver y conserva el texto", async ({ page }) => {
    await useFakeBackend(page, "rate_limited_day");
    await openDashboard(page);
    const request = "Crea un README para la tercera demo";
    await submitRequest(page, request);

    const notice = page.locator('.notice[data-tone="danger"]');
    await expect(notice).toContainText("Has alcanzado el límite diario");
    await expect(notice).toContainText("Podrás volver a intentarlo en 20 h");
    await expect(requestInput(page)).toHaveValue(request);

    await notice.getByRole("button", { name: /Cerrar aviso/ }).click();
    await expect(notice).toHaveCount(0);
  });
});
