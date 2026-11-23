import { APICallError } from "ai";
import { describe, expect, it, vi } from "vitest";
import { classifyAgentError } from "./errors";
import { executeProviderAttempt } from "./provider-attempt";

describe("provider fallback attempts", () => {
  it("falls through Gemini models and retries a Groq 429 on Groq", async () => {
    const env = {
      AI_PROVIDER: "google",
      GEMINI_MODEL: "gemini-main",
      GEMINI_FALLBACK_MODEL: "gemini-secondary",
      GOOGLE_GENERATIVE_AI_API_KEY: "configured-google-key",
      GROQ_MODEL: "openai/gpt-oss-20b",
      GROQ_API_KEY: "configured-groq-key",
    };
    const selectedModels: string[] = [];
    const simulatedProvider = vi
      .fn<(modelId: string) => Promise<string>>()
      .mockRejectedValueOnce(createProviderError(503))
      .mockRejectedValueOnce(createProviderError(503))
      .mockRejectedValueOnce(createProviderError(429))
      .mockResolvedValueOnce("Groq result");

    let result: string | undefined;
    for (let attemptNumber = 1; attemptNumber <= 4; attemptNumber += 1) {
      try {
        const attempt = await executeProviderAttempt(
          attemptNumber,
          (target) => simulatedProvider(target.modelId),
          (target) => selectedModels.push(`${target.provider}:${target.modelId}`),
          env,
        );
        result = attempt.value;
      } catch (error) {
        expect(classifyAgentError(error).retryable).toBe(true);
      }
    }

    expect(result).toBe("Groq result");
    expect(selectedModels).toEqual([
      "google:gemini-main",
      "google:gemini-secondary",
      "groq:openai/gpt-oss-20b",
      "groq:openai/gpt-oss-20b",
    ]);
    expect(simulatedProvider).toHaveBeenCalledTimes(4);
  });
});

function createProviderError(statusCode: number): APICallError {
  return new APICallError({
    message: `HTTP ${statusCode}`,
    url: "https://provider.test/",
    requestBodyValues: {},
    statusCode,
    isRetryable: false,
  });
}
