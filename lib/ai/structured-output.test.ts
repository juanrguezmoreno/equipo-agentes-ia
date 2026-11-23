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
  executeProviderAttempt: vi.fn(),
}));

import { generateText } from "ai";
import { generateStructuredOutput } from "./structured-output";
import { executeProviderAttempt } from "./provider-attempt";

describe("generateStructuredOutput", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(executeProviderAttempt).mockImplementation(
      async (_attemptNumber, invoke, onSelected) => {
        const target: ProviderModel = {
          provider: "groq",
          modelId: "openai/gpt-oss-20b",
        };
        onSelected?.(target);
        return { target, value: await invoke(target) };
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
      attemptNumber: 3,
    });

    expect(result).toEqual({ ok: true });
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
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
