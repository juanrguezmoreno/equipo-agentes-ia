import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { MOCK_MODEL_ID } from "./model-config";

/**
 * Deterministic stand-in for the model providers, enabled with
 * AI_PROVIDER=mock. It lets the end-to-end tests drive the whole
 * Orchestrator → Develop → Testing loop without spending free-tier quota.
 *
 * Markers in the user request select failure scenarios:
 *   [simular:cuota]      every call fails with HTTP 429
 *   [simular:caida]      every call fails with HTTP 503
 *   [simular:timeout]    every call times out
 *   [simular:formato]    the model returns malformed JSON
 *   [simular:iteracion]  Develop misses a criterion on its first iteration,
 *                        so Testing rejects it once
 */

export type MockScenario = "ok" | "quota" | "outage" | "timeout" | "malformed" | "iterate";

const SCENARIO_MARKERS: Array<[string, MockScenario]> = [
  ["[simular:cuota]", "quota"],
  ["[simular:caida]", "outage"],
  ["[simular:timeout]", "timeout"],
  ["[simular:formato]", "malformed"],
  ["[simular:iteracion]", "iterate"],
];

export function detectScenario(text: string): MockScenario {
  return SCENARIO_MARKERS.find(([marker]) => text.includes(marker))?.[1] ?? "ok";
}

type MockAgent = "orchestrator" | "develop" | "testing";

function detectAgent(system: string): MockAgent {
  if (system.includes("You are the Orchestrator")) return "orchestrator";
  if (system.includes("You are the Develop agent")) return "develop";
  if (system.includes("You are the Testing review agent")) return "testing";
  throw new Error("Mock model received an unknown system prompt.");
}

interface MockCheck {
  type: "file_exists" | "contains_text" | "exports_symbol";
  path: string;
  text?: string;
  symbol?: string;
}

const DEMO_PLAN = {
  summary: "Plan simulado: documentar la demo y exponer su versión.",
  tasks: [
    {
      title: "Escribir el README de la demo",
      description: "Crear README.md con un resumen y los pasos para probar la demo.",
      acceptanceCriteria: [
        "README.md existe",
        "Incluye una sección «Resumen»",
      ],
      checks: [
        { type: "file_exists", path: "README.md", value: "" },
        { type: "contains_text", path: "README.md", value: "## Resumen" },
      ],
      dependsOn: [],
    },
    {
      title: "Exponer la versión de la demo",
      description: "Crear src/version.ts que exporte la constante APP_VERSION.",
      acceptanceCriteria: ["src/version.ts exporta APP_VERSION"],
      checks: [
        { type: "exports_symbol", path: "src/version.ts", value: "APP_VERSION" },
      ],
      dependsOn: [1],
    },
  ],
};

function buildFile(path: string, checks: MockCheck[], omitText: boolean): string {
  const texts = omitText
    ? []
    : checks.flatMap((check) => (check.type === "contains_text" && check.text ? [check.text] : []));
  const symbols = checks.flatMap((check) =>
    check.type === "exports_symbol" && check.symbol ? [check.symbol] : [],
  );

  if (path.endsWith(".ts") || path.endsWith(".tsx")) {
    const comments = texts.map((text) => `// ${text.replace(/\n/g, " ")}`);
    const exports = symbols.map((symbol) =>
      symbol === "default" ? "export default {};" : `export const ${symbol} = "1.0.0";`,
    );
    return [...comments, ...(exports.length ? exports : ["export {};"])].join("\n") + "\n";
  }
  if (path.endsWith(".css")) {
    return `${texts.map((text) => `/* ${text} */`).join("\n")}\n:root {\n  --demo: 1;\n}\n`;
  }
  if (path.endsWith(".json")) {
    return `${JSON.stringify({ notes: texts }, null, 2)}\n`;
  }
  return ["# Demo del equipo de agentes", "", ...texts.flatMap((text) => [text, ""]), "Contenido generado por el proveedor simulado."].join("\n") + "\n";
}

function developOutput(input: unknown, scenario: MockScenario) {
  const data = input as {
    task?: { iteration?: number; acceptanceCriteria?: { checks?: MockCheck[] } };
  };
  const checks = data.task?.acceptanceCriteria?.checks ?? [];
  const omitText = scenario === "iterate" && (data.task?.iteration ?? 1) === 1;
  const byPath = new Map<string, MockCheck[]>();
  for (const check of checks) {
    byPath.set(check.path, [...(byPath.get(check.path) ?? []), check]);
  }
  if (byPath.size === 0) {
    byPath.set("README.md", []);
  }
  return {
    summary: omitText
      ? "Primera versión simulada (incompleta a propósito)."
      : "Archivos simulados que cumplen los criterios de la tarea.",
    files: [...byPath].slice(0, 4).map(([path, fileChecks]) => ({
      path,
      content: buildFile(path, fileChecks, omitText),
    })),
  };
}

const TESTING_REVIEW = {
  passed: true,
  summary: "Revisión simulada: los archivos cumplen los criterios.",
  findings: [],
};

function readPrompt(prompt: Array<{ role: string; content: unknown }>) {
  let system = "";
  let user = "";
  for (const message of prompt) {
    if (message.role === "system" && typeof message.content === "string") {
      system += message.content;
    } else if (message.role === "user" && Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part && typeof part === "object" && "type" in part && part.type === "text" && "text" in part) {
          user += String(part.text);
        }
      }
    }
  }
  return { system, user };
}

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

function providerError(statusCode: 429 | 503): APICallError {
  return new APICallError({
    message: statusCode === 429 ? "Simulated quota exhausted" : "Simulated overload",
    url: "mock://agents",
    requestBodyValues: {},
    statusCode,
    responseBody: JSON.stringify({
      error: {
        message:
          statusCode === 429
            ? "Simulated: resource has been exhausted (quota)."
            : "Simulated: the model is overloaded.",
      },
    }),
    isRetryable: true,
  });
}

export function getMockLatencyMs(env: Record<string, string | undefined> = process.env): number {
  const value = Number(env.AI_MOCK_LATENCY_MS);
  return Number.isFinite(value) && value >= 0 ? Math.min(value, 5_000) : 300;
}

export function createMockLanguageModel(latencyMs: number = getMockLatencyMs()) {
  return new MockLanguageModelV4({
    provider: "mock",
    modelId: MOCK_MODEL_ID,
    doGenerate: async (options) => {
      const { system, user } = readPrompt(options.prompt);
      const agent = detectAgent(system);
      const scenario = detectScenario(user);

      await wait(latencyMs, options.abortSignal);

      if (scenario === "quota") throw providerError(429);
      if (scenario === "outage") throw providerError(503);
      if (scenario === "timeout") {
        const timeout = new Error("Simulated provider timeout.");
        timeout.name = "TimeoutError";
        throw timeout;
      }

      let payload: unknown;
      if (scenario === "malformed") {
        payload = null;
      } else if (agent === "orchestrator") {
        payload = DEMO_PLAN;
      } else if (agent === "develop") {
        payload = developOutput(JSON.parse(user), scenario);
      } else {
        payload = TESTING_REVIEW;
      }

      const text = payload === null ? "{\"summary\": " : JSON.stringify(payload);
      return {
        content: [{ type: "text", text }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 0, text: 0, reasoning: undefined },
        },
        warnings: [],
      };
    },
  });
}
