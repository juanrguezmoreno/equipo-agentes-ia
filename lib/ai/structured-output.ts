import "server-only";

import { generateText, Output } from "ai";
import type { z } from "zod";
import { executeProviderAttempt } from "./provider-attempt";
import { getLanguageModel } from "./model";
import type { ProviderModel } from "./model-config";

export interface StructuredGenerationRequest {
  schema: z.ZodType;
  systemPrompt: string;
  prompt: string;
  maxOutputTokens: number;
  attemptNumber: number;
  onProviderSelected?: (target: ProviderModel) => void;
}

export async function generateStructuredOutput({
  schema,
  systemPrompt,
  prompt,
  maxOutputTokens,
  attemptNumber,
  onProviderSelected,
}: StructuredGenerationRequest): Promise<unknown> {
  const { value } = await executeProviderAttempt(
    attemptNumber,
    async (target) => {
      const { output } = await generateText({
        model: getLanguageModel(target),
        system: systemPrompt,
        prompt,
        output: Output.object({ schema }),
        maxOutputTokens,
        maxRetries: 0,
        timeout: 20_000,
        temperature: 0.2,
        ...(target.provider === "groq"
          ? {
              providerOptions: {
                groq: {
                  reasoningEffort: "low",
                  structuredOutputs: true,
                  strictJsonSchema: true,
                },
              },
            }
          : {}),
        telemetry: { isEnabled: false },
      });
      return output;
    },
    onProviderSelected,
  );

  return value;
}
