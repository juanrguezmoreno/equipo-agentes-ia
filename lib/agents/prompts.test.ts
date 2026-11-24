import { describe, expect, it } from "vitest";
import { runDevelop, runOrchestrator, runTesting } from "./index";
import type { StructuredGenerationRequest } from "@/lib/ai/structured-output";
import {
  DEVELOP_SYSTEM_PROMPT,
  LANGUAGE_RULE,
  ORCHESTRATOR_SYSTEM_PROMPT,
  TESTING_SYSTEM_PROMPT,
} from "./prompts";

// Regression tests for the real-run findings of 2026-11-24. Model behaviour
// cannot be unit-tested, so these pin the instructions and the inputs every
// agent receives; the real runs recorded in docs/BITACORA.md check the effect.

const PLAN = {
  summary: "Plan",
  tasks: [
    {
      title: "Página",
      description: "Ruta",
      acceptanceCriteria: ["app/contacto/page.tsx exporta la página"],
      checks: [{ type: "file_exists", path: "app/contacto/page.tsx", value: "" }],
      files: ["app/contacto/page.tsx"],
      dependsOn: [],
    },
  ],
};

function capture(output: unknown) {
  const calls: StructuredGenerationRequest[] = [];
  const generate = async (request: StructuredGenerationRequest) => {
    calls.push(request);
    return output;
  };
  return { calls, generate };
}

describe("agent prompts", () => {
  it("make every agent answer in the language of the request", () => {
    for (const prompt of [ORCHESTRATOR_SYSTEM_PROMPT, DEVELOP_SYSTEM_PROMPT, TESTING_SYSTEM_PROMPT]) {
      expect(prompt).toContain(LANGUAGE_RULE);
    }
    expect(LANGUAGE_RULE).toMatch(/same language as userRequest/);
  });

  it("send the user's request to every agent so its language is known", async () => {
    const userRequest = "Añade una página de contacto";
    const orchestrator = capture(PLAN);
    await runOrchestrator(userRequest, orchestrator.generate);
    expect(JSON.parse(orchestrator.calls[0].prompt)).toEqual({ userRequest });
    expect(orchestrator.calls[0].systemPrompt).toBe(ORCHESTRATOR_SYSTEM_PROMPT);

    const develop = capture({ summary: "Hecho", files: [{ path: "app/contacto/page.tsx", content: "export default function P() { return null; }" }] });
    await runDevelop(
      {
        userRequest,
        task: {
          title: "Página",
          description: "Ruta",
          acceptanceCriteria: { criteria: ["x"], checks: [{ type: "file_exists", path: "app/contacto/page.tsx" }] },
          iteration: 1,
          previousTestReport: null,
          allowedFiles: ["app/contacto/page.tsx"],
        },
        projectFiles: {},
      },
      develop.generate,
    );
    expect(JSON.parse(develop.calls[0].prompt).userRequest).toBe(userRequest);
  });

  it("ask the Orchestrator for 2 to 4 tasks with verifiable criteria", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("split it into 2 to 4 ordered tasks");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("Never exceed 4 tasks");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("2 to 4 per task");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toMatch(/verifiable by reading the files/);
    expect(ORCHESTRATOR_SYSTEM_PROMPT).not.toContain("Prefer a single task");
    // Regression: a real run planned page + form + data as one task.
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("most requests need 2 to 4 tasks");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toMatch(/Example: "a contact page[^]*\(3\) the route app\/contacto\/page\.tsx/);
  });

  it("describe the App Router project to every agent", () => {
    for (const prompt of [ORCHESTRATOR_SYSTEM_PROMPT, DEVELOP_SYSTEM_PROMPT, TESTING_SYSTEM_PROMPT]) {
      expect(prompt).toContain("app/<route>/page.tsx");
    }
  });
});

describe("Testing with convention checks", () => {
  const task = {
    title: "Formulario",
    description: "Formulario de contacto",
    acceptanceCriteria: {
      criteria: ["Existe el formulario"],
      checks: [{ type: "file_exists" as const, path: "src/pages/Contact.tsx" }],
    },
  };
  const contact = `import { useState } from "react";\nexport default function Contact() { const [v, setV] = useState(""); return <input value={v} onChange={(e) => setV(e.target.value)} />; }`;

  it("blocks the Pages Router form without asking the model (regression)", async () => {
    const review = capture({ passed: true, summary: "ok", findings: [] });
    const report = await runTesting(
      {
        userRequest: "Página de contacto",
        task,
        projectFiles: { "src/pages/Contact.tsx": contact },
        taskFilePaths: ["src/pages/Contact.tsx"],
      },
      review.generate,
    );
    expect(report.passed).toBe(false);
    expect(report.review).toBeNull();
    expect(review.calls).toHaveLength(0);
    expect(report.summary).toBe("Testing bloqueó la entrega: fallaron 3 comprobaciones deterministas.");
    expect(report.deterministicChecks.filter((check) => !check.passed).map((check) => check.name)).toEqual([
      "nextjs:app-router:src/pages/Contact.tsx",
      "nextjs:use-client:src/pages/Contact.tsx",
      "a11y:label:src/pages/Contact.tsx",
    ]);
  });

  it("does not hold a task back for another task's files", async () => {
    const review = capture({ passed: true, summary: "Correcto", findings: [] });
    const report = await runTesting(
      {
        userRequest: "Página de contacto",
        task: { ...task, acceptanceCriteria: { ...task.acceptanceCriteria, checks: [{ type: "file_exists", path: "README.md" }] } },
        projectFiles: { "src/pages/Contact.tsx": contact, "README.md": "# Hola" },
        taskFilePaths: ["README.md"],
      },
      review.generate,
    );
    expect(report.passed).toBe(true);
    expect(review.calls).toHaveLength(1);
  });
});

describe("Testing review scope", () => {
  // Regression: in real run 8 the review failed the form task as "critical"
  // because the contact page (a later task) did not exist yet, pushing
  // Develop to write outside its scope.
  it("judges only the current task, not the rest of the plan", () => {
    expect(TESTING_SYSTEM_PROMPT).toContain("judge only the current task against its own acceptance criteria and files");
    expect(TESTING_SYSTEM_PROMPT).toContain("never fail this task for work that belongs to another task");
  });
});
