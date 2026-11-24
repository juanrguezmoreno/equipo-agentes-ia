import { createHash } from "node:crypto";
import type {
  DeterministicCheckResult,
  TaskAcceptanceCriteria,
  TestReport,
} from "./schemas";

/**
 * Paths a task may write: every path its checks name. The Orchestrator's
 * declared `files` are stored as file_exists checks, and plan repair keeps
 * the other checks on the same paths.
 */
export function taskScope(criteria: TaskAcceptanceCriteria): string[] {
  return [...new Set(criteria.checks.map((check) => check.path))].sort();
}

export function splitByScope<T extends { path: string }>(
  files: readonly T[],
  scope: readonly string[],
): { allowed: T[]; outside: T[] } {
  const allowedPaths = new Set(scope);
  return {
    allowed: files.filter((file) => allowedPaths.has(file.path)),
    outside: files.filter((file) => !allowedPaths.has(file.path)),
  };
}

export function contentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export interface DeliveredFile {
  path: string;
  revision: number;
  content: string;
  /** Content of the previous revision of the same path, if any. */
  previousContent: string | null;
}

export interface DeliveryGateInput {
  /** Iteration of the delivery under test (1 for the first). */
  iteration: number;
  /** Files written by the latest Develop step of this task. */
  delivered: readonly DeliveredFile[];
  /** Paths Develop tried to write outside the task's scope in this iteration. */
  outOfScopePaths: readonly string[];
  /** Testing report that rejected the previous iteration, if any. */
  previousReport: unknown;
}

export type DeliveryGateResult =
  /** Run the normal checks, adding these scope failures to them. */
  | { kind: "continue"; scopeChecks: DeterministicCheckResult[] }
  /** Do not test: return this report to Develop as the iteration's result. */
  | { kind: "blocked"; report: TestReport };

/**
 * Runs before the Testing agent. Two things never reach it:
 *
 * - Writes outside the task's files. The server never stored them; they are
 *   reported as failed `alcance:` checks next to the normal checks.
 * - A resend: after a rejection, a delivery whose every file hashes the same
 *   as its previous revision. Nothing changed, so testing again would only
 *   repeat the verdict. The rejection's failed checks are returned with an
 *   explicit warning, and the iteration still counts.
 */
export function evaluateDeliveryGate(input: DeliveryGateInput): DeliveryGateResult {
  const scopeChecks: DeterministicCheckResult[] = input.outOfScopePaths.map((path) => ({
    name: `alcance:${path}`.slice(0, 240),
    passed: false,
    details: `Develop intentó escribir ${path}, que no está entre los archivos de esta tarea. No se guardó: modifica solo los archivos asignados o pide ese cambio en su propia tarea.`,
  }));

  const previous = asFailedReport(input.previousReport);
  const unchanged =
    input.iteration > 1 &&
    previous !== null &&
    input.delivered.length > 0 &&
    input.delivered.every(
      (file) =>
        file.previousContent !== null &&
        contentHash(file.content) === contentHash(file.previousContent),
    );

  if (!unchanged) {
    return { kind: "continue", scopeChecks };
  }

  const paths = input.delivered.map((file) => file.path).join(", ");
  const repeated: DeterministicCheckResult = {
    name: "sin-cambios".concat(input.delivered.length === 1 ? `:${input.delivered[0].path}` : ""),
    passed: false,
    details: `Develop reenvió ${paths} con el mismo contenido (SHA-256 ${contentHash(input.delivered[0].content).slice(0, 12)}…) que la revisión rechazada. No se volvió a probar: corrige primero las comprobaciones fallidas de abajo.`.slice(0, 1000),
  };
  const carried = previous.deterministicChecks.filter((check) => !check.passed);
  const reviewFindings =
    previous.review && !previous.review.passed
      ? [
          {
            name: "revision-anterior",
            passed: false,
            details: `Hallazgos de la revisión anterior sin resolver: ${previous.review.summary}`.slice(0, 1000),
          },
        ]
      : [];

  return {
    kind: "blocked",
    report: {
      passed: false,
      summary: "Develop reenvió los mismos archivos tras el rechazo; no se enviaron a Testing.",
      deterministicChecks: [repeated, ...scopeChecks, ...carried, ...reviewFindings].slice(0, 40),
      review: null,
    },
  };
}

interface FailedReport {
  deterministicChecks: DeterministicCheckResult[];
  review: { passed: boolean; summary: string } | null;
}

function asFailedReport(value: unknown): FailedReport | null {
  if (typeof value !== "object" || value === null) return null;
  const report = value as Partial<TestReport>;
  if (report.passed !== false || !Array.isArray(report.deterministicChecks)) return null;
  return {
    deterministicChecks: report.deterministicChecks,
    review: report.review ?? null,
  };
}
