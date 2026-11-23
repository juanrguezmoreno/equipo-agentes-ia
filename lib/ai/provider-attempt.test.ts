import { APICallError } from "ai";
import { describe, expect, it, vi } from "vitest";
import { classifyAgentError } from "./errors";
import {
  executeProviderChain,
  PROVIDER_TIMEOUT_MS,
  type ProviderAttemptRecord,
} from "./provider-attempt";

const env = {
  AI_PROVIDER: "google",
  GEMINI_MODEL: "gemini-main",
  GEMINI_FALLBACK_MODEL: "gemini-secondary",
  GOOGLE_GENERATIVE_AI_API_KEY: "configured-google-key",
  GROQ_MODEL: "openai/gpt-oss-20b",
  GROQ_API_KEY: "configured-groq-key",
};

describe("provider fallback chain", () => {
  it("skips to the next provider immediately on a Gemini 503", async () => {
    const attempts: ProviderAttemptRecord[] = [];
    const invoke = vi
      .fn<(modelId: string) => Promise<string>>()
      .mockRejectedValueOnce(createProviderError(503))
      .mockRejectedValueOnce(createProviderError(503))
      .mockResolvedValueOnce("Groq result");

    const result = await executeProviderChain(
      (target) => invoke(target.modelId),
      { env, budgetMs: 45_000, onAttempt: (record) => attempts.push(record) },
    );

    expect(result.value).toBe("Groq result");
    expect(invoke.mock.calls.map(([modelId]) => modelId)).toEqual([
      "gemini-main",
      "gemini-secondary",
      "openai/gpt-oss-20b",
    ]);
    expect(attempts.map((record) => [record.target.modelId, record.outcome])).toEqual([
      ["gemini-main", "failed"],
      ["gemini-secondary", "failed"],
      ["openai/gpt-oss-20b", "succeeded"],
    ]);
    expect(attempts[0].statusCode).toBe(503);
  });

  it("stops on a permanent error without trying other providers", async () => {
    const invoke = vi.fn().mockRejectedValueOnce(createProviderError(400));

    const error = await executeProviderChain(invoke, { env, budgetMs: 45_000 })
      .catch((caught: unknown) => caught);

    expect(classifyAgentError(error).providerStatusCode).toBe(400);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("throws the last transient error when every provider fails", async () => {
    const invoke = vi.fn().mockRejectedValue(createProviderError(503));

    const error = await executeProviderChain(invoke, { env, budgetMs: 45_000 })
      .catch((caught: unknown) => caught);

    expect(classifyAgentError(error).retryable).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(3);
  });

  it("caps each provider timeout by the remaining invocation budget", async () => {
    let clock = 0;
    const timeouts: number[] = [];
    const invoke = vi.fn(async (_target: unknown, timeoutMs: number) => {
      timeouts.push(timeoutMs);
      clock += timeoutMs;
      const timeout = new Error("timed out");
      timeout.name = "TimeoutError";
      throw timeout;
    });

    await executeProviderChain(invoke, {
      env,
      budgetMs: 40_000,
      now: () => clock,
    }).catch(() => undefined);

    expect(timeouts).toEqual([
      PROVIDER_TIMEOUT_MS.google,
      40_000 - PROVIDER_TIMEOUT_MS.google,
    ]);
  });

  it("skips providers when too little budget remains to call them", async () => {
    const invoke = vi.fn();

    const error = await executeProviderChain(invoke, { env, budgetMs: 1_000 })
      .catch((caught: unknown) => caught);

    expect(invoke).not.toHaveBeenCalled();
    expect(classifyAgentError(error)).toMatchObject({
      code: "provider_timeout",
      retryable: true,
    });
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
