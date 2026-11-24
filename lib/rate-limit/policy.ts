/**
 * Rate-limit policy that protects the free model quotas. Counting happens in
 * Postgres (see ./check.ts) because serverless instances share no memory;
 * this module only holds configuration and the pure window arithmetic.
 */

export interface RateLimits {
  /** Runs one user may create per rolling hour (Postgres also caps this at 5). */
  runsPerUserHour: number;
  /** Runs one user may create per rolling 24 h. */
  runsPerUserDay: number;
  /**
   * Runs all users together may create per rolling 24 h. Anonymous sessions
   * are cheap to create, so this is what actually bounds model usage.
   */
  runsGlobalDay: number;
  /** Model-backed agent steps one user may start per rolling minute. */
  stepsPerUserMinute: number;
  /** Model-backed agent steps one user may start per rolling 24 h. */
  stepsPerUserDay: number;
}

export const DEFAULT_RATE_LIMITS: RateLimits = {
  runsPerUserHour: 5,
  runsPerUserDay: 15,
  runsGlobalDay: 150,
  stepsPerUserMinute: 10,
  stepsPerUserDay: 200,
};

const ENV_KEYS: Record<keyof RateLimits, string> = {
  runsPerUserHour: "RATE_LIMIT_RUNS_PER_USER_HOUR",
  runsPerUserDay: "RATE_LIMIT_RUNS_PER_USER_DAY",
  runsGlobalDay: "RATE_LIMIT_RUNS_GLOBAL_DAY",
  stepsPerUserMinute: "RATE_LIMIT_STEPS_PER_USER_MINUTE",
  stepsPerUserDay: "RATE_LIMIT_STEPS_PER_USER_DAY",
};

/** Reads limits from the environment, ignoring invalid values. */
export function getRateLimits(
  env: Record<string, string | undefined> = process.env,
): RateLimits {
  const limits = { ...DEFAULT_RATE_LIMITS };
  for (const key of Object.keys(ENV_KEYS) as Array<keyof RateLimits>) {
    const raw = env[ENV_KEYS[key]]?.trim();
    if (!raw || !/^\d+$/.test(raw)) {
      continue;
    }
    const value = Number(raw);
    if (Number.isSafeInteger(value) && value > 0) {
      limits[key] = value;
    }
  }
  return limits;
}

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

export interface WindowUsage {
  /** Rows counted inside the window. */
  count: number;
  /** Timestamp of the oldest row inside the window, if any. */
  oldest: string | null;
}

export type WindowDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

/**
 * Sliding-window check. When the limit is reached, the caller may retry once
 * the oldest counted row leaves the window.
 */
export function evaluateWindow(
  usage: WindowUsage,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): WindowDecision {
  if (usage.count < limit) {
    return { allowed: true };
  }
  const oldest = usage.oldest ? Date.parse(usage.oldest) : NaN;
  const freesAt = Number.isNaN(oldest) ? now + windowMs : oldest + windowMs;
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil((freesAt - now) / 1000)),
  };
}
