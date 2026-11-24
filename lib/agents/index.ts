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
import type { ProviderAttemptRecord } from "@/lib/ai/provider-attempt";
import { alignCheckPaths } from "./plan-consistency";
import { evaluateDeliveryGate, type DeliveryGateInput } from "./delivery-gate";
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
  budgetMs: number;
  onProviderAttempt?: (record: ProviderAttemptRecord) => void;
}

const DEFAULT_GENERATION_OPTIONS: AgentGenerationOptions = { budgetMs: 45_000 };

// Room for up to 4 tasks with 2–4 criteria and checks each.
const MAX_PLAN_OUTPUT_TOKENS = 2600;
const MAX_DEVELOP_OUTPUT_TOKENS = 5000;
const MAX_REVIEW_OUTPUT_TOKENS = 1800;

export async function runOrchestrator(
  userRequest: string,
  generate: StructuredGenerator = generateStructuredOutput,
  generationOptions: AgentGenerationOptions = DEFAULT_GENERATION_OPTIONS,
): Promise<Plan> {
  const result = await generate({
    schema: PlanGenerationSchema,
    systemPrompt: ORCHESTRATOR_SYSTEM_PROMPT,
    prompt: JSON.stringify({ userRequest }),
    maxOutputTokens: MAX_PLAN_OUTPUT_TOKENS,
    ...generationOptions,
  });

  const generatedPlan = PlanGenerationSchema.parse(result);
  const validPlan = PlanSchema.parse({
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

  const { plan: aligned, repairs } = alignCheckPaths(validPlan);
  const plan = PlanSchema.parse(withDeclaredFilesAsChecks(aligned));
  if (repairs.length === 0) {
    return plan;
  }
  // Keep the repair visible in the log ("Plan preparado") and server logs.
  console.info("Aligned inconsistent check paths in a plan.", { repairs });
  const note = ` (Se alinearon ${repairs.length} ${
    repairs.length === 1 ? "ruta de comprobación" : "rutas de comprobación"
  } con el archivo de su tarea.)`;
  return PlanSchema.parse({
    ...plan,
    summary: `${plan.summary.slice(0, 1000 - note.length)}${note}`,
  });
}

/**
 * The plan RPC persists only criteria and checks, so each declared file
 * becomes a file_exists check (unless one exists). That stores the task's
 * scope without a migration: it is the set of paths the checks name.
 */
function withDeclaredFilesAsChecks(plan: Plan): Plan {
  return {
    ...plan,
    tasks: plan.tasks.map((task) => {
      const declared = new Set(
        task.checks.filter((check) => check.type === "file_exists").map((check) => check.path),
      );
      const missing = task.files.filter((file) => !declared.has(file));
      return missing.length === 0
        ? task
        : {
            ...task,
            checks: [
              ...missing.map((path) => ({ type: "file_exists" as const, path })),
              ...task.checks,
            ],
          };
    }),
  };
}

export interface DevelopAgentInput {
  userRequest: string;
  task: {
    title: string;
    description: string;
    acceptanceCriteria: TaskAcceptanceCriteria;
    iteration: number;
    previousTestReport: unknown;
    /** The only paths this task may write; anything else is discarded. */
    allowedFiles: string[];
  };
  projectFiles: Record<string, string>;
}

export async function runDevelop(
  input: DevelopAgentInput,
  generate: StructuredGenerator = generateStructuredOutput,
  generationOptions: AgentGenerationOptions = DEFAULT_GENERATION_OPTIONS,
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
  generationOptions: AgentGenerationOptions = DEFAULT_GENERATION_OPTIONS,
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
  input: Omit<TestingAgentInput, "deterministicChecks"> & {
    /** Files written by this task; convention checks apply only to them. */
    taskFilePaths?: readonly string[];
    /** Scope violations and resend detection; see delivery-gate.ts. */
    deliveryGate?: DeliveryGateInput;
  },
  generate: StructuredGenerator = generateStructuredOutput,
  generationOptions: AgentGenerationOptions = DEFAULT_GENERATION_OPTIONS,
): Promise<TestReport> {
  const { taskFilePaths, deliveryGate, ...reviewInput } = input;
  const gate = deliveryGate ? evaluateDeliveryGate(deliveryGate) : null;
  if (gate?.kind === "blocked") {
    return TestReportSchema.parse(gate.report);
  }

  const files = Object.entries(input.projectFiles).map(([path, content]) => ({
    path,
    content,
  }));
  const deterministicChecks = [
    ...(gate?.scopeChecks ?? []),
    ...runDeterministicChecks(files, input.task.acceptanceCriteria.checks, {
      conventionPaths: taskFilePaths,
    }),
  ];
  const failedChecks = deterministicChecks.filter((check) => !check.passed);

  if (failedChecks.length > 0) {
    return TestReportSchema.parse({
      passed: false,
      summary:
        failedChecks.length === 1
          ? `Testing bloqueó la entrega: falló 1 comprobación determinista (${failedChecks[0].name}).`
          : `Testing bloqueó la entrega: fallaron ${failedChecks.length} comprobaciones deterministas.`,
      deterministicChecks,
      review: null,
    });
  }

  const review = await runTestingReview(
    { ...reviewInput, deterministicChecks },
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
