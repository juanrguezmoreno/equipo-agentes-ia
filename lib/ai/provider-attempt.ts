import { classifyAgentError } from "./errors";
import {
  getProviderModelChain,
  type AIProvider,
  type ModelEnvironment,
  type ProviderModel,
} from "./model-config";

/**
 * Per-call timeout for each provider. Gemini Flash-Lite can need ~15-20 s for
 * the largest Develop output; Groq is usually faster but queues under load.
 * Both are capped by the remaining invocation budget.
 */
export const PROVIDER_TIMEOUT_MS: Record<AIProvider, number> = {
  google: 25_000,
  groq: 30_000,
  mock: 10_000,
};

/** Below this remaining budget a provider call is not worth starting. */
export const MIN_PROVIDER_CALL_MS = 8_000;

export interface ProviderAttemptRecord {
  target: ProviderModel;
  outcome: "succeeded" | "failed";
  durationMs: number;
  statusCode?: number;
  errorCode?: string;
  retryable?: boolean;
}

export interface ProviderChainOptions {
  /** Total time the whole chain may spend calling providers. */
  budgetMs: number;
  env?: ModelEnvironment;
  now?: () => number;
  onAttempt?: (record: ProviderAttemptRecord) => void;
}

/**
 * Tries each configured provider in order within one invocation. Transient
 * failures (timeouts, 408/425/429/5xx) move straight to the next provider
 * without waiting; permanent failures stop the chain. If every provider fails
 * transiently, the last error is rethrown so the caller can persist a retry.
 */
export async function executeProviderChain<T>(
  invoke: (target: ProviderModel, timeoutMs: number) => Promise<T>,
  { budgetMs, env, now = Date.now, onAttempt }: ProviderChainOptions,
): Promise<{ target: ProviderModel; value: T }> {
  const deadline = now() + budgetMs;
  let lastError: unknown;

  for (const target of getProviderModelChain(env)) {
    const remaining = deadline - now();
    if (remaining < MIN_PROVIDER_CALL_MS) {
      break;
    }

    const timeoutMs = Math.min(PROVIDER_TIMEOUT_MS[target.provider], remaining);
    const startedAt = now();
    try {
      const value = await invoke(target, timeoutMs);
      onAttempt?.({
        target,
        outcome: "succeeded",
        durationMs: now() - startedAt,
      });
      return { target, value };
    } catch (error) {
      const classified = classifyAgentError(error);
      onAttempt?.({
        target,
        outcome: "failed",
        durationMs: now() - startedAt,
        statusCode: classified.providerStatusCode,
        errorCode: classified.code,
        retryable: classified.retryable,
      });
      if (!classified.retryable) {
        throw error;
      }
      lastError = error;
    }
  }

  if (lastError !== undefined) {
    throw lastError;
  }
  const exhausted = new Error("No provider time budget remained.");
  exhausted.name = "TimeoutError";
  throw exhausted;
}
