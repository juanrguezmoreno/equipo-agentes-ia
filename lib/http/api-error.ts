import {
  describeApiError,
  type ApiErrorCode,
} from "@/lib/errors/user-messages";

/**
 * JSON error response with a stable `code` for the browser, a Spanish
 * message, and `Retry-After` when waiting will help.
 */
export function apiError(
  code: ApiErrorCode,
  status: number,
  options: { detail?: string; retryAfterSeconds?: number } = {},
): Response {
  const message = describeApiError(code, { detail: options.detail });
  const headers = new Headers();
  if (options.retryAfterSeconds) {
    headers.set("Retry-After", String(options.retryAfterSeconds));
  }
  return Response.json(
    {
      code,
      error: message.title,
      detail: message.detail,
      ...(options.retryAfterSeconds
        ? { retryAfterSeconds: options.retryAfterSeconds }
        : {}),
    },
    { status, headers },
  );
}
