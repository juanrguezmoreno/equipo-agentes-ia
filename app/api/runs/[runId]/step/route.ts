import { classifyAgentError } from "@/lib/ai/errors";
import {
  runDevelop,
  runOrchestrator,
  runTesting,
} from "@/lib/agents";
import {
  ClaimedStepSchema,
  MAX_FILE_CONTENT_CHARS,
  MAX_FILES_PER_PROJECT,
  MAX_PROJECT_CONTEXT_CHARS,
  StepClaimResponseSchema,
} from "@/lib/agents/schemas";
import { retryDelayMs } from "@/lib/orchestration/state-machine";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser } from "@/lib/supabase/authenticated-user";
import type { Json } from "@/types/database";
import { z } from "zod";

export const maxDuration = 30;

const RunIdSchema = z.uuid();

interface RouteContext {
  params: Promise<{ runId: string }>;
}

export async function POST(_request: Request, { params }: RouteContext) {
  const { runId: rawRunId } = await params;
  const parsedRunId = RunIdSchema.safeParse(rawRunId);
  if (!parsedRunId.success) {
    return Response.json({ error: "Invalid run id." }, { status: 400 });
  }

  const { user, error: authError } = await getAuthenticatedUser();
  if (authError || !user) {
    const status = authError?.status && authError.status >= 500 ? 503 : 401;
    return Response.json({ error: "Authentication is required." }, { status });
  }

  const admin = createAdminClient();
  const { data: claimData, error: claimError } = await admin.rpc(
    "claim_next_agent_step",
    {
      p_run_id: parsedRunId.data,
      p_owner_id: user.id,
      p_lease_seconds: 45,
    },
  );

  if (claimError) {
    if (claimError.code === "P0002") {
      return Response.json({ error: "Run not found." }, { status: 404 });
    }

    console.error("Could not claim agent step.", {
      code: claimError.code,
      runId: parsedRunId.data,
    });
    return Response.json({ error: "Could not advance the run." }, { status: 500 });
  }

  const claim = StepClaimResponseSchema.safeParse(claimData);
  if (!claim.success) {
    console.error("Invalid step claim response.", {
      issues: claim.error.issues.map((issue) => issue.path.join(".")),
      runId: parsedRunId.data,
    });
    return Response.json({ error: "Could not advance the run." }, { status: 500 });
  }

  if (claim.data.status !== "claimed") {
    const httpStatus =
      claim.data.status === "waiting" || claim.data.status === "busy" ? 202 : 200;
    return Response.json(claim.data, { status: httpStatus });
  }

  const projectFiles: Record<string, string> = {};
  if (claim.data.agent !== "orchestrator") {
    const { data: artifacts, error: artifactsError } = await admin
      .from("artifacts")
      .select("path, revision, content")
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

    for (const artifact of artifacts) {
      if (!(artifact.path in projectFiles)) {
        projectFiles[artifact.path] = artifact.content;
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
  try {
    switch (claim.data.agent) {
      case "orchestrator":
        result = await runOrchestrator(claim.data.request);
        break;
      case "develop": {
        const task = requireTask(claim.data);
        const development = await runDevelop({
          userRequest: claim.data.request,
          task: {
            title: task.title,
            description: task.description,
            acceptanceCriteria: task.acceptanceCriteria,
            iteration: task.iteration,
            previousTestReport: task.previousTestReport,
          },
          projectFiles,
        });
        if (
          exceedsProjectLimits(projectFiles, development.files)
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
        result = development;
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
        });
        break;
      }
    }
  } catch (error) {
    const classified = classifyAgentError(error);
    console.error("Agent step failed.", {
      code: classified.code,
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
    return Response.json(
      { error: "The agent result could not be saved. Retry shortly." },
      { status: 500 },
    );
  }

  return Response.json({ status: "step_completed", completion });
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
    return Response.json(
      { error: "The agent step failed and its status could not be saved." },
      { status: 500 },
    );
  }

  const status =
    data && typeof data === "object" && "status" in data && data.status === "retry_wait"
      ? 202
      : 200;
  return Response.json(data, { status });
}
