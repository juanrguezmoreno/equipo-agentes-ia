import {
  DevelopmentOutputSchema,
  PlanSchema,
  TestReportSchema,
  TestingReviewSchema,
  type DevelopmentOutput,
  type Plan,
  type TaskAcceptanceCriteria,
  type TestReport,
  type TestingReview,
} from "./schemas";
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

const MAX_PLAN_OUTPUT_TOKENS = 1800;
const MAX_DEVELOP_OUTPUT_TOKENS = 5000;
const MAX_REVIEW_OUTPUT_TOKENS = 1800;

export async function runOrchestrator(
  userRequest: string,
  generate: StructuredGenerator = generateStructuredOutput,
): Promise<Plan> {
  const result = await generate({
    schema: PlanSchema,
    systemPrompt: ORCHESTRATOR_SYSTEM_PROMPT,
    prompt: JSON.stringify({ userRequest }),
    maxOutputTokens: MAX_PLAN_OUTPUT_TOKENS,
  });

  return PlanSchema.parse(result);
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
): Promise<DevelopmentOutput> {
  const result = await generate({
    schema: DevelopmentOutputSchema,
    systemPrompt: DEVELOP_SYSTEM_PROMPT,
    prompt: JSON.stringify(input),
    maxOutputTokens: MAX_DEVELOP_OUTPUT_TOKENS,
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
): Promise<TestingReview> {
  const result = await generate({
    schema: TestingReviewSchema,
    systemPrompt: TESTING_SYSTEM_PROMPT,
    prompt: JSON.stringify(input),
    maxOutputTokens: MAX_REVIEW_OUTPUT_TOKENS,
  });

  return TestingReviewSchema.parse(result);
}

export async function runTesting(
  input: Omit<TestingAgentInput, "deterministicChecks">,
  generate: StructuredGenerator = generateStructuredOutput,
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
  );
  return TestReportSchema.parse({
    passed:
      deterministicChecks.every((check) => check.passed) && review.passed,
    summary: review.summary,
    deterministicChecks,
    review,
  });
}
