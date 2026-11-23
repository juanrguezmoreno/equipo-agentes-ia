import { describe, expect, it } from "vitest";
import {
  getAgentPresentation,
  getEventLabel,
  getTestIteration,
} from "./presentation";
import type { Tables } from "@/types/database";

type Run = Tables<"agent_runs">;
type AgentEvent = Tables<"agent_events">;

const run: Run = {
  id: "run-id",
  owner_id: "owner-id",
  request: "Add a contact page",
  status: "running",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  error_message: null,
  max_task_iterations: 3,
  schema_version: 1,
};

function createEvent(overrides: Partial<AgentEvent>): AgentEvent {
  return {
    id: 1,
    run_id: run.id,
    task_id: null,
    agent: "testing",
    event_type: "testing_failed",
    input_summary: null,
    output_summary: "Falta el criterio de aceptación.",
    metadata: {},
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("dashboard presentation", () => {
  it("shows task statuses as the active Develop and Testing agents", () => {
    const task = {
      id: "task-id",
      run_id: run.id,
      sequence: 1,
      title: "Build contact page",
      description: "Add the page.",
      acceptance_criteria: { criteria: [], checks: [] },
      status: "testing",
      iteration_count: 2,
      max_iterations: 3,
      last_test_report: null,
      created_at: run.created_at,
      updated_at: run.updated_at,
    } satisfies Tables<"agent_tasks">;

    expect(getAgentPresentation("testing", run, [task], []).state).toBe("active");
    expect(getAgentPresentation("develop", run, [task], []).state).toBe("pending");
  });

  it("extracts a per-iteration report persisted in event metadata", () => {
    const event = createEvent({
      metadata: {
        iteration: 2,
        report: {
          passed: false,
          summary: "Falta mostrar el enlace de contacto.",
          deterministicChecks: [
            {
              name: "Página de contacto",
              passed: true,
              details: "El archivo existe.",
            },
          ],
          review: {
            passed: false,
            summary: "El enlace no aparece en la navegación.",
            findings: [],
          },
        },
      },
    });

    const presentation = getTestIteration(event);

    expect(presentation.iteration).toBe(2);
    expect(presentation.passed).toBe(false);
    expect(presentation.report?.review?.passed).toBe(false);
  });

  it("keeps a readable timeline label for unknown event types", () => {
    expect(getEventLabel("artifact_saved")).toBe("Artifact Saved");
  });

  it("shows the latest provider and model from agent event metadata", () => {
    const event = createEvent({
      agent: "orchestrator",
      event_type: "provider_attempt",
      output_summary: "Groq · openai/gpt-oss-20b · respuesta generada",
      metadata: {
        provider: "groq",
        model: "openai/gpt-oss-20b",
        attempt: 3,
        outcome: "succeeded",
      },
    });

    expect(getAgentPresentation("orchestrator", run, [], [event]).provider).toEqual({
      provider: "groq",
      model: "openai/gpt-oss-20b",
      outcome: "succeeded",
    });
    expect(getEventLabel("provider_attempt")).toBe("Intento de proveedor");
  });
});
