import { APICallError } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { classifyAgentError } from "./errors";

describe("classifyAgentError", () => {
  it.each([408, 425, 429, 500, 502, 503, 504])(
    "retries transient provider HTTP %i responses",
    (statusCode) => {
      const error = new APICallError({
        message: "Transient provider error",
        url: "https://provider.test/",
        requestBodyValues: {},
        statusCode,
        isRetryable: false,
      });

      expect(classifyAgentError(error).retryable).toBe(true);
    },
  );

  it("does not retry permanent provider HTTP errors", () => {
    const error = new APICallError({
      message: "Invalid request",
      url: "https://provider.test/",
      requestBodyValues: {},
      statusCode: 400,
      isRetryable: true,
    });

    expect(classifyAgentError(error).retryable).toBe(false);
  });

  it("reports safe validation paths when generated output fails Zod validation", () => {
    const result = z.object({ plan: z.string() }).safeParse({ plan: 42 });
    if (result.success) {
      throw new Error("Test setup expected invalid output.");
    }

    const classified = classifyAgentError(result.error);

    expect(classified).toMatchObject({
      code: "invalid_agent_output",
      retryable: false,
      summary: "The agent output failed server-side validation.",
      errorName: "ZodError",
    });
    expect(classified.validationPaths).toHaveLength(1);
    expect(classified.validationPaths?.[0]).toContain("plan");
    expect(classified.validationPaths?.[0]).not.toContain("42");
  });

  it("includes a bounded provider message without exposing API keys", () => {
    const key = "AIzaSyThisIsNotARealApiKey1234567890";
    const error = new APICallError({
      message: "Request failed",
      url: "https://generativelanguage.googleapis.com/",
      requestBodyValues: {},
      statusCode: 400,
      responseBody: JSON.stringify({
        error: { message: `Invalid API key: ${key}` },
      }),
      isRetryable: false,
    });

    const classified = classifyAgentError(error);

    expect(classified.providerStatusCode).toBe(400);
    expect(classified.providerMessage).toBe("Invalid API key: [REDACTED]");
    expect(classified.providerMessage).not.toContain(key);
  });
});
