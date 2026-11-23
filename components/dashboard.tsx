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
import AgentCards from "@/components/agent-cards";
import CodeViewer from "@/components/code-viewer";
import EventTimeline from "@/components/event-timeline";
import TaskBoard from "@/components/task-board";
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
  "Crea un README.md con el título «Notas de lanzamiento» y las secciones Resumen, Cambios y Próximos pasos.",
  "Añade una página de contacto con un formulario accesible y datos de contacto de ejemplo.",
  "Crea una hoja de estilos CSS con una paleta accesible para una interfaz de tareas.",
];

const RunResponseSchema = z.object({ runId: z.uuid() });
const MAX_BROWSER_STEPS = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatRunLabel(run: Run): string {
  const prompt = run.request.replace(/\s+/g, " ").trim();
  const shortPrompt = prompt.length > 48 ? `${prompt.slice(0, 48)}…` : prompt;
  const date = new Date(run.created_at);
  const time = Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat("es", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
  return time ? `${shortPrompt} · ${time}` : shortPrompt;
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
      <main className="auth-state">
        <section className="auth-card" aria-labelledby="auth-heading">
          <div className="brand-mark" aria-hidden="true">
            <span>✦</span>
          </div>
          <h1 id="auth-heading">
            {authState === "loading"
              ? "Preparando el espacio"
              : "No se pudo conectar"}
          </h1>
          <p>
            {authState === "loading"
              ? "Estamos iniciando una sesión privada para guardar tus ejecuciones."
              : runError ||
                "Comprueba la conexión y vuelve a intentarlo."}
          </p>
          {authState === "loading" ? (
            <span className="busy-indicator" role="status">
              <span className="spinner" aria-hidden="true" />
              Conectando con Supabase
            </span>
          ) : (
            <button
              className="primary-button"
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

  return (
    <main className="app-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Estudio de agentes, inicio">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 20 20" fill="none" width="20" height="20">
              <path
                d="M10 2.5 12.1 7.9 17.5 10l-5.4 2.1L10 17.5l-2.1-5.4L2.5 10l5.4-2.1L10 2.5Z"
                fill="currentColor"
              />
            </svg>
          </span>
          <span className="brand-name">
            Estudio
            <small>Agentes colaborativos</small>
          </span>
        </Link>
        <div className="topbar-actions">
          <span className="session-pill">
            <span className="session-dot" aria-hidden="true" />
            Sesión privada
          </span>
          <ThemeToggle />
        </div>
      </header>

      <section className="hero" aria-labelledby="page-title">
        <div>
          <p className="eyebrow">
            <span className="eyebrow-mark" aria-hidden="true" />
            Equipo de desarrollo con IA
          </p>
          <h1 id="page-title">De la petición al código, en equipo.</h1>
          <p className="hero-copy">
            El Orquestador crea un plan, Develop escribe los archivos y Testing
            comprueba cada tarea. Sigue el proceso en directo.
          </p>
        </div>
        <div className="hero-side">
          <label className="run-picker">
            <span className="run-picker-label">Historial de ejecuciones</span>
            <select
              aria-label="Historial de ejecuciones"
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
          {selectedRun && (
            <span className="provider-pill" data-state={selectedRun.status}>
              {runStatusLabel(selectedRun)}
            </span>
          )}
        </div>
      </section>

      <section className="request-panel" aria-labelledby="request-heading">
        <div className="request-panel-top">
          <h2 id="request-heading">¿Qué quieres construir?</h2>
          <p>Cada paso se guarda y puede reanudarse sin perder el progreso.</p>
        </div>
        <form className="request-form" onSubmit={submitPrompt}>
          <div className="request-input-wrap">
            <label className="sr-only" htmlFor="request-input">
              Describe la tarea para el equipo
            </label>
            <textarea
              className="request-input"
              id="request-input"
              value={prompt}
              onChange={(event) => setPrompt(event.currentTarget.value)}
              placeholder="Ej.: añade una página de contacto accesible a esta web…"
              maxLength={4000}
              disabled={isCreating || isAnyRunProcessing}
              required
            />
            <span className="char-count" aria-live="polite">
              {prompt.length}/4000
            </span>
          </div>
          <button
            className="primary-button"
            type="submit"
            disabled={
              !prompt.trim() ||
              isCreating ||
              isAnyRunProcessing
            }
          >
            {isCreating ? (
              <>
                <span className="spinner" aria-hidden="true" />
                Creando…
              </>
            ) : isProcessingSelectedRun ? (
              <>
                <span className="spinner" aria-hidden="true" />
                Trabajando…
              </>
            ) : (
              <>
                <span aria-hidden="true">✦</span>
                Iniciar equipo
              </>
            )}
          </button>
        </form>
        <div className="example-row" aria-label="Peticiones de ejemplo">
          <span className="example-caption">O prueba con un clic</span>
          {examples.map((example, index) => (
            <button
              className="example-button"
              key={example}
              type="button"
              disabled={isCreating || Boolean(processingRunId)}
              onClick={() => selectExample(example)}
            >
              {["README", "Página de contacto", "Paleta CSS"][index]}
            </button>
          ))}
        </div>
        {(runError || selectedRun?.error_message) && (
          <div className="error-banner" role="alert">
            <span aria-hidden="true">!</span>
            <span>{runError || selectedRun?.error_message}</span>
          </div>
        )}
        {processNotice && (
          <div className="notice-banner" role="status">
            <span aria-hidden="true">↻</span>
            <span>{processNotice}</span>
          </div>
        )}
        {processingRunId && (
          <div className="inline-row" style={{ justifyContent: "space-between", marginTop: 12 }}>
            <span className="busy-indicator" role="status" aria-live="polite">
              <span className="spinner" aria-hidden="true" />
              {isProcessingSelectedRun
                ? "El equipo está trabajando; los eventos se actualizan en vivo."
                : "Hay otra ejecución en marcha."}
            </span>
          </div>
        )}
        {!processingRunId && selectedRun && !isTerminalRun(selectedRun) && (
          <div className="inline-row" style={{ justifyContent: "space-between", marginTop: 12 }}>
            <span className="busy-indicator">
              La ejecución se puede reanudar en cualquier momento.
            </span>
            <button
              className="resume-button"
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
        {dataError && (
          <div className="error-banner" role="status">
            <span aria-hidden="true">!</span>
            <span>{dataError}</span>
          </div>
        )}
      </section>

      <AgentCards run={selectedRun} tasks={selectedTasks} events={selectedEvents} />

      <div className="workspace-grid">
        <TaskBoard tasks={selectedTasks} events={selectedEvents} />
        <EventTimeline
          events={selectedEvents}
          connected={realtimeState === "connected"}
          state={realtimeState}
        />
      </div>

      <div className="detail-grid">
        <CodeViewer artifacts={selectedArtifacts} tasks={selectedTasks} />
        <section className="surface-panel" aria-labelledby="project-note-heading">
          <div className="panel-heading">
            <div>
              <h2 id="project-note-heading">Cómo funciona</h2>
              <p className="section-subtitle">
                Un flujo corto, persistido y verificable
              </p>
            </div>
          </div>
          <ol className="criteria-list">
            <li>El Orquestador propone tareas con criterios comprobables.</li>
            <li>Develop guarda cada archivo como una revisión del proyecto virtual.</li>
            <li>
              Testing combina comprobaciones automáticas con una revisión del
              resultado.
            </li>
            <li>
              Si algo falla, Develop recibe el informe y vuelve a intentarlo
              (hasta tres iteraciones).
            </li>
          </ol>
        </section>
      </div>
      <footer className="footer-note">
        El código generado se conserva como artefacto virtual y no se ejecuta en
        este servidor.
      </footer>
      {snapshotLoading && (
        <span className="sr-only" role="status">
          Cargando historial de la ejecución seleccionada.
        </span>
      )}
    </main>
  );
}
