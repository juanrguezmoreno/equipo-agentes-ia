import "server-only";

import { generateText, Output } from "ai";
import type { z } from "zod";
import {
  executeProviderChain,
  type ProviderAttemptRecord,
} from "./provider-attempt";
import { getLanguageModel } from "./model";

export interface StructuredGenerationRequest {
  schema: z.ZodType;
  systemPrompt: string;
  prompt: string;
  maxOutputTokens: number;
  /** Time the provider chain may spend in this invocation. */
  budgetMs: number;
  onProviderAttempt?: (record: ProviderAttemptRecord) => void;
}

export async function generateStructuredOutput({
  schema,
  systemPrompt,
  prompt,
  maxOutputTokens,
  budgetMs,
  onProviderAttempt,
}: StructuredGenerationRequest): Promise<unknown> {
  const { value } = await executeProviderChain(
    async (target, timeoutMs) => {
      const { output } = await generateText({
        model: getLanguageModel(target),
        system: systemPrompt,
        prompt,
        output: Output.object({ schema }),
        maxOutputTokens,
        maxRetries: 0,
        timeout: timeoutMs,
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
    { budgetMs, onAttempt: onProviderAttempt },
  );

  return value;
}
