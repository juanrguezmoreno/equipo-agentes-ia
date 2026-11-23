"use client";

import { z } from "zod";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import CodeViewer from "@/components/code-viewer";
import EventTimeline from "@/components/event-timeline";
import RunTrack from "@/components/run-track";
import ThemeToggle from "@/components/theme-toggle";
import { CreateRunSchema } from "@/lib/agents/schemas";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@/types/database";

type SupabaseClient = ReturnType<typeof createClient>;
type Run = Tables<"agent_runs">;
type Task = Tables<"agent_tasks">;
type Artifact = Tables<"artifacts">;
type AgentEvent = Tables<"agent_events">;
type RealtimeState = "idle" | "connecting" | "connected" | "offline";

const examples = [
  {
    label: "README de lanzamiento",
    request:
      "Crea un README.md con el título «Notas de lanzamiento» y las secciones Resumen, Cambios y Próximos pasos.",
  },
  {
    label: "Página de contacto",
    request:
      "Añade una página de contacto con un formulario accesible y datos de contacto de ejemplo.",
  },
  {
    label: "Paleta CSS accesible",
    request:
      "Crea una hoja de estilos CSS con una paleta accesible para una interfaz de tareas.",
  },
];

const timeFormat = new Intl.DateTimeFormat("es", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function formatDuration(run: Run): string | null {
  const elapsed = Date.parse(run.updated_at) - Date.parse(run.created_at);
  if (!Number.isFinite(elapsed) || elapsed < 0) {
    return null;
  }
  const seconds = Math.round(elapsed / 1000);
  return seconds < 60
    ? `${seconds} s`
    : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

function runLampState(run: Run): "done" | "error" | "waiting" | "active" {
  switch (run.status) {
    case "completed":
      return "done";
    case "failed":
    case "cancelled":
      return "error";
    case "retry_wait":
      return "waiting";
    case "planning":
    case "running":
      return "active";
  }
}

const RunResponseSchema = z.object({ runId: z.uuid() });
const MAX_BROWSER_STEPS = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatRunLabel(run: Run): string {
  const prompt = run.request.replace(/\s+/g, " ").trim();
  const shortPrompt = prompt.length > 44 ? `${prompt.slice(0, 44)}…` : prompt;
  const date = new Date(run.created_at);
  const time = Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat("es", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
  return time ? `${time}, ${shortPrompt}` : shortPrompt;
}

function getDelayUntil(value: unknown): number {
  if (typeof value !== "string") {
    return 2_000;
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return 2_000;
  }
  return Math.max(500, Math.min(timestamp - Date.now(), 45_000));
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function runStatusLabel(run: Run): string {
  switch (run.status) {
    case "planning":
      return "Planificando";
    case "running":
      return "En ejecución";
    case "retry_wait":
      return "Esperando reintento";
    case "completed":
      return "Completada";
    case "failed":
      return "Fallida";
    case "cancelled":
      return "Cancelada";
  }
}

function isTerminalRun(run: Run): boolean {
  return ["completed", "failed", "cancelled"].includes(run.status);
}

export default function Dashboard() {
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const [authState, setAuthState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [authRetry, setAuthRetry] = useState(0);
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [prompt, setPrompt] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [processingRunId, setProcessingRunId] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const [processNotice, setProcessNotice] = useState<string | null>(null);
  const processLock = useRef(false);
  const [realtimeConnection, setRealtimeConnection] = useState<{
    runId: string;
    state: RealtimeState;
  } | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.resolve()
      .then(() => createClient())
      .then((client) => {
        if (active) {
          setSupabase(client);
        }
      })
      .catch(() => {
        if (active) {
          setAuthState("error");
          setRunError(
            "Falta la configuración pública de Supabase. Revisa las variables de entorno de la aplicación.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [authRetry]);

  const refreshRunHistory = useCallback(async (client: SupabaseClient) => {
    const { data, error } = await client
      .from("agent_runs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) {
      setDataError("No se pudo cargar el historial de ejecuciones.");
      return null;
    }
    setRuns(data);
    return data;
  }, []);

  useEffect(() => {
    if (!supabase) {
      return;
    }

    let active = true;
    const client = supabase;

    async function initializeSession() {
      const { data, error } = await client.auth.getSession();
      if (error) {
        if (active) {
          setAuthState("error");
          setRunError("No se pudo recuperar la sesión. Inténtalo de nuevo.");
        }
        return;
      }

      if (!data.session) {
        const { data: anonymousData, error: signInError } =
          await client.auth.signInAnonymously();
        if (signInError || !anonymousData.session) {
          if (active) {
            setAuthState("error");
            setRunError(
              "No se pudo iniciar una sesión. Comprueba la URL y la clave pública de Supabase, el estado del proyecto y que Anonymous Sign-Ins esté habilitado.",
            );
          }
          return;
        }
      }

      if (!active) {
        return;
      }

      const history = await refreshRunHistory(client);
      if (!active) {
        return;
      }
      if (history === null) {
        setAuthState("error");
        return;
      }
      setSelectedRunId((current) => current ?? history[0]?.id ?? null);
      setRunError(null);
      setAuthState("ready");
    }

    void initializeSession();
    return () => {
      active = false;
    };
  }, [authRetry, refreshRunHistory, supabase]);

  const refreshSnapshot = useCallback(
    async (
      client: SupabaseClient,
      runId: string,
      isCurrent: () => boolean = () => true,
    ): Promise<boolean> => {
      const [runResult, taskResult, artifactResult, eventResult] =
        await Promise.all([
          client.from("agent_runs").select("*").eq("id", runId).maybeSingle(),
          client
            .from("agent_tasks")
            .select("*")
            .eq("run_id", runId)
            .order("sequence", { ascending: true }),
          client
            .from("artifacts")
            .select("*")
            .eq("run_id", runId)
            .order("created_at", { ascending: true }),
          client
            .from("agent_events")
            .select("*")
            .eq("run_id", runId)
            .order("created_at", { ascending: true })
            .limit(250),
        ]);
      if (!isCurrent()) {
        return false;
      }

      const hasError =
        runResult.error ||
        taskResult.error ||
        artifactResult.error ||
        eventResult.error;
      const currentRun = runResult.data;
      if (hasError || !currentRun) {
        setDataError("No se pudo actualizar la ejecución seleccionada.");
        return false;
      }

      setDataError(null);
      setRun(currentRun);
      setTasks(taskResult.data);
      setArtifacts(artifactResult.data);
      setEvents(eventResult.data);
      setRuns((current) => {
        const next = [
          currentRun,
          ...current.filter((item) => item.id !== currentRun.id),
        ];
        return next.sort(
          (left, right) =>
            right.created_at.localeCompare(left.created_at),
        );
      });
      return true;
    },
    [],
  );

  useEffect(() => {
    if (!supabase || !selectedRunId || authState !== "ready") {
      return;
    }

    let active = true;
    let refreshTimer: number | undefined;
    void Promise.resolve().then(() =>
      refreshSnapshot(supabase, selectedRunId, () => active),
    );

    const channel = supabase
      .channel(`agent-run:${selectedRunId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "agent_runs",
          filter: `id=eq.${selectedRunId}`,
        },
        () => {
          void refreshSnapshot(supabase, selectedRunId, () => active);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "agent_tasks",
          filter: `run_id=eq.${selectedRunId}`,
        },
        () => {
          void refreshSnapshot(supabase, selectedRunId, () => active);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "artifacts",
          filter: `run_id=eq.${selectedRunId}`,
        },
        () => {
          void refreshSnapshot(supabase, selectedRunId, () => active);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "agent_events",
          filter: `run_id=eq.${selectedRunId}`,
        },
        () => {
          void refreshSnapshot(supabase, selectedRunId, () => active);
        },
      )
      .subscribe((status) => {
        if (!active) {
          return;
        }
        if (status === "SUBSCRIBED") {
          setRealtimeConnection({ runId: selectedRunId, state: "connected" });
          if (refreshTimer) {
            window.clearTimeout(refreshTimer);
          }
          void refreshSnapshot(supabase, selectedRunId, () => active);
        } else if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
          setRealtimeConnection({ runId: selectedRunId, state: "offline" });
          if (refreshTimer) {
            window.clearTimeout(refreshTimer);
          }
          refreshTimer = window.setTimeout(() => {
            void refreshSnapshot(supabase, selectedRunId, () => active);
          }, 3_000);
        }
      });

    return () => {
      active = false;
      if (refreshTimer) {
        window.clearTimeout(refreshTimer);
      }
      void supabase.removeChannel(channel);
    };
  }, [authState, refreshSnapshot, selectedRunId, supabase]);

  const processRun = useCallback(
    async (runId: string, client: SupabaseClient) => {
      if (processLock.current) {
        return;
      }
      processLock.current = true;
      setProcessingRunId(runId);
      setProcessNotice(null);
      setRunError(null);

      try {
        for (let step = 0; step < MAX_BROWSER_STEPS; step += 1) {
          const response = await fetch(
            `/api/runs/${encodeURIComponent(runId)}/step`,
            { method: "POST" },
          );
          let payload: unknown;
          try {
            payload = await response.json();
          } catch {
            throw new Error("El servidor devolvió una respuesta no válida.");
          }
          if (!isRecord(payload)) {
            throw new Error("El servidor devolvió una respuesta no válida.");
          }
          if (!response.ok) {
            throw new Error(
              typeof payload.error === "string"
                ? payload.error
                : "No se pudo avanzar la ejecución.",
            );
          }
          if (typeof payload.status !== "string") {
            throw new Error("El servidor devolvió un estado no válido.");
          }

          await refreshSnapshot(client, runId);

          if (payload.status === "step_completed") {
            continue;
          }
          if (
            payload.status === "busy" ||
            payload.status === "waiting" ||
            payload.status === "retry_wait"
          ) {
            await wait(
              getDelayUntil(
                payload.status === "busy"
                  ? payload.leaseExpiresAt
                  : payload.retryAt,
              ),
            );
            continue;
          }
          if (
            payload.status === "completed" ||
            payload.status === "failed" ||
            payload.status === "cancelled"
          ) {
            if (
              payload.status === "failed" &&
              typeof payload.error === "string"
            ) {
              setRunError(payload.error);
            }
            return;
          }
          throw new Error("El servidor devolvió un estado de ejecución desconocido.");
        }

        setProcessNotice(
          "La ejecución sigue activa y alcanzó el límite de pasos de esta sesión. Puedes reanudarla.",
        );
      } catch (error) {
        setRunError(
          error instanceof Error
            ? error.message
            : "No se pudo continuar la ejecución. Puedes reanudarla.",
        );
        await refreshSnapshot(client, runId);
      } finally {
        processLock.current = false;
        setProcessingRunId(null);
      }
    },
    [refreshSnapshot],
  );

  async function startRun(requestText: string) {
    if (!supabase || authState !== "ready" || isCreating || processLock.current) {
      return;
    }
    const parsedRequest = CreateRunSchema.safeParse({ request: requestText });
    if (!parsedRequest.success) {
      setRunError("Escribe una petición de entre 1 y 4000 caracteres.");
      return;
    }

    setIsCreating(true);
    setRunError(null);
    setProcessNotice(null);
    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsedRequest.data),
      });
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new Error("El servidor devolvió una respuesta no válida.");
      }
      if (!response.ok) {
        throw new Error(
          isRecord(payload) && typeof payload.error === "string"
            ? payload.error
            : "No se pudo crear la ejecución.",
        );
      }
      const parsedResponse = RunResponseSchema.safeParse(payload);
      if (!parsedResponse.success) {
        throw new Error("No se recibió el identificador de la ejecución.");
      }

      const runId = parsedResponse.data.runId;
      setPrompt("");
      setSelectedRunId(runId);
      setIsCreating(false);
      await refreshRunHistory(supabase);
      await processRun(runId, supabase);
    } catch (error) {
      setRunError(
        error instanceof Error ? error.message : "No se pudo crear la ejecución.",
      );
    } finally {
      setIsCreating(false);
    }
  }

  function submitPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void startRun(prompt);
  }

  function selectExample(example: string) {
    setPrompt(example);
    void startRun(example);
  }

  const isProcessingSelectedRun =
    processingRunId !== null && processingRunId === selectedRunId;
  const isAnyRunProcessing = processingRunId !== null;
  const selectedRun = run?.id === selectedRunId ? run : null;
  const selectedTasks = selectedRun ? tasks : [];
  const selectedArtifacts = selectedRun ? artifacts : [];
  const selectedEvents = selectedRun ? events : [];
  const realtimeState: RealtimeState = selectedRunId
    ? realtimeConnection?.runId === selectedRunId
      ? realtimeConnection.state
      : "connecting"
    : "idle";
  const snapshotLoading = Boolean(selectedRunId && !selectedRun);

  if (authState !== "ready") {
    return (
      <main className="boot">
        <section className="boot-panel" aria-labelledby="boot-heading">
          <p className="wordmark-name">Estudio</p>
          <h1 id="boot-heading" className="boot-title">
            {authState === "loading"
              ? "Abriendo una sesión privada"
              : "No se pudo conectar"}
          </h1>
          <p className="boot-copy">
            {authState === "loading"
              ? "Tus ejecuciones se guardan en esta sesión anónima y solo tú puedes verlas."
              : runError || "Comprueba la conexión y vuelve a intentarlo."}
          </p>
          {authState === "loading" ? (
            <p className="boot-status" role="status">
              <span className="lamp" data-state="active" aria-hidden="true" />
              Conectando con Supabase
            </p>
          ) : (
            <button
              className="button button-primary"
              type="button"
              onClick={() => {
                setRunError(null);
                setAuthState("loading");
                setAuthRetry((attempt) => attempt + 1);
              }}
            >
              Reintentar conexión
            </button>
          )}
        </section>
      </main>
    );
  }

  const completedTasks = selectedTasks.filter(
    (task) => task.status === "completed",
  ).length;
  const duration =
    selectedRun && isTerminalRun(selectedRun) ? formatDuration(selectedRun) : null;
  const startedAt = selectedRun ? new Date(selectedRun.created_at) : null;

  return (
    <div className="app">
      <a className="skip-link" href="#contenido">
        Saltar al contenido
      </a>
      <header className="topbar">
        <div className="topbar-inner">
          <Link className="wordmark" href="/" aria-label="Estudio, inicio">
            <svg
              className="wordmark-mark"
              viewBox="0 0 36 12"
              width="36"
              height="12"
              aria-hidden="true"
            >
              <path d="M3 6h30" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="4" cy="6" r="3" fill="var(--agent-orchestrator)" />
              <circle cx="14" cy="6" r="3" fill="var(--agent-develop)" />
              <circle cx="24" cy="6" r="3" fill="var(--agent-testing)" />
              <circle cx="33" cy="6" r="2" fill="currentColor" />
            </svg>
            <span className="wordmark-name">Estudio</span>
            <span className="wordmark-tag">Equipo de agentes</span>
          </Link>
          <div className="topbar-actions">
            <label className="run-picker">
              <span className="sr-only">Ejecución que se muestra</span>
              <select
                className="select"
                value={selectedRunId ?? ""}
                disabled={runs.length === 0 || isCreating}
                onChange={(event) =>
                  setSelectedRunId(event.currentTarget.value || null)
                }
              >
                {runs.length === 0 ? (
                  <option value="">Sin ejecuciones todavía</option>
                ) : (
                  runs.map((item) => (
                    <option key={item.id} value={item.id}>
                      {formatRunLabel(item)}
                    </option>
                  ))
                )}
              </select>
            </label>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="page" id="contenido" tabIndex={-1}>
        <section className="command" aria-labelledby="command-heading">
          <h1 id="command-heading" className="command-title">
            ¿Qué tiene que construir el equipo?
          </h1>
          <form className="command-form" onSubmit={submitPrompt}>
            <div className="field">
              <label className="sr-only" htmlFor="request-input">
                Describe la tarea para el equipo
              </label>
              <textarea
                className="field-input"
                id="request-input"
                value={prompt}
                onChange={(event) => setPrompt(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    (event.metaKey || event.ctrlKey)
                  ) {
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                placeholder="Por ejemplo: añade una página de contacto accesible a esta web"
                maxLength={4000}
                rows={2}
                aria-describedby="request-hint"
                disabled={isCreating || isAnyRunProcessing}
                required
              />
              <p className="field-hint" id="request-hint">
                <span>Ctrl + Enter para enviar</span>
                <span aria-live="polite">{prompt.length} / 4000</span>
              </p>
            </div>
            <button
              className="button button-primary command-submit"
              type="submit"
              disabled={!prompt.trim() || isCreating || isAnyRunProcessing}
            >
              {isCreating
                ? "Creando…"
                : isProcessingSelectedRun
                  ? "Trabajando…"
                  : "Iniciar equipo"}
            </button>
          </form>
          <div className="examples">
            <span className="examples-label" id="examples-label">
              O prueba un ejemplo:
            </span>
            <div className="examples-list" role="group" aria-labelledby="examples-label">
              {examples.map((example) => (
                <button
                  className="chip"
                  key={example.label}
                  type="button"
                  title={example.request}
                  disabled={isCreating || Boolean(processingRunId)}
                  onClick={() => selectExample(example.request)}
                >
                  {example.label}
                </button>
              ))}
            </div>
          </div>
          {(runError || selectedRun?.error_message) && (
            <p className="banner" data-tone="danger" role="alert">
              {runError || selectedRun?.error_message}
            </p>
          )}
          {processNotice && (
            <p className="banner" data-tone="neutral" role="status">
              {processNotice}
            </p>
          )}
          {processingRunId && !isProcessingSelectedRun && (
            <p className="banner" data-tone="neutral" role="status">
              Hay otra ejecución en marcha. Selecciónala en el historial para
              seguirla.
            </p>
          )}
          {dataError && (
            <p className="banner" data-tone="danger" role="status">
              {dataError}
            </p>
          )}
        </section>

        {snapshotLoading ? (
          <section className="run-head" aria-busy="true" aria-label="Cargando ejecución">
            <div className="skeleton skeleton-title" />
            <div className="skeleton skeleton-meta" />
          </section>
        ) : (
          selectedRun && (
            <section className="run-head" aria-labelledby="run-heading">
              <div className="run-head-main">
                <h2 id="run-heading" className="run-title">
                  {selectedRun.request}
                </h2>
                <dl className="run-meta">
                  <div>
                    <dt>Estado</dt>
                    <dd className="run-status" role="status">
                      <span
                        className="lamp"
                        data-state={runLampState(selectedRun)}
                        aria-hidden="true"
                      />
                      {runStatusLabel(selectedRun)}
                    </dd>
                  </div>
                  {startedAt && !Number.isNaN(startedAt.getTime()) && (
                    <div>
                      <dt>Inicio</dt>
                      <dd>
                        <time dateTime={selectedRun.created_at}>
                          {timeFormat.format(startedAt)}
                        </time>
                      </dd>
                    </div>
                  )}
                  {duration && (
                    <div>
                      <dt>Duración</dt>
                      <dd>{duration}</dd>
                    </div>
                  )}
                  <div>
                    <dt>Tareas aprobadas</dt>
                    <dd>
                      {selectedTasks.length === 0
                        ? "Sin plan aún"
                        : `${completedTasks} de ${selectedTasks.length}`}
                    </dd>
                  </div>
                </dl>
              </div>
              {!processingRunId && !isTerminalRun(selectedRun) && (
                <div className="run-resume">
                  <p>Esta ejecución quedó a medias y se puede retomar.</p>
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={() => {
                      if (supabase) {
                        void processRun(selectedRun.id, supabase);
                      }
                    }}
                  >
                    Reanudar ejecución
                  </button>
                </div>
              )}
            </section>
          )
        )}

        <RunTrack
          run={selectedRun}
          tasks={selectedTasks}
          events={selectedEvents}
          live={isProcessingSelectedRun}
          loading={snapshotLoading}
        />

        <div className="lower">
          <EventTimeline
            events={selectedEvents}
            state={realtimeState}
            loading={snapshotLoading}
          />
          <CodeViewer
            artifacts={selectedArtifacts}
            tasks={selectedTasks}
            loading={snapshotLoading}
          />
        </div>

        <footer className="footnote">
          El código generado se guarda como artefacto virtual; este servidor no
          lo ejecuta.
        </footer>
      </main>
    </div>
  );
}
