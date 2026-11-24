import { classifyAgentError } from "@/lib/ai/errors";
import {
  runDevelop,
  runOrchestrator,
  runTesting,
} from "@/lib/agents";
import type { AgentGenerationOptions } from "@/lib/agents";
import type { ProviderAttemptRecord } from "@/lib/ai/provider-attempt";
import {
  ClaimedStepSchema,
  MAX_FILE_CONTENT_CHARS,
  MAX_FILES_PER_DEVELOPMENT,
  MAX_FILES_PER_PROJECT,
  MAX_PROJECT_CONTEXT_CHARS,
  StepClaimResponseSchema,
} from "@/lib/agents/schemas";
import { providerLabel } from "@/lib/ai/provider-label";
import {
  splitByScope,
  taskScope,
  type DeliveryGateInput,
} from "@/lib/agents/delivery-gate";
import { apiError } from "@/lib/http/api-error";
import { retryDelayMs } from "@/lib/orchestration/state-machine";
import { checkStepLimit } from "@/lib/rate-limit/check";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser } from "@/lib/supabase/authenticated-user";
import type { Json } from "@/types/database";
import { z } from "zod";

// Vercel Hobby allows up to 300 s with Fluid compute, but the step lease is
// capped at 60 s in Postgres; the invocation must finish before it expires.
export const maxDuration = 60;

const STEP_LEASE_SECONDS = 60;
// Time all provider calls may use, measured from the start of the request.
// The remainder covers auth, the claim, artifact loading and persistence.
const MODEL_BUDGET_MS = 45_000;

const RunIdSchema = z.uuid();

interface RouteContext {
  params: Promise<{ runId: string }>;
}

export async function POST(_request: Request, { params }: RouteContext) {
  const requestStartedAt = Date.now();
  const { runId: rawRunId } = await params;
  const parsedRunId = RunIdSchema.safeParse(rawRunId);
  if (!parsedRunId.success) {
    return apiError("invalid_run_id", 400);
  }

  const { user, error: authError } = await getAuthenticatedUser();
  if (authError || !user) {
    return authError?.status && authError.status >= 500
      ? apiError("auth_unavailable", 503)
      : apiError("auth_required", 401);
  }

  const admin = createAdminClient();
  // Checked before claiming: a claim creates the attempt row that this check
  // counts, and every claimed attempt may call up to three providers.
  const limit = await checkStepLimit(admin, user.id);
  if (
    !limit.allowed &&
    !(await onlyFinalizationRemains(admin, parsedRunId.data, user.id))
  ) {
    if (limit.code === "server_error") {
      console.error("Could not evaluate step rate limits.", {
        runId: parsedRunId.data,
      });
      return apiError("server_error", 503);
    }
    return apiError(limit.code, 429, {
      retryAfterSeconds: limit.retryAfterSeconds,
    });
  }

  const { data: claimData, error: claimError } = await admin.rpc(
    "claim_next_agent_step",
    {
      p_run_id: parsedRunId.data,
      p_owner_id: user.id,
      p_lease_seconds: STEP_LEASE_SECONDS,
    },
  );

  if (claimError) {
    if (claimError.code === "P0002") {
      return apiError("run_not_found", 404);
    }

    console.error("Could not claim agent step.", {
      code: claimError.code,
      runId: parsedRunId.data,
    });
    return apiError("server_error", 500);
  }

  const claim = StepClaimResponseSchema.safeParse(claimData);
  if (!claim.success) {
    console.error("Invalid step claim response.", {
      issues: claim.error.issues.map((issue) => issue.path.join(".")),
      runId: parsedRunId.data,
    });
    return apiError("server_error", 500);
  }

  if (claim.data.status !== "claimed") {
    const httpStatus =
      claim.data.status === "waiting" || claim.data.status === "busy" ? 202 : 200;
    return Response.json(claim.data, { status: httpStatus });
  }

  const projectFiles: Record<string, string> = {};
  const taskFilePaths: string[] = [];
  let allArtifacts: ArtifactRow[] = [];
  if (claim.data.agent !== "orchestrator") {
    const { data: artifacts, error: artifactsError } = await admin
      .from("artifacts")
      .select("path, revision, content, task_id, created_at")
      .eq("run_id", parsedRunId.data)
      .order("path", { ascending: true })
      .order("revision", { ascending: false });

    if (artifactsError) {
      console.error("Could not load virtual project files.", {
        code: artifactsError.code,
        runId: parsedRunId.data,
      });
      return recordFailure(
        admin,
        claim.data.attemptId,
        claim.data.attemptNumber,
        {
          code: "artifact_load_failed",
          retryable: true,
          summary: "The virtual project could not be loaded.",
        },
      );
    }

    allArtifacts = artifacts;
    for (const artifact of artifacts) {
      if (!(artifact.path in projectFiles)) {
        projectFiles[artifact.path] = artifact.content;
        // Latest revision first: these are the files this task last wrote.
        if (artifact.task_id && artifact.task_id === claim.data.task?.id) {
          taskFilePaths.push(artifact.path);
        }
      }
    }

    if (
      Object.keys(projectFiles).length > MAX_FILES_PER_PROJECT ||
      Object.values(projectFiles).some(
        (content) => content.length > MAX_FILE_CONTENT_CHARS,
      ) ||
      getProjectContentSize(projectFiles) > MAX_PROJECT_CONTEXT_CHARS
    ) {
      return recordFailure(
        admin,
        claim.data.attemptId,
        claim.data.attemptNumber,
        {
          code: "project_context_limit",
          retryable: false,
          summary: "The virtual project exceeds the supported context limit.",
        },
      );
    }
  }

  let result: Json;
  let scopeViolation: { paths: string[]; iteration: number } | null = null;
  const providerAttempts: ProviderAttemptRecord[] = [];
  const generationOptions: AgentGenerationOptions = {
    budgetMs: MODEL_BUDGET_MS - (Date.now() - requestStartedAt),
    onProviderAttempt: (record) => {
      providerAttempts.push(record);
    },
  };
  const providerEventContext = {
    runId: parsedRunId.data,
    taskId: claim.data.task?.id ?? null,
    agent: claim.data.agent,
    stepAttempt: claim.data.attemptNumber,
  };

  try {
    switch (claim.data.agent) {
      case "orchestrator":
        result = await runOrchestrator(
          claim.data.request,
          undefined,
          generationOptions,
        );
        break;
      case "develop": {
        const task = requireTask(claim.data);
        const scope = taskScope(task.acceptanceCriteria);
        const development = await runDevelop({
          userRequest: claim.data.request,
          task: {
            title: task.title,
            description: task.description,
            acceptanceCriteria: task.acceptanceCriteria,
            iteration: task.iteration,
            previousTestReport: task.previousTestReport,
            allowedFiles: scope,
          },
          projectFiles,
        }, undefined, generationOptions);
        // Develop may only write its task's files: anything else is never
        // stored, and Testing reports it (see delivery-gate.ts).
        const { allowed, outside } = splitByScope(development.files, scope);
        let files = allowed;
        if (outside.length > 0) {
          scopeViolation = { paths: outside.map((file) => file.path), iteration: task.iteration };
        }
        if (files.length === 0) {
          // The state machine needs a delivery to move on to Testing: resend
          // the task's current files unchanged so the violation is reported
          // and counted as an iteration.
          files = scope
            .filter((path) => path in projectFiles)
            .slice(0, MAX_FILES_PER_DEVELOPMENT)
            .map((path) => ({ path, content: projectFiles[path] }));
        }
        if (files.length === 0) {
          await recordProviderAttempts(admin, providerEventContext, providerAttempts);
          return recordFailure(admin, claim.data.attemptId, claim.data.attemptNumber, {
            code: "develop_out_of_scope",
            retryable: true,
            summary: "Develop only proposed files outside its task.",
          });
        }
        if (
          exceedsProjectLimits(projectFiles, files)
        ) {
          return recordFailure(
            admin,
            claim.data.attemptId,
            claim.data.attemptNumber,
            {
              code: "project_context_limit",
              retryable: false,
              summary: "The proposed files exceed the virtual project limits.",
            },
          );
        }
        result = { ...development, files };
        break;
      }
      case "testing": {
        const task = requireTask(claim.data);
        result = await runTesting({
          userRequest: claim.data.request,
          task: {
            title: task.title,
            description: task.description,
            acceptanceCriteria: task.acceptanceCriteria,
          },
          projectFiles,
          taskFilePaths,
          deliveryGate: await loadDeliveryGateInput(admin, task, allArtifacts),
        }, undefined, generationOptions);
        break;
      }
    }
  } catch (error) {
    const classified = classifyAgentError(error);
    await recordProviderAttempts(admin, providerEventContext, providerAttempts);
    console.error("Agent step failed.", {
      code: classified.code,
      errorName: classified.errorName,
      providerStatusCode: classified.providerStatusCode,
      providerMessage: classified.providerMessage,
      validationPaths: classified.validationPaths,
      providers: providerAttempts.map(
        (attempt) =>
          `${attempt.target.provider}:${attempt.target.modelId}:${attempt.statusCode ?? attempt.errorCode ?? attempt.outcome}:${attempt.durationMs}ms`,
      ),
      runId: parsedRunId.data,
      attemptId: claim.data.attemptId,
    });
    return recordFailure(
      admin,
      claim.data.attemptId,
      claim.data.attemptNumber,
      classified,
    );
  }

  await recordProviderAttempts(admin, providerEventContext, providerAttempts);

  const { data: completion, error: completionError } = await admin.rpc(
    "complete_agent_step",
    {
      p_attempt_id: claim.data.attemptId,
      p_result: result,
    },
  );

  if (completionError) {
    console.error("Could not persist agent step result.", {
      code: completionError.code,
      runId: parsedRunId.data,
      attemptId: claim.data.attemptId,
    });
    return apiError("step_persist_failed", 500);
  }

  if (scopeViolation) {
    const { error } = await admin.from("agent_events").insert({
      run_id: parsedRunId.data,
      task_id: claim.data.task?.id ?? null,
      agent: "develop",
      event_type: "scope_violation",
      output_summary:
        `Develop intentó escribir fuera de su tarea: ${scopeViolation.paths.join(", ")}. No se guardó.`.slice(0, 4000),
      metadata: { paths: scopeViolation.paths, iteration: scopeViolation.iteration },
    });
    if (error) {
      console.error("Could not record scope violation.", { code: error.code, runId: parsedRunId.data });
    }
  }

  return Response.json({ status: "step_completed", completion });
}

interface ProviderEventContext {
  runId: string;
  taskId: string | null;
  agent: z.infer<typeof ClaimedStepSchema>["agent"];
  stepAttempt: number;
}

async function recordProviderAttempts(
  admin: ReturnType<typeof createAdminClient>,
  context: ProviderEventContext,
  attempts: ProviderAttemptRecord[],
): Promise<void> {
  if (attempts.length === 0) {
    return;
  }

  const rows = attempts.map((attempt, index) => {
    const providerName = providerLabel(attempt.target.provider);
    const statusSummary =
      attempt.outcome === "failed"
        ? attempt.statusCode
          ? `HTTP ${attempt.statusCode}`
          : attempt.errorCode === "provider_timeout"
            ? "timeout"
            : "error"
        : "respuesta generada";
    return {
      run_id: context.runId,
      task_id: context.taskId,
      agent: context.agent,
      event_type: "provider_attempt",
      output_summary: `${providerName} (${attempt.target.modelId}): ${statusSummary}`,
      metadata: {
        provider: attempt.target.provider,
        model: attempt.target.modelId,
        attempt: context.stepAttempt,
        chainPosition: index + 1,
        outcome: attempt.outcome,
        durationMs: attempt.durationMs,
        ...(attempt.statusCode ? { statusCode: attempt.statusCode } : {}),
        ...(attempt.outcome === "failed"
          ? { retryable: attempt.retryable ?? false }
          : {}),
      },
    };
  });
  // One insert per row: rows in a single statement share now() and the
  // timeline would show the chain out of order.
  for (const row of rows) {
    const { error } = await admin.from("agent_events").insert(row);
    if (error) {
      console.error("Could not record provider attempt.", {
        code: error.code,
        runId: context.runId,
        stepAttempt: context.stepAttempt,
      });
      return;
    }
  }
}

/**
 * True when every task is already approved, so the next claim only marks the
 * run completed and calls no model. Rate limits must not hold that step back.
 */
async function onlyFinalizationRemains(
  admin: ReturnType<typeof createAdminClient>,
  runId: string,
  ownerId: string,
): Promise<boolean> {
  const [{ data: run }, { data: tasks, error: tasksError }] = await Promise.all([
    admin
      .from("agent_runs")
      .select("status")
      .eq("id", runId)
      .eq("owner_id", ownerId)
      .maybeSingle(),
    admin.from("agent_tasks").select("status").eq("run_id", runId),
  ]);
  return (
    run?.status === "running" &&
    !tasksError &&
    tasks !== null &&
    tasks.length > 0 &&
    tasks.every((task) => task.status === "completed")
  );
}

type ArtifactRow = {
  path: string;
  revision: number;
  content: string;
  task_id: string | null;
  created_at: string;
};

/**
 * Collects what the delivery gate needs for a Testing step: the files of the
 * task's latest Develop delivery (written in one transaction, so they share
 * the development_completed event's timestamp), their previous revisions, and
 * the scope violations recorded for this iteration.
 */
async function loadDeliveryGateInput(
  admin: ReturnType<typeof createAdminClient>,
  task: NonNullable<z.infer<typeof ClaimedStepSchema>["task"]>,
  artifacts: ArtifactRow[],
): Promise<DeliveryGateInput | undefined> {
  const { data: events, error } = await admin
    .from("agent_events")
    .select("event_type, created_at, metadata")
    .eq("task_id", task.id)
    .in("event_type", ["development_completed", "scope_violation"])
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    // Without the history the gate cannot decide; normal Testing still runs.
    console.error("Could not load delivery history.", { code: error.code, taskId: task.id });
    return undefined;
  }
  const deliveredAt = events.find((event) => event.event_type === "development_completed")?.created_at;
  const delivered = artifacts
    .filter((artifact) => artifact.task_id === task.id && artifact.created_at === deliveredAt)
    .map((artifact) => ({
      path: artifact.path,
      revision: artifact.revision,
      content: artifact.content,
      previousContent:
        artifacts.find(
          (other) => other.path === artifact.path && other.revision === artifact.revision - 1,
        )?.content ?? null,
    }));
  const outOfScopePaths = events
    .filter((event) => event.event_type === "scope_violation")
    .flatMap((event) => {
      const metadata = event.metadata as { paths?: unknown; iteration?: unknown } | null;
      return metadata?.iteration === task.iteration && Array.isArray(metadata.paths)
        ? metadata.paths.filter((path): path is string => typeof path === "string")
        : [];
    });
  return {
    iteration: task.iteration,
    delivered,
    outOfScopePaths: [...new Set(outOfScopePaths)],
    previousReport: task.previousTestReport,
  };
}

function requireTask(step: z.infer<typeof ClaimedStepSchema>) {
  if (!step.task) {
    throw new Error("Claimed task step is missing its task context.");
  }
  return step.task;
}

function getProjectContentSize(files: Record<string, string>): number {
  return Object.values(files).reduce((total, content) => total + content.length, 0);
}

function exceedsProjectLimits(
  existingFiles: Record<string, string>,
  changes: Array<{ path: string; content: string }>,
): boolean {
  const projectFiles = new Map(Object.entries(existingFiles));
  for (const file of changes) {
    projectFiles.set(file.path, file.content);
  }

  return (
    projectFiles.size > MAX_FILES_PER_PROJECT ||
    [...projectFiles.values()].some(
      (content) => content.length > MAX_FILE_CONTENT_CHARS,
    ) ||
    getProjectContentSize(Object.fromEntries(projectFiles)) >
      MAX_PROJECT_CONTEXT_CHARS
  );
}

async function recordFailure(
  admin: ReturnType<typeof createAdminClient>,
  attemptId: string,
  attemptNumber: number,
  failure: ReturnType<typeof classifyAgentError>,
) {
  const delayMs = retryDelayMs(attemptNumber);
  const retryable = failure.retryable && delayMs !== null;
  const retryAfterSeconds = failure.retryAfterSeconds ??
    (delayMs === null ? 1 : Math.ceil(delayMs / 1000));

  const { data, error } = await admin.rpc("fail_agent_step", {
    p_attempt_id: attemptId,
    p_error_code: failure.code,
    p_retryable: retryable,
    p_retry_after_seconds: retryAfterSeconds,
    p_error_summary: failure.summary,
  });

  if (error) {
    console.error("Could not persist agent step failure.", {
      code: error.code,
      attemptId,
    });
    return apiError("step_persist_failed", 500);
  }

  const status =
    data && typeof data === "object" && "status" in data && data.status === "retry_wait"
      ? 202
      : 200;
  return Response.json(data, { status });
}
