import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { APICallError, generateText, Output } from "ai";
import { PlanGenerationSchema } from "../lib/agents/schemas.ts";
import { ORCHESTRATOR_SYSTEM_PROMPT } from "../lib/agents/prompts.ts";
import { getGeminiModelId } from "../lib/ai/model-config.ts";

interface GoogleModel {
  name?: string;
  supportedGenerationMethods?: string[];
}

interface GoogleModelsResponse {
  models?: GoogleModel[];
  nextPageToken?: string;
  error?: { message?: string };
}

const apiKey = loadApiKey();
const modelId = getGeminiModelId();

if (apiKey) {
  await diagnose(apiKey);
}

function loadApiKey(): string | undefined {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    console.error("[setup] Could not load .env.local.");
    process.exitCode = 1;
    return undefined;
  }

  const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
  if (!key) {
    console.error("[setup] GOOGLE_GENERATIVE_AI_API_KEY is not configured.");
    process.exitCode = 1;
    return undefined;
  }
  return key;
}

async function diagnose(key: string): Promise<void> {
  const availableModels = await listAvailableModels(key);
  if (!availableModels) {
    return;
  }

  const configuredModel = availableModels.find(
    (model) =>
      model.name?.replace(/^models\//, "") === modelId &&
      model.supportedGenerationMethods?.includes("generateContent"),
  );

  console.log(
    `[models] ${availableModels
      .filter((model) =>
        model.supportedGenerationMethods?.includes("generateContent"),
      )
      .map((model) => model.name?.replace(/^models\//, ""))
      .filter(Boolean)
      .join(", ")}`,
  );
  console.log(
    `[model] ${modelId}: ${configuredModel ? "available" : "not available for generateContent"}`,
  );

  if (!configuredModel) {
    process.exitCode = 1;
    return;
  }

  const google = createGoogleGenerativeAI({ apiKey: key });
  const model = google(modelId);

  await runProbe("text", key, async () => {
    await generateText({
      model,
      prompt: "Di hola.",
      maxOutputTokens: 16,
      maxRetries: 0,
      timeout: 20_000,
      telemetry: { isEnabled: false },
    });
  });

  await runProbe("orchestrator-schema", key, async () => {
    await generateText({
      model,
      system: ORCHESTRATOR_SYSTEM_PROMPT,
      prompt: JSON.stringify({
        userRequest: "Crea un README breve para esta prueba de diagnóstico.",
      }),
      output: Output.object({ schema: PlanGenerationSchema }),
      maxOutputTokens: 1800,
      maxRetries: 0,
      timeout: 20_000,
      temperature: 0.2,
      telemetry: { isEnabled: false },
    });
  });
}

async function listAvailableModels(
  key: string,
): Promise<GoogleModel[] | undefined> {
  const models: GoogleModel[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL("https://generativelanguage.googleapis.com/v1beta/models");
    url.searchParams.set("pageSize", "1000");
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    let response: Response;
    try {
      response = await fetch(url, { headers: { "x-goog-api-key": key } });
    } catch (error) {
      reportError("models", error, key);
      return undefined;
    }

    const body = await response.text();
    const result = parseModelsResponse(body);
    if (!response.ok) {
      reportError(
        "models",
        new Error(result.error?.message ?? body),
        key,
        response.status,
      );
      return undefined;
    }

    models.push(...(result.models ?? []));
    pageToken = result.nextPageToken;
  } while (pageToken);

  return models;
}

function parseModelsResponse(body: string): GoogleModelsResponse {
  try {
    return JSON.parse(body) as GoogleModelsResponse;
  } catch {
    return {};
  }
}

async function runProbe(
  name: string,
  key: string,
  probe: () => Promise<unknown>,
): Promise<void> {
  try {
    await probe();
    console.log(`[${name}] succeeded`);
  } catch (error) {
    reportError(name, error, key);
    process.exitCode = 1;
  }
}

function reportError(
  name: string,
  error: unknown,
  key: string,
  statusCode?: number,
): void {
  const apiError = APICallError.isInstance(error) ? error : undefined;
  const status = statusCode ?? apiError?.statusCode ?? "unknown";
  const message =
    (apiError && getProviderMessage(apiError.responseBody)) ||
    (error instanceof Error ? error.message : String(error));
  console.error(`[${name}] HTTP ${status}: ${sanitize(message, key)}`);
}

function getProviderMessage(responseBody?: string): string | undefined {
  if (!responseBody) {
    return undefined;
  }
  try {
    const body: unknown = JSON.parse(responseBody);
    if (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "object" &&
      body.error !== null &&
      "message" in body.error &&
      typeof body.error.message === "string"
    ) {
      return body.error.message;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function sanitize(message: string, key: string): string {
  return message
    .split(key)
    .join("[REDACTED]")
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, "[REDACTED]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/([?&](?:key|api_key)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 1000);
}
