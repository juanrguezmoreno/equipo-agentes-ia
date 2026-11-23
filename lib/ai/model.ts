import "server-only";

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { z } from "zod";

const ProviderSchema = z.enum(["google", "groq"]);

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getLanguageModel() {
  const providerResult = ProviderSchema.safeParse(
    process.env.AI_PROVIDER ?? "google",
  );
  if (!providerResult.success) {
    throw new Error("AI_PROVIDER must be either 'google' or 'groq'");
  }

  const modelId = process.env.AI_MODEL?.trim() || "gemini-4-hydrogen";

  switch (providerResult.data) {
    case "google": {
      const google = createGoogleGenerativeAI({
        apiKey: requiredEnv("GOOGLE_GENERATIVE_AI_API_KEY"),
      });
      return google(modelId);
    }
    case "groq": {
      const groq = createGroq({
        apiKey: requiredEnv("GROQ_API_KEY"),
      });
      return groq(modelId);
    }
  }
}
