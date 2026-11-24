// Real run against a deployed URL (spends model quota: counts toward the
// daily cap of real runs). Clicks the "Página de contacto" example, waits for
// the run to finish, dumps the log for diagnosis and takes desktop and
// mobile screenshots of the same run.
//
//   node scripts/prod-run.mjs https://… docs/screenshots/fase5 [statePath]
//
// statePath (optional) saves the anonymous session so the same run can be
// reopened later without spending another one. It contains session tokens:
// keep it outside the repository.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const [base, outDir = "docs/screenshots/fase5", statePath] = process.argv.slice(2);
if (!base) throw new Error("Usage: node scripts/prod-run.mjs <url> [outDir]");
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "es-ES" });
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (message) => message.type() === "error" && consoleErrors.push(message.text()));

await page.goto(base);
await page.getByRole("heading", { name: "¿Qué tiene que construir el equipo?" }).waitFor({ timeout: 30_000 });
const started = Date.now();
await page.getByRole("button", { name: "Página de contacto" }).click();
await page.getByRole("heading", { level: 2, name: /página de contacto/i }).waitFor({ timeout: 30_000 });

// Capture the moment Testing rejects a delivery, if it happens.
let rejectionShot = false;
const status = page.locator(".run-status");
for (;;) {
  const text = (await status.textContent())?.trim() ?? "";
  if (!rejectionShot && (await page.locator(".log-title", { hasText: "Pruebas con hallazgos" }).count()) > 0) {
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(outDir, "rechazo-en-curso-escritorio.png"), fullPage: true });
    rejectionShot = true;
  }
  if (["Completada", "Fallida", "Cancelada"].includes(text)) break;
  if (Date.now() - started > 8 * 60_000) throw new Error(`Timed out with status "${text}"`);
  await page.waitForTimeout(500);
}
await page.getByRole("button", { name: "Iniciar equipo" }).waitFor({ timeout: 30_000 });
const seconds = Math.round((Date.now() - started) / 1000);

// Open the Testing reports of every task that needed more than one iteration.
const lanes = page.locator("ol[aria-label='Tareas'] > li");
const summary = [];
for (let i = 0; i < (await lanes.count()); i += 1) {
  const lane = lanes.nth(i);
  const title = (await lane.locator(".lane-title").textContent())?.trim();
  const iteration = (await lane.locator(".lane-iteration").textContent())?.trim();
  summary.push(`${title} — ${iteration}`);
  if (/Iteración [2-9]/.test(iteration ?? "")) {
    await lane.locator("summary").first().click();
    for (const report of await lane.locator("details details > summary").all()) await report.click();
  }
}
await page.waitForTimeout(500);
await page.screenshot({ path: join(outDir, "iteracion-corregida-escritorio.png"), fullPage: true });

const log = await page.locator(".log-item").allInnerTexts();
const finalStatus = (await status.textContent())?.trim();
const notices = await page.locator(".notice").allInnerTexts();

// Same run on a phone: the session cookie keeps it selected after reload.
await page.setViewportSize({ width: 390, height: 844 });
await page.reload();
await page.getByRole("heading", { level: 2, name: /página de contacto/i }).waitFor({ timeout: 30_000 });
await page.waitForTimeout(800);
await page.screenshot({ path: join(outDir, "iteracion-corregida-movil.png"), fullPage: true });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const report = [
  `Estado final: ${finalStatus} en ~${seconds} s`,
  `Rechazo capturado en curso: ${rejectionShot}`,
  `Tareas:`,
  ...summary.map((line) => `  ${line}`),
  `Avisos: ${notices.length ? notices.join(" | ") : "ninguno"}`,
  `Scroll horizontal en móvil: ${overflow}px`,
  `Errores de consola: ${consoleErrors.length ? consoleErrors.join(" | ") : "ninguno"}`,
  `Registro (más reciente primero):`,
  ...log.map((line) => `  ${line.replace(/\s*\n\s*/g, " · ")}`),
].join("\n");
await writeFile(join(outDir, "ejecucion.txt"), `${report}\n`);
if (statePath) await context.storageState({ path: statePath });
console.log(report);
await browser.close();
