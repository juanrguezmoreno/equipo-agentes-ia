/**
 * Validation of the free-text request a user sends to the agent team. It runs
 * in the browser (instant feedback) and again on the server (source of truth),
 * so it must stay free of server-only imports.
 */

export const RUN_REQUEST_MIN_CHARS = 10;
/**
 * The request is embedded in every Orchestrator, Develop and Testing prompt,
 * so a shorter cap than the 4000-character database limit saves model quota.
 */
export const RUN_REQUEST_MAX_CHARS = 2000;
/** Upper bound for the raw JSON body of POST /api/runs. */
export const RUN_REQUEST_MAX_BODY_BYTES = 16 * 1024;

export type RunRequestIssue =
  | "empty"
  | "too_short"
  | "too_long"
  | "control_characters"
  | "not_meaningful"
  | "contains_secret";

export type RunRequestValidation =
  | { ok: true; value: string }
  | { ok: false; issue: RunRequestIssue; message: string };

export const runRequestMessages: Record<RunRequestIssue, string> = {
  empty: "Escribe qué quieres que construya el equipo.",
  too_short: `Describe la tarea con un poco más de detalle (mínimo ${RUN_REQUEST_MIN_CHARS} caracteres).`,
  too_long: `La petición supera los ${RUN_REQUEST_MAX_CHARS} caracteres. Resúmela para que el equipo no gaste cuota de más.`,
  control_characters:
    "La petición contiene caracteres de control no válidos. Escríbela de nuevo o pégala como texto plano.",
  not_meaningful:
    "La petición no parece una descripción de tarea. Usa palabras para explicar qué quieres construir.",
  contains_secret:
    "Parece que la petición incluye una clave o credencial. Quítala: el texto se envía a un modelo externo.",
};

// C0/C1 control characters except tab and line feed (CR is normalised away).
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/;

const SECRET_PATTERNS: RegExp[] = [
  /\bAIza[0-9A-Za-z_-]{30,}/, // Google API key
  /\bgsk_[0-9A-Za-z]{20,}/, // Groq
  /\bsk-(?:proj-|ant-)?[0-9A-Za-z_-]{20,}/, // OpenAI / Anthropic style
  /\bsb_secret_[0-9A-Za-z_-]{10,}/, // Supabase secret key
  /\bgh[pousr]_[0-9A-Za-z]{30,}/, // GitHub tokens
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key id
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\beyJ[0-9A-Za-z_-]{10,}\.eyJ[0-9A-Za-z_-]{10,}\.[0-9A-Za-z_-]{10,}/, // JWT
];

/** Normalises line endings, Unicode form and surrounding whitespace. */
export function normalizeRunRequest(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function validateRunRequest(raw: unknown): RunRequestValidation {
  if (typeof raw !== "string") {
    return fail("empty");
  }
  const value = normalizeRunRequest(raw);
  if (value.length === 0) {
    return fail("empty");
  }
  if (CONTROL_CHARACTERS.test(value)) {
    return fail("control_characters");
  }
  if (value.length > RUN_REQUEST_MAX_CHARS) {
    return fail("too_long");
  }
  if (value.length < RUN_REQUEST_MIN_CHARS) {
    return fail("too_short");
  }
  if (!isMeaningful(value)) {
    return fail("not_meaningful");
  }
  if (SECRET_PATTERNS.some((pattern) => pattern.test(value))) {
    return fail("contains_secret");
  }
  return { ok: true, value };
}

function isMeaningful(value: string): boolean {
  const letters = value.match(/\p{L}/gu) ?? [];
  if (letters.length < 6) {
    return false;
  }
  // Rejects keyboard mashing such as "aaaaaaaaaaaa" or "jajajajajaja".
  const distinctLetters = new Set(letters.map((letter) => letter.toLowerCase()));
  if (distinctLetters.size < 4) {
    return false;
  }
  const words = value.match(/\p{L}{2,}/gu) ?? [];
  return words.length >= 2;
}

function fail(issue: RunRequestIssue): RunRequestValidation {
  return { ok: false, issue, message: runRequestMessages[issue] };
}
