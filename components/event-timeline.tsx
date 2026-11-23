import { getEventLabel } from "@/lib/dashboard/presentation";
import type { Tables } from "@/types/database";

type AgentEvent = Tables<"agent_events">;

const agentMarks: Record<AgentEvent["agent"], string> = {
  orchestrator: "O",
  develop: "D",
  testing: "T",
  system: "·",
};

const agentNames: Record<AgentEvent["agent"], string> = {
  orchestrator: "Orquestador",
  develop: "Develop",
  testing: "Testing",
  system: "Sistema",
};

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Hora no disponible"
    : new Intl.DateTimeFormat("es", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(date);
}

export default function EventTimeline({
  events,
  connected,
  state,
}: {
  events: AgentEvent[];
  connected: boolean;
  state: "idle" | "connecting" | "connected" | "offline";
}) {
  return (
    <section className="surface-panel timeline-panel" aria-labelledby="timeline-heading">
      <div className="panel-heading">
        <div className="timeline-heading">
          <div>
            <h2 id="timeline-heading">Actividad en vivo</h2>
            <p className="section-subtitle">Registro cronológico de eventos</p>
          </div>
        </div>
        <span
          className="realtime-pill"
          data-state={state}
          aria-live="polite"
        >
          <span className="realtime-dot" aria-hidden="true" />
          {connected
            ? "En tiempo real"
            : state === "offline"
              ? "Reconectando"
              : state === "idle"
                ? "Sin ejecución"
                : "Conectando"}
        </span>
      </div>
      {events.length === 0 ? (
        <div className="timeline-empty">
          Aquí aparecerá la actividad de cada agente al iniciar una petición.
        </div>
      ) : (
        <ol
          className="timeline-list"
          role="log"
          aria-label="Actividad de los agentes"
          aria-live="polite"
          aria-relevant="additions text"
        >
          {events.map((event) => (
            <li className="timeline-item" key={event.id}>
              <span
                className="timeline-marker"
                data-agent={event.agent}
                aria-hidden="true"
              >
                {agentMarks[event.agent]}
              </span>
              <div className="timeline-copy">
                <strong>
                  {agentNames[event.agent]} · {getEventLabel(event.event_type)}
                </strong>
                {(event.output_summary || event.input_summary) && (
                  <p>{event.output_summary || event.input_summary}</p>
                )}
                <time className="event-time" dateTime={event.created_at}>
                  {formatTime(event.created_at)}
                </time>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
