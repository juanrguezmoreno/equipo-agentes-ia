import { z } from "zod";

export const MAX_TASKS_PER_RUN = 5;
export const MAX_TASK_ITERATIONS = 3;
export const MAX_FILES_PER_DEVELOPMENT = 4;
export const MAX_FILES_PER_PROJECT = 20;
export const MAX_FILE_CONTENT_CHARS = 16_000;
export const MAX_TOTAL_DEVELOPMENT_CONTENT_CHARS = 20_000;
export const MAX_PROJECT_CONTEXT_CHARS = 48_000;

export const VirtualPathSchema = z
  .string()
  .min(1)
  .max(240)
  .regex(/^[A-Za-z0-9._/-]+$/)
  .refine(
    (path) =>
      !path.startsWith("/") &&
      !path.endsWith("/") &&
      !path.includes("//") &&
      !path.split("/").some((segment) => segment === "." || segment === ".."),
    "Path must be relative and contain no empty or traversal segments",
  )
  .refine(
    (path) => /\.(?:ts|tsx|css|json|md)$/.test(path),
    "Only TypeScript, TSX, CSS, JSON and Markdown files are allowed",
  );

export const AcceptanceCheckSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("file_exists"),
      path: VirtualPathSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("contains_text"),
      path: VirtualPathSchema,
      text: z.string().min(1).max(240),
    })
    .strict(),
  z
    .object({
      type: z.literal("exports_symbol"),
      path: VirtualPathSchema,
      symbol: z
        .string()
        .regex(/^(?:default|[A-Za-z_$][A-Za-z0-9_$]{0,79})$/),
    })
    .strict(),
]);

export const TaskAcceptanceCriteriaSchema = z
  .object({
    criteria: z.array(z.string().trim().min(1).max(300)).min(1).max(6),
    checks: z.array(AcceptanceCheckSchema).min(1).max(8),
  })
  .strict();

export const PlannedTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(4000),
    acceptanceCriteria: z
      .array(z.string().trim().min(1).max(300))
      .min(1)
      .max(6),
    checks: z.array(AcceptanceCheckSchema).min(1).max(8),
    /**
     * Files this task may create or modify. Develop may write only these.
     * Persisted as file_exists checks (see runOrchestrator), so the task's
     * scope is the set of paths its checks name.
     */
    files: z.array(VirtualPathSchema).min(1).max(MAX_FILES_PER_DEVELOPMENT),
    dependsOn: z.array(z.number().int().positive().max(MAX_TASKS_PER_RUN)).max(4),
  })
  .strict()
  .refine((task) => new Set(task.files).size === task.files.length, {
    message: "Each file may be listed once per task",
    path: ["files"],
  });

export const PlanSchema = z
  .object({
    summary: z.string().trim().min(1).max(1000),
    tasks: z.array(PlannedTaskSchema).min(1).max(MAX_TASKS_PER_RUN),
  })
  .strict()
  .superRefine((plan, context) => {
    const graph = plan.tasks.map((task, index) => {
      const uniqueDependencies = new Set(task.dependsOn);

      if (uniqueDependencies.size !== task.dependsOn.length) {
        context.addIssue({
          code: "custom",
          message: "Dependencies must not be repeated",
          path: ["tasks", index, "dependsOn"],
        });
      }

      for (const dependency of task.dependsOn) {
        if (dependency > plan.tasks.length || dependency === index + 1) {
          context.addIssue({
            code: "custom",
            message: "Dependencies must reference another task in this plan",
            path: ["tasks", index, "dependsOn"],
          });
        }
      }

      return task.dependsOn.filter(
        (dependency) => dependency <= plan.tasks.length && dependency !== index + 1,
      );
    });

    const visiting = new Set<number>();
    const visited = new Set<number>();

    const visit = (taskIndex: number): void => {
      if (visiting.has(taskIndex)) {
        context.addIssue({
          code: "custom",
          message: "Task dependencies must not contain a cycle",
          path: ["tasks", taskIndex, "dependsOn"],
        });
        return;
      }

      if (visited.has(taskIndex)) {
        return;
      }

      visiting.add(taskIndex);
      for (const dependency of graph[taskIndex] ?? []) {
        visit(dependency - 1);
      }
      visiting.delete(taskIndex);
      visited.add(taskIndex);
    };

    for (let index = 0; index < plan.tasks.length; index += 1) {
      visit(index);
    }
  });

export const PlanGenerationSchema = z.object({
  summary: z.string(),
  tasks: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      acceptanceCriteria: z.array(z.string()),
      checks: z.array(
        z.object({
          type: z.enum(["file_exists", "contains_text", "exports_symbol"]),
          path: z.string(),
          value: z.string(),
        }).strict(),
      ),
      files: z.array(z.string()),
      dependsOn: z.array(z.number()),
    }).strict(),
  ),
}).strict();

export const DevelopmentOutputSchema = z
  .object({
    summary: z.string().trim().min(1).max(1000),
    files: z
      .array(
        z
          .object({
            path: VirtualPathSchema,
            content: z.string().min(1).max(MAX_FILE_CONTENT_CHARS),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_FILES_PER_DEVELOPMENT),
  })
  .strict()
  .superRefine((output, context) => {
    const paths = output.files.map((file) => file.path);
    if (new Set(paths).size !== paths.length) {
      context.addIssue({
        code: "custom",
        message: "Each file path may appear only once in a development result",
        path: ["files"],
      });
    }

    const totalCharacters = output.files.reduce(
      (total, file) => total + file.content.length,
      0,
    );
    if (totalCharacters > MAX_TOTAL_DEVELOPMENT_CONTENT_CHARS) {
      context.addIssue({
        code: "custom",
        message: `Development output must not exceed ${MAX_TOTAL_DEVELOPMENT_CONTENT_CHARS} total content characters`,
        path: ["files"],
      });
    }
  });

export const DevelopmentGenerationSchema = z.object({
  summary: z.string(),
  files: z.array(
    z.object({
      path: z.string(),
      content: z.string(),
    }).strict(),
  ),
}).strict();

export const ReviewFindingSchema = z
  .object({
    severity: z.enum(["critical", "major", "minor"]),
    criterion: z.string().trim().min(1).max(300),
    message: z.string().trim().min(1).max(1000),
    evidence: z.string().trim().min(1).max(1000),
  })
  .strict();

export const TestingReviewSchema = z
  .object({
    passed: z.boolean(),
    summary: z.string().trim().min(1).max(1000),
    findings: z.array(ReviewFindingSchema).max(12),
  })
  .strict();

export const TestingReviewGenerationSchema = z.object({
  passed: z.boolean(),
  summary: z.string(),
  findings: z.array(
    z.object({
      severity: z.enum(["critical", "major", "minor"]),
      criterion: z.string(),
      message: z.string(),
      evidence: z.string(),
    }).strict(),
  ),
}).strict();

export const DeterministicCheckResultSchema = z
  .object({
    name: z.string().trim().min(1).max(240),
    passed: z.boolean(),
    details: z.string().trim().min(1).max(1000),
  })
  .strict();

export const TestReportSchema = z
  .object({
    passed: z.boolean(),
    summary: z.string().trim().min(1).max(1000),
    deterministicChecks: z.array(DeterministicCheckResultSchema),
    review: TestingReviewSchema.nullable(),
  })
  .strict()
  .superRefine((report, context) => {
    const expectedPass =
      report.deterministicChecks.every((check) => check.passed) &&
      report.review?.passed === true;

    if (report.passed !== expectedPass) {
      context.addIssue({
        code: "custom",
        message: "A test report passes only when every deterministic check and the review pass",
        path: ["passed"],
      });
    }
  });

export const ClaimedStepSchema = z
  .object({
    status: z.literal("claimed"),
    attemptId: z.uuid(),
    agent: z.enum(["orchestrator", "develop", "testing"]),
    stepKey: z.string().min(1).max(160),
    attemptNumber: z.number().int().positive(),
    request: z.string().min(1).max(4000),
    task: z
      .object({
        id: z.uuid(),
        sequence: z.number().int().positive(),
        title: z.string().min(1).max(160),
        description: z.string().min(1).max(4000),
        acceptanceCriteria: TaskAcceptanceCriteriaSchema,
        iteration: z.number().int().positive(),
        maxIterations: z.number().int().positive().max(5),
        previousTestReport: z.unknown(),
      })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((step, context) => {
    if (step.agent === "orchestrator" && step.task !== null) {
      context.addIssue({
        code: "custom",
        message: "The orchestrator plan step cannot have a task",
        path: ["task"],
      });
    }

    if (step.agent !== "orchestrator" && step.task === null) {
      context.addIssue({
        code: "custom",
        message: "Develop and Testing steps require a task",
        path: ["task"],
      });
    }
  });

export const StepClaimResponseSchema = z.discriminatedUnion("status", [
  ClaimedStepSchema,
  z
    .object({
      status: z.literal("busy"),
      leaseExpiresAt: z.string(),
    })
    .strict(),
  z
    .object({
      status: z.literal("waiting"),
      retryAt: z.string(),
    })
    .strict(),
  z.object({ status: z.literal("completed") }).strict(),
  z
    .object({
      status: z.literal("failed"),
      error: z.string().optional(),
    })
    .strict(),
  z.object({ status: z.literal("cancelled") }).strict(),
]);

export type AcceptanceCheck = z.infer<typeof AcceptanceCheckSchema>;
export type TaskAcceptanceCriteria = z.infer<typeof TaskAcceptanceCriteriaSchema>;
export type PlannedTask = z.infer<typeof PlannedTaskSchema>;
export type Plan = z.infer<typeof PlanSchema>;
export type DevelopmentOutput = z.infer<typeof DevelopmentOutputSchema>;
export type TestingReview = z.infer<typeof TestingReviewSchema>;
export type DeterministicCheckResult = z.infer<
  typeof DeterministicCheckResultSchema
>;
export type TestReport = z.infer<typeof TestReportSchema>;
export type ClaimedStep = z.infer<typeof ClaimedStepSchema>;
