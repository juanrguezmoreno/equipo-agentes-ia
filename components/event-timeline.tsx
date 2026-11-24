"use client";

import { isProviderId, providerLabel } from "@/lib/ai/provider-label";
import { describeEventSummary } from "@/lib/errors/user-messages";
import { useEffect, useState } from "react";
import { AgentIcon, identities } from "@/components/agent-identity";
import { getEventLabel } from "@/lib/dashboard/presentation";
import type { Tables } from "@/types/database";

type AgentEvent = Tables<"agent_events">;
type Task = Tables<"agent_tasks">;
type RealtimeState = "idle" | "connecting" | "connected" | "offline";

const realtimeLabels: Record<RealtimeState, string> = {
  connected: "En directo",
  connecting: "Conectando",
  offline: "Reconectando",
  idle: "Sin ejecución",
};

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "--:--:--"
    : new Intl.DateTimeFormat("es", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(date);
}

const secondsFormat = new Intl.NumberFormat("es", { maximumFractionDigits: 1 });

/** Provider attempts read better from their metadata than from the stored text. */
function getSummary(event: AgentEvent, tasks: Task[]): string | null {
  const metadata = event.metadata;
  if (
    event.event_type === "provider_attempt" &&
    typeof metadata === "object" &&
    metadata !== null &&
    !Array.isArray(metadata) &&
    typeof metadata.model === "string"
  ) {
    const provider = isProviderId(metadata.provider)
      ? providerLabel(metadata.provider)
      : "Proveedor";
    const result =
      metadata.outcome === "succeeded"
        ? "respondió"
        : typeof metadata.statusCode === "number"
          ? `falló con HTTP ${metadata.statusCode}`
          : "no respondió a tiempo";
    const duration =
      typeof metadata.durationMs === "number"
        ? ` en ${secondsFormat.format(metadata.durationMs / 1000)} s`
        : "";
    return `${provider} (${metadata.model}) ${result}${duration}`;
  }
  return describeEventSummary(event, tasks) ?? (event.output_summary || event.input_summary);
}

export default function EventTimeline({
  events,
  tasks,
  state,
  loading,
  runId,
}: {
  events: AgentEvent[];
  tasks: Task[];
  state: RealtimeState;
  loading: boolean;
  runId: string | null;
}) {
  const hasRun = runId !== null;
  // Entry motion only for events that arrive while a run is being watched.
  // "Live" switches on one frame after that run's history has rendered, so
  // neither the initial load nor switching runs slides the whole log in.
  const [liveRunId, setLiveRunId] = useState<string | null>(null);
  useEffect(() => {
    if (loading || runId === null) {
      return;
    }
    const frame = window.requestAnimationFrame(() => setLiveRunId(runId));
    return () => window.cancelAnimationFrame(frame);
  }, [loading, runId]);
  const live = !loading && runId !== null && liveRunId === runId;

  const newestFirst = [...events].reverse();

  return (
    <section className="panel log-panel" aria-labelledby="timeline-heading">
      <div className="panel-head">
        <h2 id="timeline-heading" className="panel-title">
          Registro
        </h2>
        <span className="realtime" data-state={state}>
          <span className="lamp" data-state={state === "connected" ? "live" : "pending"} aria-hidden="true" />
          {realtimeLabels[state]}
        </span>
      </div>
      {loading ? (
        <div className="log-skeleton" aria-hidden="true">
          <div className="skeleton skeleton-row" />
          <div className="skeleton skeleton-row" />
          <div className="skeleton skeleton-row" />
        </div>
      ) : newestFirst.length === 0 ? (
        <p className="empty-state">
          {hasRun
            ? "Todavía no hay pasos registrados. El primero aparecerá en cuanto el Orquestador empiece a planificar."
            : "Cuando lances una petición, cada paso de los agentes quedará anotado aquí con su hora, empezando por el más reciente."}
        </p>
      ) : (
        <ol
          className="log"
          data-live={live}
          role="log"
          aria-label="Actividad de los agentes, la más reciente primero"
          aria-live="polite"
          aria-relevant="additions"
          tabIndex={0}
        >
          {newestFirst.map((event) => {
            const summary = getSummary(event, tasks);
            return (
              <li className="log-item" data-agent={event.agent} key={event.id}>
                <time className="log-time" dateTime={event.created_at}>
                  {formatTime(event.created_at)}
                </time>
                <span className="log-icon">
                  <AgentIcon agent={event.agent} size={15} />
                </span>
                <div className="log-copy">
                  <p className="log-title">
                    <span className="log-agent">{identities[event.agent].name}</span>
                    {getEventLabel(event.event_type)}
                  </p>
                  {summary && <p className="log-summary">{summary}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
