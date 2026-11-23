import {
  getAgentPresentation,
  type AgentName,
} from "@/lib/dashboard/presentation";
import type { Tables } from "@/types/database";

type Run = Tables<"agent_runs">;
type Task = Tables<"agent_tasks">;
type AgentEvent = Tables<"agent_events">;

const agents: Array<{
  id: AgentName;
  letter: string;
  role: string;
}> = [
  { id: "orchestrator", letter: "O", role: "Planifica y coordina" },
  { id: "develop", letter: "D", role: "Implementa en el proyecto" },
  { id: "testing", letter: "T", role: "Verifica y da feedback" },
];

const stateLabels = {
  active: "En marcha",
  waiting: "En espera",
  done: "Listo",
  error: "Con error",
  pending: "Pendiente",
} as const;

export default function AgentCards({
  run,
  tasks,
  events,
}: {
  run: Run | null;
  tasks: Task[];
  events: AgentEvent[];
}) {
  return (
    <section className="agent-section" aria-labelledby="agents-heading">
      <div className="section-heading">
        <div>
          <h2 id="agents-heading">Equipo de agentes</h2>
          <p className="section-subtitle">
            Estado actual y último mensaje de cada agente
          </p>
        </div>
      </div>
      <div className="agent-grid">
        {agents.map((agent) => {
          const presentation = getAgentPresentation(
            agent.id,
            run,
            tasks,
            events,
          );
          return (
            <article
              className="agent-card"
              data-state={presentation.state}
              key={agent.id}
              aria-label={`${agent.id}: ${stateLabels[presentation.state]}`}
            >
              <div className="agent-heading">
                <div className="agent-title-group">
                  <span className="agent-avatar" aria-hidden="true">
                    {agent.letter}
                  </span>
                  <div>
                    <h3 className="agent-name">
                      {agent.id === "orchestrator"
                        ? "Orquestador"
                        : agent.id === "develop"
                          ? "Develop"
                          : "Testing"}
                    </h3>
                    <p className="agent-role">{agent.role}</p>
                  </div>
                </div>
                <span
                  className="status-pill"
                  data-state={presentation.state}
                  aria-label={`Estado: ${stateLabels[presentation.state]}`}
                >
                  <span className="agent-state-dot" aria-hidden="true" />
                  {stateLabels[presentation.state]}
                </span>
              </div>
              <p className="agent-message" aria-live="polite">
                {presentation.message}
              </p>
              {presentation.provider && (
                <p
                  className="agent-model"
                  aria-label={`Último proveedor: ${presentation.provider.provider === "google" ? "Gemini" : "Groq"}, modelo ${presentation.provider.model}`}
                  title={
                    presentation.provider.outcome === "failed"
                      ? `Último intento fallido${presentation.provider.statusCode ? ` (HTTP ${presentation.provider.statusCode})` : ""}`
                      : "Último proveedor que generó una respuesta"
                  }
                >
                  {presentation.provider.provider === "google" ? "Gemini" : "Groq"}
                  <span aria-hidden="true"> · </span>
                  <code>{presentation.provider.model}</code>
                  {presentation.provider.outcome === "failed" && (
                    <span className="agent-model-error">
                      {presentation.provider.statusCode
                        ? ` · HTTP ${presentation.provider.statusCode}`
                        : " · error"}
                    </span>
                  )}
                </p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
