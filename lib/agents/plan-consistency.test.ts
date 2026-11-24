import { describe, expect, it } from "vitest";
import { runOrchestrator } from "./index";
import { alignCheckPaths } from "./plan-consistency";
import { runDeterministicChecks } from "@/lib/validation/virtual-project";
import type { Plan } from "./schemas";

// The inconsistent task planned in real run 4 (2026-11-24).
const RUN_4_TASK = {
  title: "Componente de formulario de contacto accesible",
  description: "Crear un componente cliente con etiquetas asociadas.",
  acceptanceCriteria: ["Incluye inputs con label asociado mediante htmlFor."],
  checks: [
    { type: "file_exists" as const, path: "app/contacto/_components/ContactForm.tsx" },
    { type: "contains_text" as const, path: "app/_components/ContactForm.tsx", text: "htmlFor" },
    {
      type: "exports_symbol" as const,
      path: "app/contacto/_components/ContactForm.tsx",
      symbol: "ContactForm",
    },
  ],
  files: ["app/contacto/_components/ContactForm.tsx"],
  dependsOn: [],
};

describe("alignCheckPaths", () => {
  it("aligns a same-name file in another folder to the file_exists path (run 4)", () => {
    const plan: Plan = { summary: "Plan", tasks: [RUN_4_TASK] };
    const { plan: aligned, repairs } = alignCheckPaths(plan);
    expect(repairs).toEqual([
      {
        task: 1,
        from: "app/_components/ContactForm.tsx",
        to: "app/contacto/_components/ContactForm.tsx",
      },
    ]);
    expect(new Set(aligned.tasks[0].checks.map((check) => check.path))).toEqual(
      new Set(["app/contacto/_components/ContactForm.tsx"]),
    );
  });

  it("leaves different files and other tasks untouched", () => {
    const plan: Plan = {
      summary: "Plan",
      tasks: [
        {
          ...RUN_4_TASK,
          checks: [
            { type: "file_exists", path: "app/contacto/page.tsx" },
            { type: "contains_text", path: "app/contacto/data.ts", text: "email" },
          ],
        },
        {
          ...RUN_4_TASK,
          checks: [{ type: "file_exists", path: "app/page.tsx" }],
          dependsOn: [1],
        },
      ],
    };
    expect(alignCheckPaths(plan)).toEqual({ plan, repairs: [] });
  });

  it("uses the most referenced path when no file_exists names the file", () => {
    const plan: Plan = {
      summary: "Plan",
      tasks: [
        {
          ...RUN_4_TASK,
          checks: [
            { type: "contains_text", path: "app/a/Form.tsx", text: "label" },
            { type: "exports_symbol", path: "app/a/Form.tsx", symbol: "Form" },
            { type: "contains_text", path: "app/b/Form.tsx", text: "htmlFor" },
          ],
        },
      ],
    };
    expect(alignCheckPaths(plan).repairs).toEqual([
      { task: 1, from: "app/b/Form.tsx", to: "app/a/Form.tsx" },
    ]);
  });
});

describe("runOrchestrator with an inconsistent plan", () => {
  it("returns aligned checks and notes the repair in the summary", async () => {
    const generated = {
      summary: "Página de contacto",
      tasks: [
        {
          ...RUN_4_TASK,
          checks: RUN_4_TASK.checks.map((check) => ({
            type: check.type,
            path: check.path,
            value: "text" in check ? check.text : "symbol" in check ? check.symbol : "",
          })),
        },
      ],
    };
    const plan = await runOrchestrator("Página de contacto", async () => generated);
    expect(plan.tasks[0].checks.every((check) => check.path.startsWith("app/contacto/"))).toBe(true);
    expect(plan.summary).toBe(
      "Página de contacto (Se alinearon 1 ruta de comprobación con el archivo de su tarea.)",
    );
  });
});

describe("missing-file feedback", () => {
  it("says the file does not exist instead of 'does not contain' (run 4)", () => {
    const [result] = runDeterministicChecks(
      [{ path: "app/contacto/_components/ContactForm.tsx", content: "<label htmlFor='a' />" }],
      [{ type: "contains_text", path: "app/_components/ContactForm.tsx", text: "htmlFor" }],
    );
    expect(result.passed).toBe(false);
    expect(result.details).toBe(
      "El archivo app/_components/ContactForm.tsx no existe, así que no se puede comprobar que contenga «htmlFor».",
    );
  });
});
