import { describe, expect, it } from "vitest";
import {
  DevelopmentOutputSchema,
  PlanSchema,
  TestReportSchema,
  type Plan,
} from "./schemas";

const validPlan: Plan = {
  summary: "Build a small contact page.",
  tasks: [
    {
      title: "Add contact page",
      description: "Create a contact page with a form.",
      acceptanceCriteria: ["The page contains a contact form."],
      checks: [
        {
          type: "file_exists",
          path: "app/contact/page.tsx",
        },
      ],
      dependsOn: [],
    },
    {
      title: "Add contact route test",
      description: "Verify the contact page export.",
      acceptanceCriteria: ["The contact page is exported."],
      checks: [
        {
          type: "exports_symbol",
          path: "app/contact/page.tsx",
          symbol: "default",
        },
      ],
      dependsOn: [1],
    },
  ],
};

describe("agent output schemas", () => {
  it("rejects cyclic task dependencies", () => {
    const cyclicPlan = {
      ...validPlan,
      tasks: validPlan.tasks.map((task, index) => ({
        ...task,
        dependsOn: [index === 0 ? 2 : 1],
      })),
    };

    expect(PlanSchema.safeParse(cyclicPlan).success).toBe(false);
  });

  it("does not allow a report to pass when a deterministic check fails", () => {
    const report = TestReportSchema.safeParse({
      passed: true,
      summary: "All checks passed.",
      deterministicChecks: [
        {
          name: "file_exists:app/contact/page.tsx",
          passed: false,
          details: "Required file is missing.",
        },
      ],
      review: {
        passed: true,
        summary: "Looks correct.",
        findings: [],
      },
    });

    expect(report.success).toBe(false);
  });

  it("accepts a passing report only when checks and review pass", () => {
    const report = TestReportSchema.safeParse({
      passed: true,
      summary: "All checks passed.",
      deterministicChecks: [
        {
          name: "file_exists:app/contact/page.tsx",
          passed: true,
          details: "Required file exists.",
        },
      ],
      review: {
        passed: true,
        summary: "The implementation meets the criteria.",
        findings: [],
      },
    });

    expect(report.success).toBe(true);
  });

  it("limits the combined size of one development result", () => {
    const output = DevelopmentOutputSchema.safeParse({
      summary: "Add the page and its styles.",
      files: [
        { path: "app/page.tsx", content: "x".repeat(10_001) },
        { path: "app/page.css", content: "y".repeat(10_001) },
      ],
    });

    expect(output.success).toBe(false);
  });
});
