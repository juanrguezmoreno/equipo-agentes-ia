import { describe, expect, it } from "vitest";
import type { Tables } from "@/types/database";
import {
  describeApiError,
  describeApiErrorBody,
  describeClientError,
  describeEventSummary,
  describeRetryWait,
  describeRunFailure,
  formatWait,
} from "./user-messages";

type Run = Tables<"agent_runs">;
type AgentEvent = Tables<"agent_events">;

function run(overrides: Partial<Run>): Run {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    owner_id: "00000000-0000-4000-8000-000000000002",
    request: "Crea un README",
    status: "failed",
    schema_version: 1,
    max_task_iterations: 3,
    error_message: null,
    created_at: "2026-11-24T10:00:00.000Z",
    updated_at: "2026-11-24T10:00:10.000Z",
    ...overrides,
  };
}

let nextId = 1;
function event(overrides: Partial<AgentEvent>): AgentEvent {
  return {
    id: nextId++,
    run_id: "00000000-0000-4000-8000-000000000001",
    task_id: null,
    agent: "orchestrator",
    event_type: "agent_failed",
    input_summary: null,
    output_summary: null,
    metadata: {},
    created_at: "2026-11-24T10:00:05.000Z",
    ...overrides,
  };
}

describe("describeRunFailure", () => {
  it("ignores runs that did not fail", () => {
    expect(describeRunFailure(run({ status: "completed" }), [])).toBeNull();
  });

  it("explains an exhausted provider quota", () => {
    const failure = describeRunFailure(
      run({ error_message: "Agent step failed: rate_limited" }),
      [event({ agent: "develop", metadata: { errorCode: "rate_limited" } })],
    );
    expect(failure).toMatchObject({
      code: "rate_limited",
      title: "Cuota del proveedor agotada",
      action: "retry_run",
    });
    expect(failure?.detail).toContain("Develop");
    expect(failure?.detail).toContain("HTTP 429");
  });

  it("uses the last scheduled retry when the claim gave up without a code", () => {
    const failure = describeRunFailure(
      run({ error_message: "The agent step exhausted its retry limit." }),
      [
        event({ event_type: "retry_scheduled", metadata: { errorCode: "provider_timeout" } }),
        event({ event_type: "agent_failed", metadata: {} }),
      ],
    );
    expect(failure?.code).toBe("provider_timeout");
  });

  it("recognises the iteration limit", () => {
    const failure = describeRunFailure(
      run({ error_message: "Task iteration limit reached after failed testing." }),
      [],
    );
    expect(failure).toMatchObject({ code: "iteration_limit", action: "edit" });
  });

  it("falls back to a generic message for unknown codes", () => {
    const failure = describeRunFailure(
      run({ error_message: "Agent step failed: something_new" }),
      [],
    );
    expect(failure?.title).toBe("Un agente falló de forma inesperada");
  });
});

describe("describeRetryWait", () => {
  it("explains the cause and when the next attempt starts", () => {
    const now = Date.parse("2026-11-24T10:00:00.000Z");
    const wait = describeRetryWait(
      run({ status: "retry_wait" }),
      [
        event({
          event_type: "retry_scheduled",
          agent: "testing",
          metadata: {
            errorCode: "provider_error",
            attempt: 1,
            retryAt: "2026-11-24T10:00:04.000Z",
          },
        }),
      ],
      now,
    );
    expect(wait?.detail).toContain("Testing");
    expect(wait?.detail).toContain("saturados");
    expect(wait?.detail).toContain("en 4 s");
    expect(wait?.detail).toContain("intento 2 de 4");
    expect(wait?.retryAfterSeconds).toBe(4);
  });

  it("returns null outside retry_wait", () => {
    expect(describeRetryWait(run({ status: "running" }), [], null)).toBeNull();
  });
});

describe("API errors", () => {
  it("adds the waiting time to rate-limit messages", () => {
    const error = describeApiErrorBody({
      code: "run_rate_limited_hour",
      error: "x",
      retryAfterSeconds: 1500,
    });
    expect(error.title).toBe("Has alcanzado el límite por hora");
    expect(error.detail).toContain("en 25 min");
    expect(error.retryAfterSeconds).toBe(1500);
  });

  it("keeps the server's validation detail", () => {
    const error = describeApiErrorBody({
      code: "invalid_request",
      detail: "Describe la tarea con un poco más de detalle.",
    });
    expect(error.detail).toBe("Describe la tarea con un poco más de detalle.");
  });

  it("treats unknown codes and bodies safely", () => {
    expect(describeApiErrorBody({ code: "nope" }).code).toBe("server_error");
    expect(describeApiErrorBody("oops").code).toBe("invalid_response");
  });

  it("maps fetch failures", () => {
    expect(describeClientError(new TypeError("Failed to fetch")).code).toBe(
      "network_error",
    );
    expect(
      describeClientError(new DOMException("timed out", "TimeoutError")).code,
    ).toBe("request_timeout");
    const known = describeApiError("step_rate_limited");
    expect(describeClientError(known)).toBe(known);
  });

  it("formats waits", () => {
    expect(formatWait(0.2)).toBe("en 1 s");
    expect(formatWait(59)).toBe("en 59 s");
    expect(formatWait(61)).toBe("en 2 min");
    expect(formatWait(3600)).toBe("en 1 h");
    expect(formatWait(5400)).toBe("en 1 h 30 min");
  });
});

describe("describeEventSummary", () => {
  it("translates failure and retry events by error code", () => {
    expect(
      describeEventSummary(
        event({ event_type: "retry_scheduled", metadata: { errorCode: "rate_limited" } }),
      ),
    ).toContain("HTTP 429");
    expect(
      describeEventSummary(
        event({
          event_type: "agent_failed",
          output_summary: "The agent step exhausted its retry limit.",
        }),
      ),
    ).toBe("Se agotaron los reintentos del paso.");
  });

  it("leaves other events alone", () => {
    expect(
      describeEventSummary(event({ event_type: "step_started", metadata: { errorCode: "rate_limited" } })),
    ).toBeNull();
  });
});
