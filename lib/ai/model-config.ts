export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
export const DEFAULT_GEMINI_FALLBACK_MODEL = "gemini-3.1-flash-lite";
export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-20b";

export type ModelEnvironment = Record<string, string | undefined>;

export type AIProvider = "google" | "groq";

export interface ProviderModel {
  provider: AIProvider;
  modelId: string;
}

export function getGeminiModelId(
  env: ModelEnvironment = process.env,
): string {
  return env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
}

export function getGeminiFallbackModelId(
  env: ModelEnvironment = process.env,
): string {
  return env.GEMINI_FALLBACK_MODEL?.trim() || DEFAULT_GEMINI_FALLBACK_MODEL;
}

export function getGroqModelId(env: ModelEnvironment = process.env): string {
  const legacyModel =
    env.AI_PROVIDER?.trim() === "groq" ? env.AI_MODEL?.trim() : undefined;
  return (
    env.GROQ_MODEL?.trim() ||
    legacyModel ||
    DEFAULT_GROQ_MODEL
  );
}

export function getProviderModelChain(
  env: ModelEnvironment = process.env,
): ProviderModel[] {
  const preferredProvider = env.AI_PROVIDER?.trim() || "google";
  if (preferredProvider !== "google" && preferredProvider !== "groq") {
    throw new Error("AI_PROVIDER must be either 'google' or 'groq'");
  }

  const googleModels = [
    { provider: "google", modelId: getGeminiModelId(env) },
    { provider: "google", modelId: getGeminiFallbackModelId(env) },
  ] satisfies ProviderModel[];
  const groqIsConfigured = isConfiguredApiKey(env.GROQ_API_KEY);
  if (preferredProvider === "groq" && !groqIsConfigured) {
    throw new Error("AI_PROVIDER=groq requires GROQ_API_KEY.");
  }

  const groqModel = {
    provider: "groq",
    modelId: getGroqModelId(env),
  } satisfies ProviderModel;
  const chain =
    preferredProvider === "groq"
      ? [groqModel, ...googleModels]
      : groqIsConfigured
        ? [...googleModels, groqModel]
        : googleModels;

  return chain.filter(
    (model, index) =>
      chain.findIndex(
        (candidate) =>
          candidate.provider === model.provider &&
          candidate.modelId === model.modelId,
      ) === index,
  );
}

export function getProviderModelForAttempt(
  attemptNumber: number,
  env: ModelEnvironment = process.env,
): ProviderModel {
  if (!Number.isInteger(attemptNumber) || attemptNumber < 1) {
    throw new Error("attemptNumber must be a positive integer");
  }

  const chain = getProviderModelChain(env);
  return chain[Math.min(attemptNumber - 1, chain.length - 1)];
}

function isConfiguredApiKey(value: string | undefined): boolean {
  const key = value?.trim();
  return Boolean(key && !/^your[-_ ]/i.test(key));
}
