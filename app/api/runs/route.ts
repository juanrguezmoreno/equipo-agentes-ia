import { z } from "zod";
import { apiError } from "@/lib/http/api-error";
import { checkRunCreationLimit } from "@/lib/rate-limit/check";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser } from "@/lib/supabase/authenticated-user";
import {
  RUN_REQUEST_MAX_BODY_BYTES,
  validateRunRequest,
} from "@/lib/validation/run-request";

const BodySchema = z.object({ request: z.unknown() }).strict();

export async function POST(request: Request) {
  const { user, error: authError } = await getAuthenticatedUser();
  if (authError || !user) {
    return authError?.status && authError.status >= 500
      ? apiError("auth_unavailable", 503)
      : apiError("auth_required", 401);
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return apiError("unsupported_media_type", 415);
  }

  // Reject oversized bodies before buffering them when the client declares
  // the size, and again after reading in case it did not.
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > RUN_REQUEST_MAX_BODY_BYTES) {
    return apiError("payload_too_large", 413);
  }
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > RUN_REQUEST_MAX_BODY_BYTES) {
    return apiError("payload_too_large", 413);
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return apiError("invalid_json", 400);
  }

  const parsedBody = BodySchema.safeParse(body);
  if (!parsedBody.success) {
    return apiError("invalid_json", 400);
  }
  const validation = validateRunRequest(parsedBody.data.request);
  if (!validation.ok) {
    return apiError("invalid_request", 400, { detail: validation.message });
  }

  const admin = createAdminClient();
  const limit = await checkRunCreationLimit(admin, user.id);
  if (!limit.allowed) {
    if (limit.code === "server_error") {
      console.error("Could not evaluate run rate limits.", { ownerId: user.id });
      return apiError("server_error", 503);
    }
    console.warn("Run creation rate limited.", {
      code: limit.code,
      ownerId: user.id,
      retryAfterSeconds: limit.retryAfterSeconds,
    });
    return apiError(limit.code, 429, {
      retryAfterSeconds: limit.retryAfterSeconds,
    });
  }

  const { data: runId, error } = await admin.rpc("create_agent_run", {
    p_owner_id: user.id,
    p_request: validation.value,
  });

  if (error) {
    if (error.code === "P0001" && error.message === "RUN_RATE_LIMIT") {
      // Postgres enforces 5 runs per hour atomically; it reaches this branch
      // only when concurrent requests raced past the check above.
      return apiError("run_rate_limited_hour", 429, { retryAfterSeconds: 60 });
    }

    console.error("Could not create agent run.", {
      code: error.code,
      ownerId: user.id,
    });
    return apiError("server_error", 500);
  }

  return Response.json({ runId }, { status: 201 });
}
