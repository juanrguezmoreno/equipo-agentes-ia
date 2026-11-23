import {
  getLatestTestReport,
  getTestIteration,
} from "@/lib/dashboard/presentation";
import type { Tables } from "@/types/database";

type Task = Tables<"agent_tasks">;
type AgentEvent = Tables<"agent_events">;

const columns: Array<{
  status: Task["status"];
  label: string;
}> = [
  { status: "pending", label: "Pendiente" },
  { status: "developing", label: "En desarrollo" },
  { status: "testing", label: "En test" },
  { status: "failed", label: "Fallida" },
  { status: "completed", label: "Completada" },
];

const taskStatusLabels: Record<Task["status"], string> = {
  pending: "Pendiente",
  developing: "Desarrollando",
  testing: "En test",
  failed: "Fallida",
  completed: "Completada",
};

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
    <details className="iteration-report" open={initiallyOpen}>
      <summary>
        <span>
          Iteración {iteration.iteration || "—"} ·{" "}
          {report?.summary || iteration.summary}
        </span>
        <span className="report-result" data-passed={iteration.passed}>
          {iteration.passed ? "Aprobada" : "Hallazgos"}
        </span>
      </summary>
      <div className="report-body">
        {report ? (
          <>
            <p>{report.summary}</p>
            {checks.length > 0 && (
              <ul className="check-list" aria-label="Comprobaciones deterministas">
                {checks.map((check, index) => (
                  <li key={`${check.name}-${index}`}>
                    <span
                      className="check-indicator"
                      data-passed={check.passed}
                      aria-hidden="true"
                    >
                      {check.passed ? "✓" : "×"}
                    </span>
                    <span>
                      <strong>{check.name}:</strong> {check.details}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {report.review && (
              <p>
                <strong>Revisión del agente:</strong> {report.review.summary}
              </p>
            )}
            {findings.length > 0 && (
              <ul className="finding-list" aria-label="Hallazgos de la revisión">
                {findings.map((finding, index) => (
                  <li key={`${finding.criterion}-${index}`}>
                    <span className="finding-severity">{finding.severity}</span>
                    <span>
                      <strong>{finding.criterion}:</strong> {finding.message}
                      <br />
                      <span>Evidencia: {finding.evidence}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p>{iteration.summary}</p>
        )}
      </div>
    </details>
  );
}

function TaskCard({
  task,
  events,
}: {
  task: Task;
  events: AgentEvent[];
}) {
  const criteriaValue = task.acceptance_criteria;
  const criteria =
    typeof criteriaValue === "object" &&
    criteriaValue !== null &&
    !Array.isArray(criteriaValue) &&
    Array.isArray(criteriaValue.criteria)
      ? criteriaValue.criteria.filter(
          (criterion): criterion is string => typeof criterion === "string",
        )
      : [];
  const testEvents = events
    .filter(
      (event) =>
        event.task_id === task.id &&
        event.agent === "testing" &&
        ["testing_passed", "testing_failed"].includes(event.event_type),
    )
    .sort((left, right) => left.created_at.localeCompare(right.created_at));
  const latestLegacyReport = getLatestTestReport(task);

  return (
    <article className="task-card">
      <div className="task-heading">
        <span className="task-number">TAREA {String(task.sequence).padStart(2, "0")}</span>
        <span className="task-state-label" data-status={task.status}>
          {taskStatusLabels[task.status]}
        </span>
      </div>
      <h3>{task.title}</h3>
      <p className="task-description">{task.description}</p>
      <span className="iteration-pill">
        {task.iteration_count > 0
          ? `Iteración ${task.iteration_count}/${task.max_iterations}`
          : `Máximo ${task.max_iterations} iteraciones`}
      </span>
      {(criteria.length > 0 || testEvents.length > 0 || latestLegacyReport) && (
        <details className="task-details">
          <summary>
            {testEvents.length > 0 || latestLegacyReport
              ? "Criterios e informes de Testing"
              : "Criterios de aceptación"}
          </summary>
          {criteria.length > 0 && (
            <ul className="criteria-list">
              {criteria.map((criterion, index) => (
                <li key={`${criterion}-${index}`}>{criterion}</li>
              ))}
            </ul>
          )}
          {testEvents.length > 0 && (
            <div className="report-list">
              {testEvents.map((event, index) => (
                <TestReport
                  event={event}
                  fallbackReport={
                    index === testEvents.length - 1
                      ? latestLegacyReport
                      : null
                  }
                  initiallyOpen={index === testEvents.length - 1}
                  key={event.id}
                />
              ))}
            </div>
          )}
          {testEvents.length === 0 && latestLegacyReport && (
            <div className="report-body">
              <p>{latestLegacyReport.summary}</p>
              {latestLegacyReport.deterministicChecks.map((check, index) => (
                <p key={`${check.name}-${index}`}>
                  {check.passed ? "✓" : "×"} {check.name}: {check.details}
                </p>
              ))}
            </div>
          )}
        </details>
      )}
    </article>
  );
}

export default function TaskBoard({
  tasks,
  events,
}: {
  tasks: Task[];
  events: AgentEvent[];
}) {
  return (
    <section className="surface-panel" aria-labelledby="tasks-heading">
      <div className="panel-heading">
        <div>
          <h2 id="tasks-heading">Tablero de tareas</h2>
          <p className="section-subtitle">
            Iteraciones Develop ↔ Testing por tarea
          </p>
        </div>
        <span className="panel-heading-meta">
          {tasks.length} {tasks.length === 1 ? "tarea" : "tareas"}
        </span>
      </div>
      {tasks.length === 0 ? (
        <div className="code-empty">
          El Orquestador preparará el tablero al iniciar el plan.
        </div>
      ) : (
        <div className="task-board" aria-label="Tareas agrupadas por estado">
          {columns.map((column) => {
            const columnTasks = tasks
              .filter((task) => task.status === column.status)
              .sort((left, right) => left.sequence - right.sequence);
            return (
              <section className="task-column" key={column.status}>
                <div className="column-heading">
                  <span className="column-title">
                    <span
                      className="status-dot"
                      data-status={column.status}
                      aria-hidden="true"
                    />
                    {column.label}
                  </span>
                  <span className="column-count">{columnTasks.length}</span>
                </div>
                <div className="task-list">
                  {columnTasks.length > 0 ? (
                    columnTasks.map((task) => (
                      <TaskCard
                        events={events}
                        key={task.id}
                        task={task}
                      />
                    ))
                  ) : (
                    <div className="empty-column">Sin tareas</div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
