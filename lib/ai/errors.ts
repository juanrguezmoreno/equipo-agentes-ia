import { APICallError, NoObjectGeneratedError } from "ai";
import { ZodError } from "zod";

export interface ClassifiedAgentError {
  code: string;
  retryable: boolean;
  summary: string;
  retryAfterSeconds?: number;
  providerStatusCode?: number;
  providerMessage?: string;
  errorName?: string;
  validationPaths?: string[];
}

export function classifyAgentError(error: unknown): ClassifiedAgentError {
  if (APICallError.isInstance(error)) {
    const statusCode = error.statusCode;
    const retryable =
      statusCode === 408 ||
      statusCode === 425 ||
      statusCode === 429 ||
      statusCode === 500 ||
      statusCode === 502 ||
      statusCode === 503 ||
      statusCode === 504;
    return {
      code: statusCode === 429 ? "rate_limited" : "provider_error",
      retryable,
      summary:
        statusCode === 429
          ? "The model provider rate limit was reached."
          : "The model provider could not complete the request.",
      retryAfterSeconds: parseRetryAfter(error.responseHeaders),
      providerStatusCode: statusCode,
      providerMessage: getSafeProviderMessage(error),
    };
  }

  if (NoObjectGeneratedError.isInstance(error)) {
    return {
      code: "invalid_structured_output",
      retryable: false,
      summary: "The model did not return valid structured output.",
    };
  }

  if (error instanceof ZodError) {
    return {
      code: "invalid_agent_output",
      retryable: false,
      summary: "The agent output failed server-side validation.",
      errorName: error.name,
      validationPaths: error.issues
        .map((issue) => {
          const path = issue.path
            .map((part) => String(part).slice(0, 80))
            .join(".")
            .slice(0, 160);
          return `${path || "<root>"} [${issue.code}]: ${issue.message}`.slice(
            0,
            300,
          );
        })
        .filter(Boolean)
        .slice(0, 8),
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
    ...(error instanceof Error ? { errorName: error.name } : {}),
  };
}

function getSafeProviderMessage(error: APICallError): string {
  let message = error.message;
  if (error.responseBody) {
    try {
      const body: unknown = JSON.parse(error.responseBody);
      if (
        typeof body === "object" &&
        body !== null &&
        "error" in body &&
        typeof body.error === "object" &&
        body.error !== null &&
        "message" in body.error &&
        typeof body.error.message === "string"
      ) {
        message = body.error.message;
      }
    } catch {
      // Fall back to the SDK's sanitized error message.
    }
  }

  const secrets = [
    process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    process.env.GROQ_API_KEY,
  ].filter((value): value is string => Boolean(value));

  let safeMessage = message;
  for (const secret of secrets) {
    safeMessage = safeMessage.split(secret).join("[REDACTED]");
  }

  return safeMessage
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, "[REDACTED]")
    .replace(/\bgsk_[0-9A-Za-z_-]{20,}\b/g, "[REDACTED]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/([?&](?:key|api_key)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 500);
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
