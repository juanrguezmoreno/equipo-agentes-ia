import { describe, expect, it, vi } from "vitest";
import { runDevelop, runOrchestrator, runTesting } from "./index";
import type { Plan } from "./schemas";

const plan: Plan = {
  summary: "Add a contact page.",
  tasks: [
    {
      title: "Create contact page",
      description: "Create an exported contact page component.",
      acceptanceCriteria: ["The page has a default export."],
      checks: [
        {
          type: "exports_symbol",
          path: "app/contact/page.tsx",
          symbol: "default",
        },
      ],
      files: ["app/contact/page.tsx"],
      dependsOn: [],
    },
  ],
};

const generatedPlan = {
  ...plan,
  tasks: plan.tasks.map((task) => ({
    ...task,
    checks: task.checks.map((check) => ({
      type: check.type,
      path: check.path,
      value:
        check.type === "contains_text"
          ? check.text
          : check.type === "exports_symbol"
            ? check.symbol
            : "",
    })),
  })),
};

describe("agent execution with a simulated model", () => {
  it("validates the Orchestrator response against its plan schema", async () => {
    const generate = vi.fn(async () => generatedPlan);

    // Declared files are stored as leading file_exists checks (task scope).
    await expect(
      runOrchestrator("Add a contact page.", generate),
    ).resolves.toEqual({
      ...plan,
      tasks: plan.tasks.map((task) => ({
        ...task,
        checks: [{ type: "file_exists", path: "app/contact/page.tsx" }, ...task.checks],
      })),
    });
    expect(generate).toHaveBeenCalledOnce();
  });

  it("rejects provider output that violates plan constraints", async () => {
    const invalidPlan = {
      ...generatedPlan,
      tasks: [{ ...generatedPlan.tasks[0], dependsOn: [2] }],
    };
    const generate = vi.fn(async () => invalidPlan);

    await expect(
      runOrchestrator("Add a contact page.", generate),
    ).rejects.toThrow();
    expect(generate).toHaveBeenCalledOnce();
  });

  it("accepts only schema-valid files from Develop", async () => {
    const development = {
      summary: "Created the contact page.",
      files: [
        {
          path: "app/contact/page.tsx",
          content: "export default function ContactPage() { return <main />; }",
        },
      ],
    };
    const generate = vi.fn(async () => development);

    await expect(
      runDevelop(
        {
          userRequest: "Add a contact page.",
          task: {
            title: "Create contact page",
            description: "Create a contact page.",
            acceptanceCriteria: {
              criteria: ["The page has a default export."],
              checks: [
                {
                  type: "exports_symbol",
                  path: "app/contact/page.tsx",
                  symbol: "default",
                },
              ],
            },
            iteration: 1,
            previousTestReport: null,
            allowedFiles: ["app/contact/page.tsx"],
          },
          projectFiles: {},
        },
        generate,
      ),
    ).resolves.toEqual(development);
    expect(generate).toHaveBeenCalledOnce();
  });

  it("does not ask the model to review files that fail deterministic checks", async () => {
    const generate = vi.fn(async () => ({
      passed: true,
      summary: "Looks good.",
      findings: [],
    }));

    const report = await runTesting(
      {
        userRequest: "Add a contact page.",
        task: {
          title: "Create contact page",
          description: "Create an exported contact page component.",
          acceptanceCriteria: {
            criteria: ["The page has a default export."],
            checks: [
              {
                type: "exports_symbol",
                path: "app/contact/page.tsx",
                symbol: "default",
              },
            ],
          },
        },
        projectFiles: {
          "app/contact/page.tsx": "export default function ContactPage( {",
        },
      },
      generate,
    );

    expect(report.passed).toBe(false);
    expect(report.deterministicChecks.some((check) => !check.passed)).toBe(true);
    expect(report.review).toBeNull();
    expect(generate).not.toHaveBeenCalled();
  });

  it("requires the simulated review to pass after deterministic checks", async () => {
    const generate = vi.fn(async () => ({
      passed: false,
      summary: "The form has no submit action.",
      findings: [
        {
          severity: "major",
          criterion: "The form can be submitted.",
          message: "No submit handler was found.",
          evidence: "app/contact/page.tsx has no onSubmit attribute.",
        },
      ],
    }));

    const report = await runTesting(
      {
        userRequest: "Add a contact page.",
        task: {
          title: "Create contact page",
          description: "Create an exported contact page component.",
          acceptanceCriteria: {
            criteria: ["The page has a default export."],
            checks: [
              {
                type: "exports_symbol",
                path: "app/contact/page.tsx",
                symbol: "default",
              },
            ],
          },
        },
        projectFiles: {
          "app/contact/page.tsx": "export default function ContactPage() { return <main />; }",
        },
      },
      generate,
    );

    expect(report.deterministicChecks.every((check) => check.passed)).toBe(true);
    expect(report.review?.passed).toBe(false);
    expect(report.passed).toBe(false);
    expect(generate).toHaveBeenCalledOnce();
  });
});
