import type { Page, Route } from "@playwright/test";
import type { Tables } from "../types/database";

/**
 * In-browser fake of everything the dashboard talks to: our API routes,
 * Supabase PostgREST reads and the Realtime socket. Tests that only check how
 * the UI handles a scenario (failures, rate limits) use it, so they create no
 * runs and no anonymous users in the real Supabase project.
 *
 * The rows mirror what the real RPCs write (same columns, event types and
 * metadata), so the UI code under test is exactly the production code.
 */

type Run = Tables<"agent_runs">;
type AgentEvent = Tables<"agent_events">;

export type FakeScenario =
  /** Every provider call hits HTTP 429; the 4th attempt fails the run. */
  | "quota"
  /** The model returns malformed output: permanent failure on attempt 1. */
  | "malformed"
  /** POST /api/runs is rejected by the per-user daily limit. */
  | "rate_limited_day";

const OWNER_ID = "00000000-0000-4000-8000-00000000e2e0";
const MAX_ATTEMPTS = 4;

export async function useFakeBackend(page: Page, scenario: FakeScenario) {
  const runs: Run[] = [];
  const events: AgentEvent[] = [];
  let eventId = 1;
  let attempt = 0;
  let clock = Date.now();

  const now = () => {
    clock = Math.max(clock + 5, Date.now());
    return new Date(clock).toISOString();
  };

  function addEvent(
    run: Run,
    partial: Pick<AgentEvent, "agent" | "event_type"> & Partial<AgentEvent>,
  ) {
    events.push({
      id: eventId++,
      run_id: run.id,
      task_id: null,
      input_summary: null,
      output_summary: null,
      metadata: {},
      created_at: now(),
      ...partial,
    });
  }

  function updateRun(run: Run, patch: Partial<Run>) {
    Object.assign(run, patch, { updated_at: now() });
  }

  // Realtime: accept the socket and never answer. The client times out the
  // join, marks itself offline and keeps refetching, which is what a broken
  // socket looks like in production too.
  await page.routeWebSocket(/\/realtime\/v1\//, () => {});

  await page.route("**/rest/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const table = url.pathname.split("/rest/v1/")[1];
    const eq = (name: string) => url.searchParams.get(name)?.replace(/^eq\./, "");
    const runId = eq("run_id");
    let rows: unknown[] = [];
    if (table === "agent_runs") {
      const id = eq("id");
      rows = runs
        .filter((run) => !id || run.id === id)
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
    } else if (table === "agent_events") {
      const descending = url.searchParams.get("order")?.includes("desc") ?? false;
      rows = events
        .filter((event) => event.run_id === runId)
        .sort((a, b) => (descending ? b.id - a.id : a.id - b.id));
    }
    // agent_tasks and artifacts stay empty: the scenarios fail before a plan.
    await route.fulfill({ json: rows });
  });

  await page.route("**/api/runs", async (route) => {
    if (route.request().method() !== "POST") {
      return route.fallback();
    }
    if (scenario === "rate_limited_day") {
      return fulfillApiError(route, 429, {
        code: "run_rate_limited_day",
        error: "Has alcanzado el límite diario",
        retryAfterSeconds: 20 * 3600,
      });
    }
    const body = route.request().postDataJSON() as { request: string };
    const createdAt = now();
    const run: Run = {
      id: crypto.randomUUID(),
      owner_id: OWNER_ID,
      request: body.request,
      status: "planning",
      schema_version: 1,
      max_task_iterations: 3,
      error_message: null,
      created_at: createdAt,
      updated_at: createdAt,
    };
    runs.push(run);
    addEvent(run, {
      agent: "system",
      event_type: "run_created",
      output_summary: "A new agent run was created.",
    });
    await route.fulfill({ status: 201, json: { runId: run.id } });
  });

  await page.route("**/api/runs/*/step", async (route) => {
    const runId = new URL(route.request().url()).pathname.split("/")[3];
    const run = runs.find((candidate) => candidate.id === runId);
    if (!run) {
      return fulfillApiError(route, 404, { code: "run_not_found", error: "x" });
    }
    if (run.status === "failed") {
      return route.fulfill({ json: { status: "failed" } });
    }

    attempt += 1;
    updateRun(run, { status: "planning" });
    addEvent(run, {
      agent: "orchestrator",
      event_type: "step_started",
      input_summary: "Create an ordered task plan.",
      metadata: { attempt },
    });

    const errorCode = scenario === "quota" ? "rate_limited" : "invalid_structured_output";
    addEvent(run, {
      agent: "orchestrator",
      event_type: "provider_attempt",
      output_summary: "Simulado (mock-agents): error",
      metadata: {
        provider: "mock",
        model: "mock-agents",
        attempt,
        chainPosition: 1,
        outcome: "failed",
        durationMs: 900,
        retryable: scenario === "quota",
        ...(scenario === "quota" ? { statusCode: 429 } : {}),
      },
    });

    if (scenario === "quota" && attempt < MAX_ATTEMPTS) {
      const retryAt = new Date(Date.now() + 1_500).toISOString();
      updateRun(run, { status: "retry_wait", error_message: null });
      addEvent(run, {
        agent: "orchestrator",
        event_type: "retry_scheduled",
        output_summary: "The model provider rate limit was reached.",
        metadata: { attempt, retryAt, errorCode },
      });
      return route.fulfill({ status: 202, json: { status: "retry_wait", retryAt } });
    }

    updateRun(run, {
      status: "failed",
      error_message: `Agent step failed: ${errorCode}`,
    });
    addEvent(run, {
      agent: "orchestrator",
      event_type: "agent_failed",
      output_summary:
        scenario === "quota"
          ? "The model provider rate limit was reached."
          : "The model did not return valid structured output.",
      metadata: { attempt, errorCode },
    });
    return route.fulfill({ json: { status: "failed" } });
  });
}

function fulfillApiError(
  route: Route,
  status: number,
  body: { code: string; error: string; retryAfterSeconds?: number },
) {
  return route.fulfill({
    status,
    json: body,
    headers: body.retryAfterSeconds
      ? { "Retry-After": String(body.retryAfterSeconds) }
      : undefined,
  });
}
