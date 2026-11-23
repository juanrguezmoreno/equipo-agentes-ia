import {
  DevelopmentOutputSchema,
  DevelopmentGenerationSchema,
  PlanGenerationSchema,
  PlanSchema,
  TestingReviewGenerationSchema,
  TestReportSchema,
  TestingReviewSchema,
  type DevelopmentOutput,
  type Plan,
  type TaskAcceptanceCriteria,
  type TestReport,
  type TestingReview,
} from "./schemas";
import type { ProviderModel } from "@/lib/ai/model-config";
import {
  DEVELOP_SYSTEM_PROMPT,
  ORCHESTRATOR_SYSTEM_PROMPT,
  TESTING_SYSTEM_PROMPT,
} from "./prompts";
import {
  generateStructuredOutput,
  type StructuredGenerationRequest,
} from "@/lib/ai/structured-output";
import { runDeterministicChecks } from "@/lib/validation/virtual-project";

export type StructuredGenerator = (
  request: StructuredGenerationRequest,
) => Promise<unknown>;

export interface AgentGenerationOptions {
  attemptNumber: number;
  onProviderSelected?: (target: ProviderModel) => void;
}

const MAX_PLAN_OUTPUT_TOKENS = 1800;
const MAX_DEVELOP_OUTPUT_TOKENS = 5000;
const MAX_REVIEW_OUTPUT_TOKENS = 1800;

export async function runOrchestrator(
  userRequest: string,
  generate: StructuredGenerator = generateStructuredOutput,
  generationOptions: AgentGenerationOptions = { attemptNumber: 1 },
): Promise<Plan> {
  const result = await generate({
    schema: PlanGenerationSchema,
    systemPrompt: ORCHESTRATOR_SYSTEM_PROMPT,
    prompt: JSON.stringify({ userRequest }),
    maxOutputTokens: MAX_PLAN_OUTPUT_TOKENS,
    ...generationOptions,
  });

  const generatedPlan = PlanGenerationSchema.parse(result);
  return PlanSchema.parse({
    ...generatedPlan,
    tasks: generatedPlan.tasks.map((task) => ({
      ...task,
      checks: task.checks.map(({ type, path, value }) => {
        switch (type) {
          case "file_exists":
            return { type, path };
          case "contains_text":
            return { type, path, text: value };
          case "exports_symbol":
            return { type, path, symbol: value };
        }
      }),
    })),
  });
}

export interface DevelopAgentInput {
  userRequest: string;
  task: {
    title: string;
    description: string;
    acceptanceCriteria: TaskAcceptanceCriteria;
    iteration: number;
    previousTestReport: unknown;
  };
  projectFiles: Record<string, string>;
}

export async function runDevelop(
  input: DevelopAgentInput,
  generate: StructuredGenerator = generateStructuredOutput,
  generationOptions: AgentGenerationOptions = { attemptNumber: 1 },
): Promise<DevelopmentOutput> {
  const result = await generate({
    schema: DevelopmentGenerationSchema,
    systemPrompt: DEVELOP_SYSTEM_PROMPT,
    prompt: JSON.stringify(input),
    maxOutputTokens: MAX_DEVELOP_OUTPUT_TOKENS,
    ...generationOptions,
  });

  return DevelopmentOutputSchema.parse(result);
}

export interface TestingAgentInput {
  userRequest: string;
  task: {
    title: string;
    description: string;
    acceptanceCriteria: TaskAcceptanceCriteria;
  };
  projectFiles: Record<string, string>;
  deterministicChecks: Array<{
    name: string;
    passed: boolean;
    details: string;
  }>;
}

export async function runTestingReview(
  input: TestingAgentInput,
  generate: StructuredGenerator = generateStructuredOutput,
  generationOptions: AgentGenerationOptions = { attemptNumber: 1 },
): Promise<TestingReview> {
  const result = await generate({
    schema: TestingReviewGenerationSchema,
    systemPrompt: TESTING_SYSTEM_PROMPT,
    prompt: JSON.stringify(input),
    maxOutputTokens: MAX_REVIEW_OUTPUT_TOKENS,
    ...generationOptions,
  });

  return TestingReviewSchema.parse(result);
}

export async function runTesting(
  input: Omit<TestingAgentInput, "deterministicChecks">,
  generate: StructuredGenerator = generateStructuredOutput,
  generationOptions: AgentGenerationOptions = { attemptNumber: 1 },
): Promise<TestReport> {
  const files = Object.entries(input.projectFiles).map(([path, content]) => ({
    path,
    content,
  }));
  const deterministicChecks = runDeterministicChecks(
    files,
    input.task.acceptanceCriteria.checks,
  );
  const failedChecks = deterministicChecks.filter((check) => !check.passed);

  if (failedChecks.length > 0) {
    return TestReportSchema.parse({
      passed: false,
      summary: `Testing blocked: ${failedChecks.length} deterministic check(s) failed.`,
      deterministicChecks,
      review: null,
    });
  }

  const review = await runTestingReview(
    { ...input, deterministicChecks },
    generate,
    generationOptions,
  );
  return TestReportSchema.parse({
    passed:
      deterministicChecks.every((check) => check.passed) && review.passed,
    summary: review.summary,
    deterministicChecks,
    review,
  });
}
