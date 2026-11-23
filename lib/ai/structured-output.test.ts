import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ProviderModel } from "./model-config";

vi.mock("ai", () => ({
  generateText: vi.fn(),
  Output: {
    object: vi.fn((options: { schema: unknown }) => ({
      schema: options.schema,
    })),
  },
}));

vi.mock("./model", () => ({
  getLanguageModel: vi.fn(() => "mock-model"),
}));

vi.mock("./provider-attempt", () => ({
  executeProviderChain: vi.fn(),
}));

import { generateText } from "ai";
import { generateStructuredOutput } from "./structured-output";
import { executeProviderChain } from "./provider-attempt";

describe("generateStructuredOutput", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(executeProviderChain).mockImplementation(
      async (invoke) => {
        const target: ProviderModel = {
          provider: "groq",
          modelId: "openai/gpt-oss-20b",
        };
        return { target, value: await invoke(target, 12_345) };
      },
    );
  });

  it("sends Groq a system message and explicitly enables strict structured output", async () => {
    vi.mocked(generateText).mockResolvedValue({ output: { ok: true } } as never);

    const schema = z.object({ ok: z.boolean() });
    const result = await generateStructuredOutput({
      schema,
      systemPrompt: "Keep to the system instructions.",
      prompt: "Create a small plan.",
      maxOutputTokens: 500,
      budgetMs: 45_000,
    });

    expect(result).toEqual({ ok: true });
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        timeout: 12_345,
        maxRetries: 0,
        system: "Keep to the system instructions.",
        prompt: "Create a small plan.",
        providerOptions: {
          groq: {
            reasoningEffort: "low",
            structuredOutputs: true,
            strictJsonSchema: true,
          },
        },
      }),
    );
  });
});
