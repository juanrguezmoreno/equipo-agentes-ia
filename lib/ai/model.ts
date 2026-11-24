import "server-only";

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createMockLanguageModel } from "./mock-model";
import type { ProviderModel } from "./model-config";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getLanguageModel(target: ProviderModel) {
  switch (target.provider) {
    case "google": {
      const google = createGoogleGenerativeAI({
        apiKey: requiredEnv("GOOGLE_GENERATIVE_AI_API_KEY"),
      });
      return google(target.modelId);
    }
    case "groq": {
      const groq = createGroq({
        apiKey: requiredEnv("GROQ_API_KEY"),
      });
      return groq(target.modelId);
    }
    case "mock":
      return createMockLanguageModel();
  }
}
