import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import type { ApiErrorCode } from "@/lib/errors/user-messages";
import {
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
  evaluateWindow,
  getRateLimits,
  type WindowUsage,
} from "./policy";

type AdminClient = ReturnType<typeof createAdminClient>;

export type RateLimitResult =
  | { allowed: true }
  | {
      allowed: false;
      code: ApiErrorCode;
      retryAfterSeconds: number;
    }
  | { allowed: false; code: "server_error"; retryAfterSeconds?: undefined };

interface QueryResult {
  data: Array<{ created_at: string }> | null;
  count: number | null;
  error: { code?: string } | null;
}

function toUsage(result: QueryResult): WindowUsage | null {
  if (result.error || result.count === null) {
    return null;
  }
  return { count: result.count, oldest: result.data?.[0]?.created_at ?? null };
}

/**
 * Checks the run-creation limits for one user, most restrictive scope first.
 * Count-then-insert is not atomic: two simultaneous requests can both pass,
 * so the per-user hourly cap is also enforced inside the create_agent_run
 * RPC under an advisory lock. Errors fail closed to protect the quota.
 */
export async function checkRunCreationLimit(
  admin: AdminClient,
  ownerId: string,
  now: number = Date.now(),
): Promise<RateLimitResult> {
  const limits = getRateLimits();
  const since = (windowMs: number) => new Date(now - windowMs).toISOString();

  const [global, userDay, userHour] = await Promise.all([
    admin
      .from("agent_runs")
      .select("created_at", { count: "exact" })
      .gte("created_at", since(DAY_MS))
      .order("created_at", { ascending: true })
      .limit(1),
    admin
      .from("agent_runs")
      .select("created_at", { count: "exact" })
      .eq("owner_id", ownerId)
      .gte("created_at", since(DAY_MS))
      .order("created_at", { ascending: true })
      .limit(1),
    admin
      .from("agent_runs")
      .select("created_at", { count: "exact" })
      .eq("owner_id", ownerId)
      .gte("created_at", since(HOUR_MS))
      .order("created_at", { ascending: true })
      .limit(1),
  ]);

  const checks: Array<[WindowUsage | null, number, number, ApiErrorCode]> = [
    [toUsage(global), limits.runsGlobalDay, DAY_MS, "global_quota_exhausted"],
    [toUsage(userDay), limits.runsPerUserDay, DAY_MS, "run_rate_limited_day"],
    [toUsage(userHour), limits.runsPerUserHour, HOUR_MS, "run_rate_limited_hour"],
  ];
  return firstViolation(checks, now);
}

/**
 * Checks how many model-backed step attempts the user started recently.
 * Only claimed attempts create rows, so polling a waiting run is free.
 */
export async function checkStepLimit(
  admin: AdminClient,
  ownerId: string,
  now: number = Date.now(),
): Promise<RateLimitResult> {
  const limits = getRateLimits();
  const query = (windowMs: number) =>
    admin
      .from("step_attempts")
      .select("created_at, agent_runs!inner(owner_id)", { count: "exact" })
      .eq("agent_runs.owner_id", ownerId)
      .gte("created_at", new Date(now - windowMs).toISOString())
      .order("created_at", { ascending: true })
      .limit(1);

  const [day, minute] = await Promise.all([query(DAY_MS), query(MINUTE_MS)]);
  const checks: Array<[WindowUsage | null, number, number, ApiErrorCode]> = [
    [toUsage(day), limits.stepsPerUserDay, DAY_MS, "step_quota_exhausted"],
    [toUsage(minute), limits.stepsPerUserMinute, MINUTE_MS, "step_rate_limited"],
  ];
  return firstViolation(checks, now);
}

function firstViolation(
  checks: Array<[WindowUsage | null, number, number, ApiErrorCode]>,
  now: number,
): RateLimitResult {
  for (const [usage, limit, windowMs, code] of checks) {
    if (!usage) {
      return { allowed: false, code: "server_error" };
    }
    const decision = evaluateWindow(usage, limit, windowMs, now);
    if (!decision.allowed) {
      return { allowed: false, code, retryAfterSeconds: decision.retryAfterSeconds };
    }
  }
  return { allowed: true };
}
