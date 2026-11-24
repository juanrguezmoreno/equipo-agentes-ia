/**
 * User-facing error catalogue. Server routes return a stable `code`; the
 * browser turns that code (or a persisted run failure) into a Spanish title,
 * an explanation and the action that can actually help. Keep it free of
 * server-only imports: both sides use it.
 */
import type { Tables } from "@/types/database";

type Run = Tables<"agent_runs">;
type AgentEvent = Tables<"agent_events">;

export type ErrorAction = "retry_run" | "resume" | "reload" | "edit" | "wait";

export interface UserFacingError {
  code: string;
  title: string;
  detail: string;
  action?: ErrorAction;
  retryAfterSeconds?: number;
}

export type ApiErrorCode =
  | "auth_required"
  | "auth_unavailable"
  | "invalid_json"
  | "unsupported_media_type"
  | "payload_too_large"
  | "invalid_request"
  | "invalid_run_id"
  | "run_not_found"
  | "run_rate_limited_hour"
  | "run_rate_limited_day"
  | "global_quota_exhausted"
  | "step_rate_limited"
  | "step_quota_exhausted"
  | "step_persist_failed"
  | "server_error";

export type ClientErrorCode =
  | "network_error"
  | "request_timeout"
  | "invalid_response";

const apiMessages: Record<
  ApiErrorCode | ClientErrorCode,
  Omit<UserFacingError, "code" | "retryAfterSeconds">
> = {
  auth_required: {
    title: "Tu sesión ha caducado",
    detail: "Recarga la página para abrir una sesión nueva. Las ejecuciones anteriores de esta sesión seguirán guardadas si el navegador conserva la cookie.",
    action: "reload",
  },
  auth_unavailable: {
    title: "No se pudo comprobar tu sesión",
    detail: "El servicio de autenticación no responde ahora mismo. Espera unos segundos y vuelve a intentarlo.",
    action: "wait",
  },
  invalid_json: {
    title: "La petición llegó dañada",
    detail: "El servidor no pudo leer los datos enviados. Vuelve a enviarla.",
    action: "edit",
  },
  unsupported_media_type: {
    title: "Formato de petición no admitido",
    detail: "La petición debe enviarse como JSON. Recarga la página y vuelve a intentarlo.",
    action: "reload",
  },
  payload_too_large: {
    title: "La petición es demasiado grande",
    detail: "Resume el texto y vuelve a enviarlo.",
    action: "edit",
  },
  invalid_request: {
    title: "Revisa la petición",
    detail: "El texto no cumple los requisitos para enviarlo al equipo.",
    action: "edit",
  },
  invalid_run_id: {
    title: "Ejecución no válida",
    detail: "El identificador de la ejecución no es correcto. Selecciona otra en el historial.",
  },
  run_not_found: {
    title: "No se encontró la ejecución",
    detail: "Puede que pertenezca a otra sesión o que se haya borrado. Selecciona otra en el historial.",
  },
  run_rate_limited_hour: {
    title: "Has alcanzado el límite por hora",
    detail: "Para proteger la cuota gratuita de los modelos, cada sesión puede lanzar 5 ejecuciones por hora.",
    action: "wait",
  },
  run_rate_limited_day: {
    title: "Has alcanzado el límite diario",
    detail: "Para proteger la cuota gratuita de los modelos, cada sesión tiene un número limitado de ejecuciones al día. Puedes seguir consultando el historial.",
    action: "wait",
  },
  global_quota_exhausted: {
    title: "Cupo diario del servicio agotado",
    detail: "Entre todos los usuarios se ha alcanzado el máximo diario de ejecuciones que admite el plan gratuito de los modelos. Vuelve a intentarlo mañana.",
    action: "wait",
  },
  step_rate_limited: {
    title: "Demasiados pasos seguidos",
    detail: "Los agentes se pausan un momento para no agotar la cuota gratuita. La ejecución continuará sola.",
    action: "wait",
  },
  step_quota_exhausted: {
    title: "Cuota diaria de pasos agotada",
    detail: "Esta sesión ha consumido hoy todos los pasos de agente permitidos. La ejecución queda guardada y podrás reanudarla mañana.",
    action: "wait",
  },
  step_persist_failed: {
    title: "No se pudo guardar el resultado del agente",
    detail: "La base de datos no respondió a tiempo. Reanuda la ejecución: el paso se repetirá de forma segura.",
    action: "resume",
  },
  server_error: {
    title: "Error inesperado del servidor",
    detail: "Algo falló al procesar la petición. Vuelve a intentarlo en unos segundos.",
    action: "resume",
  },
  network_error: {
    title: "Sin conexión con el servidor",
    detail: "Comprueba tu conexión a internet. La ejecución queda guardada y puedes reanudarla cuando vuelvas a estar en línea.",
    action: "resume",
  },
  request_timeout: {
    title: "El servidor tardó demasiado",
    detail: "El paso no respondió a tiempo. Puede seguir en marcha en el servidor; reanuda la ejecución para comprobarlo.",
    action: "resume",
  },
  invalid_response: {
    title: "Respuesta inesperada del servidor",
    detail: "El servidor devolvió datos que no se pueden interpretar. Reanuda la ejecución o recarga la página.",
    action: "resume",
  },
};

export function isKnownErrorCode(
  code: unknown,
): code is ApiErrorCode | ClientErrorCode {
  return typeof code === "string" && Object.hasOwn(apiMessages, code);
}

export function describeApiError(
  code: ApiErrorCode | ClientErrorCode,
  options: { detail?: string; retryAfterSeconds?: number } = {},
): UserFacingError {
  const base = apiMessages[code];
  const wait = options.retryAfterSeconds
    ? ` Podrás volver a intentarlo ${formatWait(options.retryAfterSeconds)}.`
    : "";
  return {
    code,
    ...base,
    detail: `${options.detail ?? base.detail}${wait}`,
    ...(options.retryAfterSeconds
      ? { retryAfterSeconds: options.retryAfterSeconds }
      : {}),
  };
}

/** Parses an error body `{ code, error, detail?, retryAfterSeconds? }`. */
export function describeApiErrorBody(
  payload: unknown,
  fallback: ApiErrorCode = "server_error",
): UserFacingError {
  if (typeof payload !== "object" || payload === null) {
    return describeApiError("invalid_response");
  }
  const body = payload as Record<string, unknown>;
  const code = isKnownErrorCode(body.code) ? body.code : fallback;
  const retryAfterSeconds =
    typeof body.retryAfterSeconds === "number" &&
    Number.isFinite(body.retryAfterSeconds)
      ? Math.max(1, Math.round(body.retryAfterSeconds))
      : undefined;
  return describeApiError(code, {
    detail: typeof body.detail === "string" ? body.detail : undefined,
    retryAfterSeconds,
  });
}

export function formatWait(seconds: number): string {
  if (seconds < 60) {
    return `en ${Math.max(1, Math.round(seconds))} s`;
  }
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) {
    return `en ${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `en ${hours} h` : `en ${hours} h ${rest} min`;
}

/* ------------------------------------------------------------------ */
/* Persisted run failures                                               */
/* ------------------------------------------------------------------ */

const agentNames: Record<AgentEvent["agent"], string> = {
  orchestrator: "el Orquestador",
  develop: "Develop",
  testing: "Testing",
  system: "el sistema",
};

const failureMessages: Record<
  string,
  { title: string; detail: (agent: string) => string; action: ErrorAction }
> = {
  rate_limited: {
    title: "Cuota del proveedor agotada",
    detail: (agent) =>
      `Los modelos gratuitos rechazaron la llamada ${de(agent)} por límite de uso (HTTP 429) en todos los intentos. Espera unos minutos y vuelve a lanzar la petición; si sigue igual, la cuota diaria del plan gratuito puede estar agotada.`,
    action: "retry_run",
  },
  provider_error: {
    title: "Los proveedores de IA no están disponibles",
    detail: (agent) =>
      `Gemini y el resto de la cadena devolvieron errores al trabajar en ${agent}, normalmente por saturación temporal (HTTP 503). Vuelve a lanzar la petición en unos minutos.`,
    action: "retry_run",
  },
  provider_timeout: {
    title: "El modelo tardó demasiado en responder",
    detail: (agent) =>
      `Ningún proveedor respondió a tiempo para ${agent}. Prueba con una petición más acotada o vuelve a intentarlo más tarde.`,
    action: "retry_run",
  },
  provider_attempts_exhausted: {
    title: "Se agotaron los reintentos",
    detail: (agent) =>
      `${capitalize(agent)} lo intentó varias veces sin conseguir respuesta de los modelos. Vuelve a lanzar la petición en unos minutos.`,
    action: "retry_run",
  },
  invalid_structured_output: {
    title: "El modelo devolvió una respuesta mal formada",
    detail: (agent) =>
      `La salida ${de(agent)} no tenía el formato esperado y se descartó por seguridad. Reformula la petición con más detalle y vuelve a intentarlo.`,
    action: "edit",
  },
  invalid_agent_output: {
    title: "La respuesta del agente no pasó la validación",
    detail: (agent) =>
      `La salida ${de(agent)} incumplía las reglas del proyecto (rutas, tamaños o dependencias) y se descartó. Reformula la petición de forma más concreta.`,
    action: "edit",
  },
  project_context_limit: {
    title: "El proyecto superó el tamaño permitido",
    detail: () =>
      "Los archivos generados exceden los límites del proyecto virtual. Divide la petición en partes más pequeñas.",
    action: "edit",
  },
  artifact_load_failed: {
    title: "No se pudieron cargar los archivos del proyecto",
    detail: () =>
      "La base de datos no devolvió los archivos a tiempo. Vuelve a lanzar la petición.",
    action: "retry_run",
  },
  iteration_limit: {
    title: "Testing rechazó la tarea demasiadas veces",
    detail: () =>
      "Develop no consiguió cumplir los criterios dentro del límite de iteraciones. Revisa el informe de Testing de la tarea y reformula la petición.",
    action: "edit",
  },
  dependency_error: {
    title: "El plan tenía dependencias imposibles",
    detail: () =>
      "Algunas tareas dependían de otras que no se podían completar. Vuelve a lanzar la petición.",
    action: "retry_run",
  },
  agent_step_error: {
    title: "Un agente falló de forma inesperada",
    detail: (agent) =>
      `${capitalize(agent)} no pudo completar su paso. Vuelve a lanzar la petición.`,
    action: "retry_run",
  },
};

function de(agent: string): string {
  return agent.startsWith("el ") ? `del ${agent.slice(3)}` : `de ${agent}`;
}

function capitalize(value: string): string {
  return value.replace(/^el /, "El ");
}

function getErrorCode(event: AgentEvent): string | null {
  const metadata = event.metadata;
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    return null;
  }
  const code = metadata.errorCode;
  return typeof code === "string" ? code : null;
}

function sortedEvents(events: AgentEvent[], type: string): AgentEvent[] {
  return events
    .filter((event) => event.event_type === type)
    .sort((left, right) =>
      left.created_at === right.created_at
        ? left.id - right.id
        : left.created_at.localeCompare(right.created_at),
    );
}

/** Explains why a failed run stopped, or returns null for other states. */
export function describeRunFailure(
  run: Run,
  events: AgentEvent[],
): UserFacingError | null {
  if (run.status !== "failed") {
    return null;
  }

  const failure = sortedEvents(events, "agent_failed").at(-1);
  const agent = agentNames[failure?.agent ?? "system"];
  let code = failure ? getErrorCode(failure) : null;

  if (!code) {
    const message = run.error_message ?? "";
    if (/iteration limit/i.test(message)) {
      code = "iteration_limit";
    } else if (/dependencies/i.test(message)) {
      code = "dependency_error";
    } else if (/exhausted its retry limit/i.test(message)) {
      // The claim RPC gives up without an error code; the last scheduled
      // retry tells us what kept failing.
      const lastRetry = sortedEvents(events, "retry_scheduled").at(-1);
      const cause = lastRetry ? getErrorCode(lastRetry) : null;
      code = cause && failureMessages[cause] ? cause : "provider_attempts_exhausted";
    } else {
      const match = /Agent step failed: ([a-z0-9_]+)/.exec(message);
      code = match?.[1] ?? "agent_step_error";
    }
  }

  const entry = failureMessages[code] ?? failureMessages.agent_step_error;
  return {
    code,
    title: entry.title,
    detail: entry.detail(agent),
    action: entry.action,
  };
}

const retryCauses: Record<string, string> = {
  rate_limited: "los modelos gratuitos han alcanzado su límite de uso (HTTP 429)",
  provider_error: "los proveedores de IA están saturados",
  provider_timeout: "los modelos tardaron demasiado en responder",
  artifact_load_failed: "la base de datos no devolvió los archivos",
};

/**
 * Explains an automatic retry in progress, or returns null. `now` is null
 * until the browser clock is known; the countdown is then omitted.
 */
export function describeRetryWait(
  run: Run,
  events: AgentEvent[],
  now: number | null,
): UserFacingError | null {
  if (run.status !== "retry_wait") {
    return null;
  }
  const retry = sortedEvents(events, "retry_scheduled").at(-1);
  const code = (retry && getErrorCode(retry)) || "provider_error";
  const metadata =
    retry && typeof retry.metadata === "object" && retry.metadata !== null && !Array.isArray(retry.metadata)
      ? retry.metadata
      : {};
  const retryAt = typeof metadata.retryAt === "string" ? Date.parse(metadata.retryAt) : NaN;
  const attempt = typeof metadata.attempt === "number" ? metadata.attempt : null;
  const seconds =
    Number.isNaN(retryAt) || now === null
      ? null
      : Math.max(1, Math.ceil((retryAt - now) / 1000));
  const agent = agentNames[retry?.agent ?? "system"];

  return {
    code,
    title: "Reintento automático en marcha",
    detail: `${capitalize(agent)} no pudo avanzar porque ${retryCauses[code] ?? "el paso falló de forma temporal"}. ${
      seconds === null ? "Se volverá a intentar en breve" : `Se volverá a intentar ${formatWait(seconds)}`
    }${attempt ? ` (intento ${attempt + 1} de 4)` : ""}. No hace falta que hagas nada.`,
    action: "wait",
    ...(seconds === null ? {} : { retryAfterSeconds: seconds }),
  };
}

const shortFailureSummaries: Record<string, string> = {
  rate_limited: "El proveedor rechazó la llamada por límite de uso (HTTP 429).",
  provider_error: "Los proveedores de IA no respondieron correctamente.",
  provider_timeout: "Ningún proveedor respondió a tiempo.",
  provider_attempts_exhausted: "Se agotaron los reintentos del paso.",
  invalid_structured_output: "El modelo devolvió una respuesta mal formada.",
  invalid_agent_output: "La respuesta del agente no pasó la validación.",
  project_context_limit: "El proyecto superó el tamaño permitido.",
  artifact_load_failed: "No se pudieron cargar los archivos del proyecto.",
  agent_step_error: "El agente falló de forma inesperada.",
};

const systemSummaries: Record<string, string> = {
  "A new agent run was created.": "El Orquestador recibió la petición.",
  "All planned tasks passed testing.": "Testing aprobó todas las tareas del plan.",
  "Task dependencies could not be resolved.":
    "Algunas tareas dependían de otras que no se pudieron completar.",
  "Task iteration limit reached after failed testing.":
    "Testing rechazó la tarea en todas las iteraciones permitidas.",
};

/**
 * Iteration encoded in a step key such as "task:<id>:develop:1". The RPC
 * writes the task's iteration_count, which is already 1 for the first try
 * (verified against a real run: the first Develop step carries ":develop:1").
 */
function getStepIteration(event: AgentEvent): number | null {
  const metadata = event.metadata;
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    return null;
  }
  const match =
    typeof metadata.stepKey === "string" ? /:(\d+)$/.exec(metadata.stepKey) : null;
  return match ? Number(match[1]) : null;
}

/**
 * Spanish one-line summary for events whose stored text is written by the
 * server (RPCs and error classification) in English for the audit log.
 * Steps are named after their task. Returns null to keep the stored text,
 * which for plans, deliveries and reviews is the agents' own summary.
 */
export function describeEventSummary(
  event: AgentEvent,
  tasks: ReadonlyArray<{ id: string; title: string }> = [],
): string | null {
  if (event.event_type === "agent_failed" || event.event_type === "retry_scheduled") {
    const code = getErrorCode(event);
    if (code && shortFailureSummaries[code]) {
      return shortFailureSummaries[code];
    }
    if (/exhausted its retry limit/i.test(event.output_summary ?? "")) {
      return shortFailureSummaries.provider_attempts_exhausted;
    }
    return null;
  }
  if (event.event_type === "step_started") {
    if (event.agent === "orchestrator") {
      return "Plan de tareas";
    }
    const task = tasks.find((candidate) => candidate.id === event.task_id);
    if (!task) {
      return null;
    }
    const iteration = getStepIteration(event);
    return iteration && iteration > 1 ? `${task.title} (iteración ${iteration})` : task.title;
  }
  // run_created stores its text in input_summary, the others in output_summary.
  for (const stored of [event.output_summary, event.input_summary]) {
    const translated = stored ? systemSummaries[stored.trim()] : undefined;
    if (translated) {
      return translated;
    }
  }
  return null;
}

/** Maps an exception thrown by `fetch` (or our own parsing) to a message. */
export function describeClientError(error: unknown): UserFacingError {
  if (isUserFacingError(error)) {
    return error;
  }
  if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return describeApiError("request_timeout");
  }
  if (error instanceof TypeError) {
    // fetch rejects with TypeError when the network is unreachable.
    return describeApiError("network_error");
  }
  return describeApiError("server_error");
}

export function isUserFacingError(value: unknown): value is UserFacingError {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as UserFacingError).code === "string" &&
    typeof (value as UserFacingError).title === "string" &&
    typeof (value as UserFacingError).detail === "string"
  );
}
