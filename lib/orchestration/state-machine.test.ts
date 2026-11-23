import { describe, expect, it } from "vitest";
import {
  afterTesting,
  retryDelayMs,
  selectNextStep,
  type TaskProgress,
} from "./state-machine";

const task = (
  overrides: Partial<TaskProgress> = {},
): TaskProgress => ({
  id: "task-1",
  sequence: 1,
  status: "pending",
  iterationCount: 0,
  maxIterations: 3,
  dependencyIds: [],
  ...overrides,
});

describe("workflow state machine", () => {
  it("selects only a task whose dependencies have completed", () => {
    const tasks = [
      task({ id: "task-1", status: "pending" }),
      task({
        id: "task-2",
        sequence: 2,
        status: "pending",
        dependencyIds: ["task-1"],
      }),
    ];

    expect(selectNextStep("running", tasks)).toEqual({
      kind: "develop",
      taskId: "task-1",
      iteration: 1,
    });
    expect(
      selectNextStep("running", [
        { ...tasks[0], status: "completed" },
        tasks[1],
      ]),
    ).toEqual({
      kind: "develop",
      taskId: "task-2",
      iteration: 1,
    });
  });

  it("fails a task after its configured iteration limit", () => {
    const result = afterTesting(
      task({
        status: "testing",
        iterationCount: 3,
        maxIterations: 3,
      }),
      false,
    );

    expect(result.task.status).toBe("failed");
    expect(result.runStatus).toBe("failed");
  });

  it("uses bounded exponential retry delays and stops at the attempt limit", () => {
    expect(retryDelayMs(1, () => 0.5)).toBe(1000);
    expect(retryDelayMs(2, () => 0.5)).toBe(2000);
    expect(retryDelayMs(3, () => 0.5)).toBe(4000);
    expect(retryDelayMs(4, () => 0.5)).toBeNull();
  });

  it("adds bounded jitter to transient retry delays", () => {
    expect(retryDelayMs(1, () => 0)).toBe(750);
    expect(retryDelayMs(1, () => 1)).toBe(1250);
  });
});
