import { describe, expect, it } from "vitest";
import {
  DEFAULT_GEMINI_FALLBACK_MODEL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GROQ_MODEL,
  getGeminiFallbackModelId,
  getGeminiModelId,
  getGroqModelId,
  getProviderModelChain,
  getProviderModelForAttempt,
} from "./model-config";

describe("provider model configuration", () => {
  it("uses the documented free-tier Gemini default when unset", () => {
    expect(getGeminiModelId({})).toBe(DEFAULT_GEMINI_MODEL);
  });

  it("prefers GEMINI_MODEL when configured", () => {
    expect(getGeminiModelId({ GEMINI_MODEL: "  gemini-4-neon " })).toBe(
      "gemini-4-neon",
    );
  });

  it("configures a free Gemini fallback and the structured-output Groq default", () => {
    expect(getGeminiFallbackModelId({})).toBe(DEFAULT_GEMINI_FALLBACK_MODEL);
    expect(getGroqModelId({})).toBe(DEFAULT_GROQ_MODEL);
    expect(getGeminiFallbackModelId({ GEMINI_FALLBACK_MODEL: "gemini-alt" })).toBe(
      "gemini-alt",
    );
  });

  it("orders Google models before Groq and repeats Groq for the last retry", () => {
    const env = {
      AI_PROVIDER: "google",
      GOOGLE_GENERATIVE_AI_API_KEY: "configured-google-key",
      GEMINI_MODEL: "gemini-main",
      GEMINI_FALLBACK_MODEL: "gemini-secondary",
      GROQ_API_KEY: "configured-groq-key",
      GROQ_MODEL: "openai/gpt-oss-20b",
    };

    expect(getProviderModelChain(env)).toEqual([
      { provider: "google", modelId: "gemini-main" },
      { provider: "google", modelId: "gemini-secondary" },
      { provider: "groq", modelId: "openai/gpt-oss-20b" },
    ]);
    expect([1, 2, 3, 4].map((attempt) => getProviderModelForAttempt(attempt, env))).toEqual([
      { provider: "google", modelId: "gemini-main" },
      { provider: "google", modelId: "gemini-secondary" },
      { provider: "groq", modelId: "openai/gpt-oss-20b" },
      { provider: "groq", modelId: "openai/gpt-oss-20b" },
    ]);
  });

  it("requires a Groq key when explicitly selecting Groq as primary", () => {
    expect(() => getProviderModelChain({ AI_PROVIDER: "groq" })).toThrow(
      "AI_PROVIDER=groq requires GROQ_API_KEY.",
    );
    expect(getProviderModelChain({
      AI_PROVIDER: "groq",
      GROQ_API_KEY: "configured-groq-key",
      GROQ_MODEL: "openai/gpt-oss-20b",
    })[0]).toEqual({
      provider: "groq",
      modelId: "openai/gpt-oss-20b",
    });
  });

  it("uses the legacy model variable only when Groq is the primary provider", () => {
    expect(getGroqModelId({ GROQ_MODEL: "groq-example" })).toBe("groq-example");
    expect(getGroqModelId({ AI_MODEL: "legacy-groq-model" })).toBe(
      DEFAULT_GROQ_MODEL,
    );
    expect(
      getGroqModelId({
        AI_PROVIDER: "groq",
        AI_MODEL: "legacy-groq-model",
      }),
    ).toBe("legacy-groq-model");
  });

  it("does not mistake a legacy Gemini model for the Groq fallback", () => {
    expect(
      getProviderModelForAttempt(3, {
        AI_PROVIDER: "google",
        AI_MODEL: "gemini-4-hydrogen",
        GROQ_API_KEY: "configured-groq-key",
      }),
    ).toEqual({
      provider: "groq",
      modelId: DEFAULT_GROQ_MODEL,
    });
  });
});
