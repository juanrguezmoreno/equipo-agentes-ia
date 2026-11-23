import type { Database } from "@/types/database";

export type RunStatus = Database["public"]["Enums"]["run_status"];
export type TaskStatus = Database["public"]["Enums"]["task_status"];

export interface TaskProgress {
  id: string;
  sequence: number;
  status: TaskStatus;
  iterationCount: number;
  maxIterations: number;
  dependencyIds: string[];
}

export type NextStep =
  | { kind: "plan" }
  | { kind: "develop"; taskId: string; iteration: number }
  | { kind: "test"; taskId: string; iteration: number }
  | { kind: "complete" }
  | { kind: "failed"; reason: "task_failed" | "unresolved_dependencies" };

export function selectNextStep(
  runStatus: RunStatus,
  tasks: readonly TaskProgress[],
): NextStep {
  if (
    runStatus === "completed" ||
    runStatus === "failed" ||
    runStatus === "cancelled"
  ) {
    return runStatus === "completed"
      ? { kind: "complete" }
      : { kind: "failed", reason: "task_failed" };
  }

  if (tasks.some((task) => task.status === "failed")) {
    return { kind: "failed", reason: "task_failed" };
  }

  if (tasks.length === 0) {
    return { kind: "plan" };
  }

  const activeTasks = tasks
    .filter(
      (task) => task.status === "developing" || task.status === "testing",
    )
    .sort((left, right) => left.sequence - right.sequence);

  if (activeTasks.length > 0) {
    const [task] = activeTasks;
    return task.status === "developing"
      ? { kind: "develop", taskId: task.id, iteration: task.iterationCount }
      : { kind: "test", taskId: task.id, iteration: task.iterationCount };
  }

  const completedIds = new Set(
    tasks.filter((task) => task.status === "completed").map((task) => task.id),
  );
  const readyTask = tasks
    .filter(
      (task) =>
        task.status === "pending" &&
        task.dependencyIds.every((dependencyId) =>
          completedIds.has(dependencyId),
        ),
    )
    .sort((left, right) => left.sequence - right.sequence)[0];

  if (readyTask) {
    return {
      kind: "develop",
      taskId: readyTask.id,
      iteration: 1,
    };
  }

  if (tasks.every((task) => task.status === "completed")) {
    return { kind: "complete" };
  }

  return { kind: "failed", reason: "unresolved_dependencies" };
}

export function afterDevelopment(state: TaskProgress): TaskProgress {
  if (state.status !== "developing") {
    throw new Error(`Cannot finish development while task is ${state.status}`);
  }

  return { ...state, status: "testing" };
}

export function afterTesting(
  state: TaskProgress,
  passed: boolean,
): { task: TaskProgress; runStatus?: RunStatus } {
  if (state.status !== "testing") {
    throw new Error(`Cannot finish testing while task is ${state.status}`);
  }

  if (passed) {
    return { task: { ...state, status: "completed" } };
  }

  if (state.iterationCount < state.maxIterations) {
    return {
      task: {
        ...state,
        status: "developing",
        iterationCount: state.iterationCount + 1,
      },
    };
  }

  return {
    task: { ...state, status: "failed" },
    runStatus: "failed",
  };
}

export type RunEvent =
  | { type: "plan_completed" }
  | { type: "retry_scheduled" }
  | { type: "retry_started"; step: "plan" | "task" }
  | { type: "all_tasks_completed" }
  | { type: "terminal_failure" }
  | { type: "cancelled" };

export function transitionRunStatus(
  current: RunStatus,
  event: RunEvent,
): RunStatus {
  switch (event.type) {
    case "plan_completed":
      if (current !== "planning") {
        throw new Error(`Cannot complete a plan while run is ${current}`);
      }
      return "running";

    case "retry_scheduled":
      if (current !== "planning" && current !== "running") {
        throw new Error(`Cannot schedule a retry while run is ${current}`);
      }
      return "retry_wait";

    case "retry_started":
      if (current !== "retry_wait") {
        throw new Error(`Cannot start a retry while run is ${current}`);
      }
      return event.step === "plan" ? "planning" : "running";

    case "all_tasks_completed":
      if (current !== "running") {
        throw new Error(`Cannot complete tasks while run is ${current}`);
      }
      return "completed";

    case "terminal_failure":
      if (
        current === "completed" ||
        current === "failed" ||
        current === "cancelled"
      ) {
        throw new Error(`Cannot fail a terminal run (${current})`);
      }
      return "failed";

    case "cancelled":
      if (
        current === "completed" ||
        current === "failed" ||
        current === "cancelled"
      ) {
        throw new Error(`Cannot cancel a terminal run (${current})`);
      }
      return "cancelled";
  }
}

export const MAX_PROVIDER_ATTEMPTS = 4;

export function retryDelayMs(
  attemptNumber: number,
  random: () => number = Math.random,
): number | null {
  if (!Number.isInteger(attemptNumber) || attemptNumber < 1) {
    throw new Error("attemptNumber must be a positive integer");
  }

  if (attemptNumber >= MAX_PROVIDER_ATTEMPTS) {
    return null;
  }

  const jitter = random();
  if (jitter < 0 || jitter > 1) {
    throw new Error("random must return a value between 0 and 1");
  }

  const baseDelay = Math.min(1000 * 2 ** (attemptNumber - 1), 30_000);
  return Math.round(baseDelay * (0.75 + jitter * 0.5));
}
