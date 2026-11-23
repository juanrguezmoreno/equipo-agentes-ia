import { TestReportSchema, type TestReport } from "@/lib/agents/schemas";
import type { Tables } from "@/types/database";

export type AgentName = "orchestrator" | "develop" | "testing";
export type AgentActivityState =
  | "active"
  | "waiting"
  | "done"
  | "error"
  | "pending";

export interface AgentProvider {
  provider: "google" | "groq";
  model: string;
  outcome: "succeeded" | "failed";
  statusCode?: number;
}

export interface AgentPresentation {
  state: AgentActivityState;
  message: string;
  provider: AgentProvider | null;
}

type Run = Tables<"agent_runs">;
type Task = Tables<"agent_tasks">;
type AgentEvent = Tables<"agent_events">;

const agentFallback: Record<AgentName, string> = {
  orchestrator: "Descompone tu petición en tareas con criterios verificables.",
  develop: "Implementa cada tarea en el proyecto virtual y guarda revisiones.",
  testing: "Combina comprobaciones deterministas con una revisión del resultado.",
};

const eventLabels: Record<string, string> = {
  run_created: "Petición recibida",
  step_started: "Paso iniciado",
  plan_completed: "Plan preparado",
  development_completed: "Cambios guardados",
  testing_passed: "Pruebas superadas",
  testing_failed: "Pruebas con hallazgos",
  provider_attempt: "Intento de proveedor",
  retry_scheduled: "Reintento programado",
  run_completed: "Ejecución completada",
  agent_failed: "Agente con error",
  workflow_failed: "Flujo detenido",
};

export function getAgentPresentation(
  agent: AgentName,
  run: Run | null,
  tasks: Task[],
  events: AgentEvent[],
): AgentPresentation {
  const agentEvents = events
    .filter((event) => event.agent === agent)
    .sort((left, right) => left.created_at.localeCompare(right.created_at));
  const lastEvent = agentEvents[agentEvents.length - 1];
  const message =
    lastEvent?.output_summary?.trim() ||
    lastEvent?.input_summary?.trim() ||
    agentFallback[agent];
  const provider = getAgentProvider(agentEvents);
  const present = (state: AgentActivityState, currentMessage: string) => ({
    state,
    message: currentMessage,
    provider,
  });

  if (!run) {
    return present("pending", agentFallback[agent]);
  }
  if (run.status === "completed") {
    return present("done", message);
  }

  const latestFailure = [...events]
    .filter((event) => event.event_type === "agent_failed")
    .sort((left, right) => right.created_at.localeCompare(left.created_at))[0];
  if (latestFailure?.agent === agent) {
    return present("error", message);
  }
  if (run.status === "retry_wait" && lastEvent) {
    return present("waiting", message);
  }
  if (
    agent !== "orchestrator" &&
    tasks.some((task) => task.status === (agent === "develop" ? "developing" : "testing"))
  ) {
    return present("active", message);
  }
  if (
    agent !== "orchestrator" &&
    tasks.length > 0 &&
    tasks.every((task) => task.status === "completed")
  ) {
    return present("done", message);
  }
  if (agent === "orchestrator" && run.status === "planning") {
    return present("active", message);
  }
  if (agentEvents.length > 0) {
    return present("waiting", message);
  }
  return present("pending", agentFallback[agent]);
}

function getAgentProvider(events: AgentEvent[]): AgentProvider | null {
  const latestEvent = events
    .filter((event) => event.event_type === "provider_attempt")
    .sort((left, right) => left.created_at.localeCompare(right.created_at))
    .at(-1);
  const metadata = latestEvent ? asRecord(latestEvent.metadata) : null;
  if (
    metadata === null ||
    (metadata.provider !== "google" && metadata.provider !== "groq") ||
    typeof metadata.model !== "string" ||
    (metadata.outcome !== "succeeded" && metadata.outcome !== "failed")
  ) {
    return null;
  }
  return {
    provider: metadata.provider,
    model: metadata.model,
    outcome: metadata.outcome,
    ...(typeof metadata.statusCode === "number"
      ? { statusCode: metadata.statusCode }
      : {}),
  };
}

export function getEventLabel(eventType: string): string {
  return (
    eventLabels[eventType] ??
    eventType
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ")
  );
}

export interface TestIteration {
  eventId: number;
  iteration: number;
  passed: boolean;
  summary: string;
  report: TestReport | null;
  createdAt: string;
}

export function getTestIteration(event: AgentEvent): TestIteration {
  const metadata = asRecord(event.metadata);
  const reportResult = TestReportSchema.safeParse(metadata?.report);
  const report = reportResult.success ? reportResult.data : null;
  const rawIteration = metadata?.iteration;

  return {
    eventId: event.id,
    iteration: typeof rawIteration === "number" ? rawIteration : 0,
    passed: report?.passed ?? event.event_type === "testing_passed",
    summary: report?.summary || event.output_summary || "Sin resumen disponible.",
    report,
    createdAt: event.created_at,
  };
}

export function getLatestTestReport(task: Task): TestReport | null {
  const result = TestReportSchema.safeParse(task.last_test_report);
  return result.success ? result.data : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}
