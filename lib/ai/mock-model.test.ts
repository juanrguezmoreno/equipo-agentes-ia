import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APICallError } from "ai";
import { runDevelop, runOrchestrator, runTesting } from "@/lib/agents";
import type { ProviderAttemptRecord } from "./provider-attempt";
import { classifyAgentError } from "./errors";
import { detectScenario } from "./mock-model";
import { getProviderModelChain } from "./model-config";

beforeEach(() => {
  vi.stubEnv("AI_PROVIDER", "mock");
  vi.stubEnv("AI_MOCK_LATENCY_MS", "0");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function runWholeTask(request: string, attempts: ProviderAttemptRecord[] = []) {
  const options = {
    budgetMs: 10_000,
    onProviderAttempt: (record: ProviderAttemptRecord) => attempts.push(record),
  };
  const plan = await runOrchestrator(request, undefined, options);
  const task = plan.tasks[0];
  const acceptanceCriteria = {
    criteria: task.acceptanceCriteria,
    checks: task.checks,
  };
  const reports = [];
  let files: Record<string, string> = {};
  for (let iteration = 1; iteration <= 3; iteration += 1) {
    const development = await runDevelop(
      {
        userRequest: request,
        task: { ...task, acceptanceCriteria, iteration, previousTestReport: reports.at(-1) ?? null },
        projectFiles: files,
      },
      undefined,
      options,
    );
    files = {
      ...files,
      ...Object.fromEntries(development.files.map((file) => [file.path, file.content])),
    };
    const report = await runTesting(
      { userRequest: request, task: { ...task, acceptanceCriteria }, projectFiles: files },
      undefined,
      options,
    );
    reports.push(report);
    if (report.passed) {
      break;
    }
  }
  return { plan, reports, files };
}

describe("mock provider", () => {
  it("drives plan, develop and testing to an approved task", async () => {
    const attempts: ProviderAttemptRecord[] = [];
    const { plan, reports, files } = await runWholeTask(
      "Crea un README para la demo del equipo",
      attempts,
    );

    expect(plan.tasks).toHaveLength(2);
    expect(plan.tasks[1].dependsOn).toEqual([1]);
    expect(reports).toHaveLength(1);
    expect(reports[0].passed).toBe(true);
    expect(files["README.md"]).toContain("## Resumen");
    expect(attempts.every((attempt) => attempt.target.provider === "mock")).toBe(true);
  });

  it("satisfies exports_symbol checks with valid TypeScript", async () => {
    const plan = await runOrchestrator("Crea un README para la demo del equipo", undefined, {
      budgetMs: 10_000,
    });
    const task = plan.tasks[1];
    const acceptanceCriteria = { criteria: task.acceptanceCriteria, checks: task.checks };
    const development = await runDevelop(
      {
        userRequest: "demo",
        task: { ...task, acceptanceCriteria, iteration: 1, previousTestReport: null },
        projectFiles: {},
      },
      undefined,
      { budgetMs: 10_000 },
    );
    const report = await runTesting(
      {
        userRequest: "demo",
        task: { ...task, acceptanceCriteria },
        projectFiles: Object.fromEntries(development.files.map((file) => [file.path, file.content])),
      },
      undefined,
      { budgetMs: 10_000 },
    );
    expect(report.passed).toBe(true);
  });

  it("makes Testing reject the first iteration in the iteration scenario", async () => {
    const { reports } = await runWholeTask(
      "Crea un README para la demo [simular:iteracion]",
    );
    expect(reports.map((report) => report.passed)).toEqual([false, true]);
    expect(reports[0].review).toBeNull();
  });

  it("raises a retryable 429 in the quota scenario", async () => {
    const error = await runOrchestrator("Demo de cuota [simular:cuota]", undefined, {
      budgetMs: 10_000,
    }).catch((caught: unknown) => caught);
    expect(APICallError.isInstance(error)).toBe(true);
    expect(classifyAgentError(error)).toMatchObject({
      code: "rate_limited",
      retryable: true,
      providerStatusCode: 429,
    });
  });

  it("raises a retryable timeout in the timeout scenario", async () => {
    const error = await runOrchestrator("Demo lenta [simular:timeout]", undefined, {
      budgetMs: 10_000,
    }).catch((caught: unknown) => caught);
    expect(classifyAgentError(error)).toMatchObject({
      code: "provider_timeout",
      retryable: true,
    });
  });

  it("raises a permanent error for malformed output", async () => {
    const error = await runOrchestrator("Demo rota [simular:formato]", undefined, {
      budgetMs: 10_000,
    }).catch((caught: unknown) => caught);
    expect(classifyAgentError(error)).toMatchObject({
      code: "invalid_structured_output",
      retryable: false,
    });
  });

  it("detects scenario markers", () => {
    expect(detectScenario("hola")).toBe("ok");
    expect(detectScenario("x [simular:caida] y")).toBe("outage");
  });

  it("is refused in Vercel production", () => {
    expect(() =>
      getProviderModelChain({ AI_PROVIDER: "mock", VERCEL_ENV: "production" }),
    ).toThrow(/not allowed in production/);
    expect(getProviderModelChain({ AI_PROVIDER: "mock" })).toEqual([
      { provider: "mock", modelId: "mock-agents" },
    ]);
  });
});
