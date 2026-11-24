import { describe, expect, it } from "vitest";
import { runOrchestrator, runTesting } from "./index";
import {
  contentHash,
  evaluateDeliveryGate,
  splitByScope,
  taskScope,
  type DeliveredFile,
} from "./delivery-gate";
import type { TestReport } from "./schemas";

const PAGE = "app/contacto/page.tsx";
const FORM = "app/contacto/_components/ContactForm.tsx";

const rejection: TestReport = {
  passed: false,
  summary: "Testing bloqueó la entrega: falló 1 comprobación determinista.",
  deterministicChecks: [
    { name: `file_exists:${FORM}`, passed: true, details: "Existe." },
    {
      name: `nextjs:use-client:${FORM}`,
      passed: false,
      details: `${FORM} usa useState (línea 4) pero no empieza con 'use client'.`,
    },
  ],
  review: null,
};

const delivered = (content: string, previousContent: string | null): DeliveredFile => ({
  path: FORM,
  revision: 2,
  content,
  previousContent,
});

describe("task scope", () => {
  it("is the set of paths named by the task's checks", () => {
    expect(
      taskScope({
        criteria: ["x"],
        checks: [
          { type: "file_exists", path: FORM },
          { type: "contains_text", path: FORM, text: "htmlFor" },
          { type: "file_exists", path: "app/contacto/data.ts" },
        ],
      }),
    ).toEqual(["app/contacto/_components/ContactForm.tsx", "app/contacto/data.ts"]);
  });

  // Regression: in real runs 3 and 5, the form task also wrote the page.
  it("separates writes outside the task", () => {
    const { allowed, outside } = splitByScope(
      [
        { path: FORM, content: "form" },
        { path: PAGE, content: "page" },
      ],
      [FORM],
    );
    expect(allowed.map((file) => file.path)).toEqual([FORM]);
    expect(outside.map((file) => file.path)).toEqual([PAGE]);
  });

  it("declares each planned file as a stored file_exists check", async () => {
    const plan = await runOrchestrator("Página de contacto", async () => ({
      summary: "Plan",
      tasks: [
        {
          title: "Formulario",
          description: "Formulario accesible",
          acceptanceCriteria: ["Usa htmlFor"],
          checks: [{ type: "contains_text", path: FORM, value: "htmlFor" }],
          files: [FORM],
          dependsOn: [],
        },
      ],
    }));
    expect(plan.tasks[0].checks[0]).toEqual({ type: "file_exists", path: FORM });
    expect(taskScope({ criteria: [], checks: plan.tasks[0].checks })).toEqual([FORM]);
  });
});

describe("evaluateDeliveryGate", () => {
  it("reports writes outside the scope as failed checks and keeps testing", () => {
    const gate = evaluateDeliveryGate({
      iteration: 1,
      delivered: [delivered("'use client';", null)],
      outOfScopePaths: [PAGE],
      previousReport: null,
    });
    expect(gate.kind).toBe("continue");
    expect(gate.kind === "continue" && gate.scopeChecks).toEqual([
      expect.objectContaining({ name: `alcance:${PAGE}`, passed: false }),
    ]);
  });

  it("blocks an unchanged resend after a rejection and carries the failures", () => {
    const same = "export function ContactForm() {}";
    const gate = evaluateDeliveryGate({
      iteration: 2,
      delivered: [delivered(same, same)],
      outOfScopePaths: [],
      previousReport: rejection,
    });
    expect(gate.kind).toBe("blocked");
    if (gate.kind !== "blocked") return;
    expect(gate.report.passed).toBe(false);
    expect(gate.report.review).toBeNull();
    expect(gate.report.summary).toBe(
      "Develop reenvió los mismos archivos tras el rechazo; no se enviaron a Testing.",
    );
    const [warning, ...rest] = gate.report.deterministicChecks;
    expect(warning.name).toBe(`sin-cambios:${FORM}`);
    expect(warning.details).toContain(contentHash(same).slice(0, 12));
    expect(rest.map((check) => check.name)).toEqual([`nextjs:use-client:${FORM}`]);
  });

  it("tests a changed delivery, a first delivery and a resend after approval", () => {
    const changed = evaluateDeliveryGate({
      iteration: 2,
      delivered: [delivered("'use client';\nexport function ContactForm() {}", "export function ContactForm() {}")],
      outOfScopePaths: [],
      previousReport: rejection,
    });
    const first = evaluateDeliveryGate({
      iteration: 1,
      delivered: [delivered("x", "x")],
      outOfScopePaths: [],
      previousReport: null,
    });
    const afterPass = evaluateDeliveryGate({
      iteration: 2,
      delivered: [delivered("x", "x")],
      outOfScopePaths: [],
      previousReport: { ...rejection, passed: true },
    });
    expect([changed.kind, first.kind, afterPass.kind]).toEqual(["continue", "continue", "continue"]);
  });

  it("treats a partly changed delivery as changed", () => {
    const gate = evaluateDeliveryGate({
      iteration: 2,
      delivered: [delivered("same", "same"), { ...delivered("new", "old"), path: PAGE }],
      outOfScopePaths: [],
      previousReport: rejection,
    });
    expect(gate.kind).toBe("continue");
  });
});

describe("runTesting with the delivery gate", () => {
  const task = {
    title: "Formulario",
    description: "Formulario",
    acceptanceCriteria: {
      criteria: ["Existe"],
      checks: [{ type: "file_exists" as const, path: FORM }],
    },
  };

  it("never calls the model for an unchanged resend", async () => {
    let calls = 0;
    const report = await runTesting(
      {
        userRequest: "Página de contacto",
        task,
        projectFiles: { [FORM]: "export function ContactForm() {}" },
        taskFilePaths: [FORM],
        deliveryGate: {
          iteration: 2,
          delivered: [delivered("export function ContactForm() {}", "export function ContactForm() {}")],
          outOfScopePaths: [],
          previousReport: rejection,
        },
      },
      async () => {
        calls += 1;
        return { passed: true, summary: "ok", findings: [] };
      },
    );
    expect(calls).toBe(0);
    expect(report.passed).toBe(false);
    expect(report.deterministicChecks[0].name).toBe(`sin-cambios:${FORM}`);
  });

  it("fails a delivery that tried to write outside its task without asking the model", async () => {
    let calls = 0;
    const report = await runTesting(
      {
        userRequest: "Página de contacto",
        task,
        projectFiles: { [FORM]: "export function ContactForm() {}" },
        taskFilePaths: [FORM],
        deliveryGate: {
          iteration: 1,
          delivered: [delivered("export function ContactForm() {}", null)],
          outOfScopePaths: [PAGE],
          previousReport: null,
        },
      },
      async () => {
        calls += 1;
        return { passed: true, summary: "ok", findings: [] };
      },
    );
    expect(calls).toBe(0);
    expect(report.passed).toBe(false);
    expect(report.summary).toContain(`alcance:${PAGE}`);
  });
});
