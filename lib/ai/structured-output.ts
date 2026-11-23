import "server-only";

import { generateText, Output } from "ai";
import type { z } from "zod";
import { getLanguageModel } from "./model";

export interface StructuredGenerationRequest {
  schema: z.ZodType;
  systemPrompt: string;
  prompt: string;
  maxOutputTokens: number;
}

export async function generateStructuredOutput({
  schema,
  systemPrompt,
  prompt,
  maxOutputTokens,
}: StructuredGenerationRequest): Promise<unknown> {
  const { output } = await generateText({
    model: getLanguageModel(),
    system: systemPrompt,
    prompt,
    output: Output.object({ schema }),
    maxOutputTokens,
    maxRetries: 0,
    timeout: 20_000,
    temperature: 0.2,
    telemetry: { isEnabled: false },
  });

  return output;
}
