import { providerLabel } from "@/lib/ai/provider-label";
import type { CSSProperties } from "react";
import { AgentIcon, identities, type StationId } from "@/components/agent-identity";
import {
  getAgentPresentation,
  getLatestTestReport,
  getTestIteration,
  type AgentActivityState,
  type AgentName,
} from "@/lib/dashboard/presentation";
import type { Tables } from "@/types/database";

type Run = Tables<"agent_runs">;
type Task = Tables<"agent_tasks">;
type AgentEvent = Tables<"agent_events">;

const stateLabels: Record<AgentActivityState, string> = {
  active: "Trabajando",
  waiting: "En espera",
  done: "Listo",
  error: "Con error",
  pending: "Sin empezar",
};

const taskStatusLabels: Record<Task["status"], string> = {
  pending: "En cola",
  developing: "Develop",
  testing: "Testing",
  completed: "Hecha",
  failed: "Fallida",
};

const stopAgents: StationId[] = ["orchestrator", "develop", "testing", "done"];

/** Position of a task on the track: 0 queue, 1 Develop, 2 Testing, 3 done. */
function getTaskStop(task: Task, events: AgentEvent[]): number {
  switch (task.status) {
    case "pending":
      return 0;
    case "developing":
      return 1;
    case "testing":
      return 2;
    case "completed":
      return 3;
    case "failed": {
      const lastAgent = events
        .filter(
          (event) =>
            event.task_id === task.id &&
            (event.agent === "develop" || event.agent === "testing"),
        )
        .sort((left, right) => left.created_at.localeCompare(right.created_at))
        .at(-1)?.agent;
      return lastAgent === "develop" ? 1 : 2;
    }
  }
}

function getCriteria(task: Task): string[] {
  const value = task.acceptance_criteria;
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Array.isArray(value.criteria)
    ? value.criteria.filter(
        (criterion): criterion is string => typeof criterion === "string",
      )
    : [];
}

function Station({
  agent,
  run,
  tasks,
  events,
}: {
  agent: AgentName;
  run: Run | null;
  tasks: Task[];
  events: AgentEvent[];
}) {
  const presentation = getAgentPresentation(agent, run, tasks, events);
  const provider = presentation.provider;
  const providerName = provider ? providerLabel(provider.provider) : "";

  return (
    <li className="station" data-agent={agent} data-state={presentation.state}>
      <div className="station-head">
        <span className="station-icon">
          <AgentIcon agent={agent} />
        </span>
        <div className="station-titles">
          <h3 className="station-name">{identities[agent].name}</h3>
          <p className="station-role">{identities[agent].role}</p>
        </div>
      </div>
      <p className="station-state">
        <span className="lamp" data-state={presentation.state} aria-hidden="true" />
        {stateLabels[presentation.state]}
      </p>
      <p className="station-message">{presentation.message}</p>
      {provider && (
        <p
          className="station-model"
          title={
            provider.outcome === "failed"
              ? "Último intento fallido; la cadena pasa al siguiente proveedor."
              : "Último proveedor que generó una respuesta"
          }
        >
          <span className="station-provider">{providerName}</span>
          <span className="station-model-id">{provider.model}</span>
          {provider.outcome === "failed" && (
            <span className="station-model-error">
              {provider.statusCode ? `HTTP ${provider.statusCode}` : "error"}
            </span>
          )}
        </p>
      )}
    </li>
  );
}

function DoneStation({ run, tasks }: { run: Run | null; tasks: Task[] }) {
  const completed = tasks.filter((task) => task.status === "completed").length;
  const state: AgentActivityState =
    run?.status === "completed"
      ? "done"
      : run?.status === "failed"
        ? "error"
        : completed > 0
          ? "waiting"
          : "pending";
  const label =
    run?.status === "completed"
      ? "Ejecución completada"
      : run?.status === "failed"
        ? "Ejecución detenida"
        : "Pendiente";

  return (
    <li className="station" data-agent="done" data-state={state}>
      <div className="station-head">
        <span className="station-icon">
          <AgentIcon agent="done" />
        </span>
        <div className="station-titles">
          <h3 className="station-name">{identities.done.name}</h3>
          <p className="station-role">{identities.done.role}</p>
        </div>
      </div>
      <p className="station-state">
        <span className="lamp" data-state={state} aria-hidden="true" />
        {label}
      </p>
      <p className="station-message">
        {tasks.length === 0
          ? "Aquí llegan las tareas cuando Testing las aprueba."
          : `${completed} de ${tasks.length} ${tasks.length === 1 ? "tarea aprobada" : "tareas aprobadas"}`}
      </p>
    </li>
  );
}

function TestReport({
  event,
  initiallyOpen,
  fallbackReport,
}: {
  event: AgentEvent;
  initiallyOpen: boolean;
  fallbackReport: ReturnType<typeof getLatestTestReport>;
}) {
  const iteration = getTestIteration(event);
  const report = iteration.report ?? fallbackReport;
  const checks = report?.deterministicChecks ?? [];
  const findings = report?.review?.findings ?? [];

  return (
    <details className="report" open={initiallyOpen}>
      <summary className="report-summary">
        <span className="report-iteration">
          Iteración {iteration.iteration || "sin número"}
        </span>
        <span className="report-result" data-passed={iteration.passed}>
          {iteration.passed ? "Aprobada" : "Con hallazgos"}
        </span>
      </summary>
      <div className="report-body">
        <p>{report?.summary || iteration.summary}</p>
        {checks.length > 0 && (
          <ul className="check-list" aria-label="Comprobaciones deterministas">
            {checks.map((check, index) => (
              <li key={`${check.name}-${index}`} data-passed={check.passed}>
                <span className="check-mark" aria-hidden="true">
                  {check.passed ? "✓" : "✕"}
                </span>
                <span>
                  <span className="sr-only">
                    {check.passed ? "Superada: " : "Fallida: "}
                  </span>
                  <code className="check-name">{check.name}</code>
                  <span className="check-details">{check.details}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        {report?.review && (
          <p className="review-summary">
            <strong>Revisión del modelo.</strong> {report.review.summary}
          </p>
        )}
        {findings.length > 0 && (
          <ul className="finding-list" aria-label="Hallazgos de la revisión">
            {findings.map((finding, index) => (
              <li key={`${finding.criterion}-${index}`}>
                <span className="finding-severity">{finding.severity}</span>
                <span>
                  <strong>{finding.criterion}.</strong> {finding.message}
                  <span className="finding-evidence">
                    Evidencia: {finding.evidence}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

function TaskLane({
  task,
  events,
  live,
}: {
  task: Task;
  events: AgentEvent[];
  live: boolean;
}) {
  const stop = getTaskStop(task, events);
  const stopAgent = stopAgents[stop];
  const criteria = getCriteria(task);
  const testEvents = events
    .filter(
      (event) =>
        event.task_id === task.id &&
        event.agent === "testing" &&
        (event.event_type === "testing_passed" ||
          event.event_type === "testing_failed"),
    )
    .sort((left, right) => left.created_at.localeCompare(right.created_at));
  const legacyReport = getLatestTestReport(task);
  const thinking =
    live && (task.status === "developing" || task.status === "testing");

  return (
    <li className="lane" data-status={task.status}>
      <div className="lane-head">
        <span className="lane-number" aria-hidden="true">
          T{task.sequence}
        </span>
        <h3 className="lane-title">
          <span className="sr-only">Tarea {task.sequence}: </span>
          {task.title}
        </h3>
        <span className="lane-iteration">
          {task.iteration_count > 0
            ? `Iteración ${task.iteration_count} de ${task.max_iterations}`
            : `Hasta ${task.max_iterations} iteraciones`}
        </span>
      </div>
      <div
        className="lane-rail"
        data-status={task.status}
      >
        <span className="sr-only">Estado: {taskStatusLabels[task.status]}</span>
        <span className="lane-ticks" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </span>
        {/* --stop is set on each moving element, not on the rail, so a
            change only restyles the two elements whose transform moves. */}
        <span
          className="lane-progress"
          style={{ "--stop": stop } as CSSProperties}
          aria-hidden="true"
        />
        <span
          className="lane-token"
          style={{ "--stop": stop } as CSSProperties}
          data-agent={stopAgent}
          data-status={task.status}
          data-thinking={thinking}
          aria-hidden="true"
        >
          <span className="lane-token-inner">
            <AgentIcon agent={stopAgent} size={15} />
            <span className="lane-token-label">{taskStatusLabels[task.status]}</span>
            {thinking && <span className="lane-token-pulse" />}
          </span>
        </span>
      </div>
      {(criteria.length > 0 || testEvents.length > 0 || legacyReport) && (
        <details className="lane-details">
          <summary className="lane-details-summary">
            {testEvents.length > 0 || legacyReport
              ? `Criterios e informes de Testing (${testEvents.length || 1})`
              : "Criterios de aceptación"}
          </summary>
          <div className="lane-details-body">
            {task.description && (
              <p className="lane-description">{task.description}</p>
            )}
            {criteria.length > 0 && (
              <div>
                <h4 className="detail-heading">Criterios de aceptación</h4>
                <ul className="criteria-list">
                  {criteria.map((criterion, index) => (
                    <li key={`${criterion}-${index}`}>{criterion}</li>
                  ))}
                </ul>
              </div>
            )}
            {testEvents.length > 0 && (
              <div className="report-list">
                <h4 className="detail-heading">Informes de Testing</h4>
                {testEvents.map((event, index) => (
                  <TestReport
                    event={event}
                    fallbackReport={
                      index === testEvents.length - 1 ? legacyReport : null
                    }
                    initiallyOpen={index === testEvents.length - 1}
                    key={event.id}
                  />
                ))}
              </div>
            )}
            {testEvents.length === 0 && legacyReport && (
              <div className="report-body">
                <p>{legacyReport.summary}</p>
              </div>
            )}
          </div>
        </details>
      )}
    </li>
  );
}

export default function RunTrack({
  run,
  tasks,
  events,
  live,
  loading,
}: {
  run: Run | null;
  tasks: Task[];
  events: AgentEvent[];
  live: boolean;
  loading: boolean;
}) {
  const orderedTasks = [...tasks].sort(
    (left, right) => left.sequence - right.sequence,
  );

  return (
    <section className="track" aria-labelledby="track-heading">
      <h2 id="track-heading" className="sr-only">
        Agentes y recorrido de las tareas
      </h2>
      <ol className="stations" aria-label="Agentes">
        <Station agent="orchestrator" run={run} tasks={tasks} events={events} />
        <Station agent="develop" run={run} tasks={tasks} events={events} />
        <Station agent="testing" run={run} tasks={tasks} events={events} />
        <DoneStation run={run} tasks={tasks} />
      </ol>

      <div className="lanes-wrap">
        <div className="lane-scale" aria-hidden="true">
          <span>Cola</span>
          <span>Develop</span>
          <span>Testing</span>
          <span>Hecha</span>
        </div>
        {loading ? (
          <div className="lanes" aria-hidden="true">
            <div className="skeleton skeleton-lane" />
            <div className="skeleton skeleton-lane" />
          </div>
        ) : orderedTasks.length === 0 ? (
          <p className="empty-state">
            {!run
              ? "Escribe una petición o prueba un ejemplo. El Orquestador la dividirá en tareas y verás cada una avanzar por la vía."
              : run.status === "failed" || run.status === "cancelled"
                ? "La ejecución se detuvo antes de que el Orquestador terminara el plan, así que no hay tareas. El aviso de arriba explica el motivo."
                : "El Orquestador está preparando el plan. Cada tarea aparecerá aquí como una ficha que avanza de Develop a Testing."}
          </p>
        ) : (
          <ol className="lanes" aria-label="Tareas">
            {orderedTasks.map((task) => (
              <TaskLane events={events} key={task.id} live={live} task={task} />
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
