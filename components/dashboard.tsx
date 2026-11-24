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
import Notice from "@/components/notice";
import RunTrack from "@/components/run-track";
import ThemeToggle from "@/components/theme-toggle";
import {
  describeApiError,
  describeApiErrorBody,
  describeClientError,
  describeRetryWait,
  describeRunFailure,
  type ErrorAction,
  type UserFacingError,
} from "@/lib/errors/user-messages";
import { createClient } from "@/lib/supabase/client";
import {
  RUN_REQUEST_MAX_CHARS,
  normalizeRunRequest,
  validateRunRequest,
} from "@/lib/validation/run-request";
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
/** Longer than the step route's 60 s maxDuration, so a slow step can finish. */
const STEP_REQUEST_TIMEOUT_MS = 75_000;
const CREATE_REQUEST_TIMEOUT_MS = 20_000;
/** Transient 5xx/network failures retried before the user is asked to act. */
const MAX_TRANSIENT_STEP_FAILURES = 2;

class ApiFailure extends Error {
  constructor(
    readonly notice: UserFacingError,
    readonly status: number,
  ) {
    super(notice.title);
  }
}

/** POSTs JSON and returns the parsed body, or throws an ApiFailure. */
async function postJson(
  url: string,
  body: unknown,
  timeoutMs: number,
): Promise<{ status: number; payload: Record<string, unknown> }> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new ApiFailure(describeClientError(error), 0);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiFailure(
      response.ok
        ? describeApiError("invalid_response")
        : describeApiError(response.status >= 500 ? "server_error" : "invalid_response"),
      response.status,
    );
  }
  if (!response.ok) {
    throw new ApiFailure(describeApiErrorBody(payload), response.status);
  }
  if (!isRecord(payload)) {
    throw new ApiFailure(describeApiError("invalid_response"), response.status);
  }
  return { status: response.status, payload };
}

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
  const [runError, setRunError] = useState<UserFacingError | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [processNotice, setProcessNotice] = useState<UserFacingError | null>(
    null,
  );
  const [requestError, setRequestError] = useState<string | null>(null);
  const [snapshotRetry, setSnapshotRetry] = useState(0);
  // Set from an effect only: reading the time during render would make the
  // prerendered HTML depend on the build time.
  const [clock, setClock] = useState<number | null>(null);
  const processLock = useRef(false);
  const requestInputRef = useRef<HTMLTextAreaElement>(null);
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
          setBootError(
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
          setBootError("No se pudo recuperar la sesión. Inténtalo de nuevo.");
        }
        return;
      }

      if (!data.session) {
        const { data: anonymousData, error: signInError } =
          await client.auth.signInAnonymously();
        if (signInError || !anonymousData.session) {
          if (active) {
            setAuthState("error");
            setBootError(
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
        setBootError(
          "La sesión está abierta, pero no se pudo cargar tu historial de ejecuciones. Comprueba la conexión y vuelve a intentarlo.",
        );
        setAuthState("error");
        return;
      }
      setSelectedRunId((current) => current ?? history[0]?.id ?? null);
      setBootError(null);
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
          // Newest 250 events; reversed below so the timeline keeps the latest.
          client
            .from("agent_events")
            .select("*")
            .eq("run_id", runId)
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
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
      setEvents([...eventResult.data].reverse());
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
    // snapshotRetry re-runs the initial load after the user asks to retry.
  }, [authState, refreshSnapshot, selectedRunId, snapshotRetry, supabase]);

  const processRun = useCallback(
    async (runId: string, client: SupabaseClient) => {
      if (processLock.current) {
        return;
      }
      processLock.current = true;
      setProcessingRunId(runId);
      setProcessNotice(null);
      setRunError(null);
      let transientFailures = 0;

      try {
        for (let step = 0; step < MAX_BROWSER_STEPS; step += 1) {
          let payload: Record<string, unknown>;
          try {
            ({ payload } = await postJson(
              `/api/runs/${encodeURIComponent(runId)}/step`,
              undefined,
              STEP_REQUEST_TIMEOUT_MS,
            ));
          } catch (error) {
            if (!(error instanceof ApiFailure)) {
              throw error;
            }
            // The per-user step limit is a pause, not a failure: wait it out.
            if (error.notice.code === "step_rate_limited") {
              setProcessNotice(error.notice);
              await wait(
                Math.min((error.notice.retryAfterSeconds ?? 5) * 1000, 60_000),
              );
              setProcessNotice(null);
              continue;
            }
            // Steps are idempotent (leases + attempt rows), so a dropped
            // connection or a 5xx can be retried a couple of times silently.
            const transient = error.status === 0 || error.status >= 500;
            if (transient && transientFailures < MAX_TRANSIENT_STEP_FAILURES) {
              transientFailures += 1;
              await wait(1_500 * transientFailures);
              continue;
            }
            throw error;
          }
          transientFailures = 0;
          if (typeof payload.status !== "string") {
            throw new ApiFailure(describeApiError("invalid_response"), 200);
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
            // A failed run explains itself from its persisted events.
            return;
          }
          throw new ApiFailure(describeApiError("invalid_response"), 200);
        }

        setProcessNotice({
          code: "browser_step_budget",
          title: "La ejecución sigue en marcha",
          detail:
            "Esta pestaña ha avanzado el máximo de pasos seguidos que permite una sesión. Reanúdala para continuar.",
          action: "resume",
        });
      } catch (error) {
        setRunError(
          error instanceof ApiFailure ? error.notice : describeClientError(error),
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
    const validation = validateRunRequest(requestText);
    if (!validation.ok) {
      setRequestError(validation.message);
      requestInputRef.current?.focus();
      return;
    }

    setRequestError(null);
    setIsCreating(true);
    setRunError(null);
    setProcessNotice(null);
    try {
      const { payload } = await postJson(
        "/api/runs",
        { request: validation.value },
        CREATE_REQUEST_TIMEOUT_MS,
      );
      const parsedResponse = RunResponseSchema.safeParse(payload);
      if (!parsedResponse.success) {
        throw new ApiFailure(describeApiError("invalid_response"), 201);
      }

      const runId = parsedResponse.data.runId;
      setPrompt("");
      setSelectedRunId(runId);
      setIsCreating(false);
      await refreshRunHistory(supabase);
      await processRun(runId, supabase);
    } catch (error) {
      const notice =
        error instanceof ApiFailure ? error.notice : describeClientError(error);
      if (notice.code === "invalid_request" || notice.code === "payload_too_large") {
        setRequestError(notice.detail);
        requestInputRef.current?.focus();
      } else if (notice.action === "resume") {
        // Nothing was created yet, so "resume" would point at another run.
        setRunError({
          ...notice,
          detail:
            notice.code === "network_error" || notice.code === "request_timeout"
              ? "No se pudo enviar la petición. Comprueba la conexión y vuelve a pulsar «Iniciar equipo»; tu texto sigue en el cuadro."
              : "No se pudo crear la ejecución. Vuelve a pulsar «Iniciar equipo» en unos segundos; tu texto sigue en el cuadro.",
          action: undefined,
        });
      } else {
        setRunError(notice);
      }
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

  function handleNoticeAction(action: ErrorAction) {
    switch (action) {
      case "retry_run":
        if (selectedRun) {
          void startRun(selectedRun.request);
        }
        return;
      case "resume":
        if (supabase && selectedRunId) {
          void processRun(selectedRunId, supabase);
        }
        return;
      case "reload":
        window.location.reload();
        return;
      case "edit":
        if (selectedRun && !prompt.trim()) {
          setPrompt(selectedRun.request);
        }
        requestInputRef.current?.focus();
        return;
      case "wait":
        return;
    }
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
  const isRetryWaiting = selectedRun?.status === "retry_wait";
  const promptLength = normalizeRunRequest(prompt).length;

  // Ticks once a second only while a retry is pending, for its countdown.
  useEffect(() => {
    if (!isRetryWaiting) {
      return;
    }
    const tick = () => setClock(Date.now());
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 1_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [isRetryWaiting]);

  const runFailure = selectedRun
    ? describeRunFailure(selectedRun, selectedEvents)
    : null;
  const retryNotice = selectedRun
    ? describeRetryWait(selectedRun, selectedEvents, clock)
    : null;

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
              : bootError || "Comprueba la conexión y vuelve a intentarlo."}
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
                setBootError(null);
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
                ref={requestInputRef}
                onChange={(event) => {
                  setPrompt(event.currentTarget.value);
                  if (requestError) {
                    setRequestError(null);
                  }
                }}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    (event.metaKey || event.ctrlKey)
                  ) {
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                placeholder="Por ejemplo: añade una página de contacto accesible a esta web"
                rows={2}
                aria-describedby={
                  requestError ? "request-error request-hint" : "request-hint"
                }
                aria-invalid={requestError ? true : undefined}
                disabled={isCreating || isAnyRunProcessing}
                required
              />
              {requestError && (
                <p className="field-error" id="request-error" role="alert">
                  {requestError}
                </p>
              )}
              <p className="field-hint" id="request-hint">
                <span>Ctrl + Enter para enviar</span>
                <span data-over={promptLength > RUN_REQUEST_MAX_CHARS}>
                  {promptLength} / {RUN_REQUEST_MAX_CHARS}
                  <span className="sr-only"> caracteres</span>
                </span>
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
          {runError && (
            <Notice
              notice={runError}
              tone="danger"
              onAction={handleNoticeAction}
              onDismiss={() => setRunError(null)}
            />
          )}
          {!runError && runFailure && !isProcessingSelectedRun && (
            <Notice
              notice={runFailure}
              tone="danger"
              onAction={handleNoticeAction}
            />
          )}
          {retryNotice && <Notice notice={retryNotice} tone="neutral" />}
          {processNotice && (
            <Notice
              notice={processNotice}
              tone="neutral"
              onAction={handleNoticeAction}
            />
          )}
          {processingRunId && !isProcessingSelectedRun && (
            <p className="banner" data-tone="neutral" role="status">
              Hay otra ejecución en marcha. Selecciónala en el historial para
              seguirla.
            </p>
          )}
          {dataError && !snapshotLoading && (
            <p className="banner" data-tone="danger" role="status">
              {dataError} Se volverá a intentar al recibir cambios.
            </p>
          )}
        </section>

        {snapshotLoading && dataError ? (
          <section className="run-head error-state" aria-labelledby="load-error-heading">
            <h2 id="load-error-heading" className="notice-title">
              No se pudo cargar esta ejecución
            </h2>
            <p className="notice-detail">
              Supabase no respondió. Comprueba la conexión y vuelve a
              intentarlo, o elige otra ejecución en el historial.
            </p>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => {
                setDataError(null);
                setSnapshotRetry((attempt) => attempt + 1);
              }}
            >
              Reintentar carga
            </button>
          </section>
        ) : snapshotLoading ? (
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
                        ? selectedRun.status === "failed"
                          ? "Sin plan"
                          : "Sin plan aún"
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
            loading={snapshotLoading && !dataError}
            runId={selectedRun?.id ?? null}
          />
          <CodeViewer
            artifacts={selectedArtifacts}
            tasks={selectedTasks}
            loading={snapshotLoading && !dataError}
            runStatus={selectedRun?.status ?? null}
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
