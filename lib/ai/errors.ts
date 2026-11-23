import { APICallError, NoObjectGeneratedError } from "ai";

export interface ClassifiedAgentError {
  code: string;
  retryable: boolean;
  summary: string;
  retryAfterSeconds?: number;
}

export function classifyAgentError(error: unknown): ClassifiedAgentError {
  if (APICallError.isInstance(error)) {
    const statusCode = error.statusCode;
    return {
      code: statusCode === 429 ? "rate_limited" : "provider_error",
      retryable: error.isRetryable,
      summary:
        statusCode === 429
          ? "The model provider rate limit was reached."
          : "The model provider could not complete the request.",
      retryAfterSeconds: parseRetryAfter(error.responseHeaders),
    };
  }

  if (NoObjectGeneratedError.isInstance(error)) {
    return {
      code: "invalid_structured_output",
      retryable: false,
      summary: "The model did not return valid structured output.",
    };
  }

  if (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  ) {
    return {
      code: "provider_timeout",
      retryable: true,
      summary: "The model provider timed out.",
    };
  }

  return {
    code: "agent_step_error",
    retryable: false,
    summary: "The agent step could not be completed.",
  };
}

function parseRetryAfter(
  headers: Record<string, string> | undefined,
): number | undefined {
  if (!headers) {
    return undefined;
  }

  const value = Object.entries(headers).find(
    ([name]) => name.toLowerCase() === "retry-after",
  )?.[1];
  if (!value) {
    return undefined;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(1, Math.min(Math.ceil(seconds), 60));
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return undefined;
  }

  return Math.max(1, Math.min(Math.ceil((timestamp - Date.now()) / 1000), 60));
}
