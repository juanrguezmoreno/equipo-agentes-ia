import { afterEach, describe, expect, it, vi } from "vitest";
import type { createAdminClient } from "@/lib/supabase/admin";
import { checkRunCreationLimit, checkStepLimit } from "./check";

type AdminClient = ReturnType<typeof createAdminClient>;

interface Query {
  table: string;
  select: string;
  filters: Record<string, string>;
}

type Result = {
  data: Array<{ created_at: string }> | null;
  count: number | null;
  error: { code: string } | null;
};

/** Minimal chainable stand-in for the Supabase query builder. */
function fakeAdmin(resolve: (query: Query) => Result) {
  const queries: Query[] = [];
  const client = {
    from(table: string) {
      const query: Query = { table, select: "", filters: {} };
      queries.push(query);
      const builder = {
        select(columns: string) {
          query.select = columns;
          return builder;
        },
        eq(column: string, value: string) {
          query.filters[`eq:${column}`] = value;
          return builder;
        },
        gte(column: string, value: string) {
          query.filters[`gte:${column}`] = value;
          return builder;
        },
        order() {
          return builder;
        },
        limit() {
          return builder;
        },
        then<T>(onFulfilled: (value: Result) => T) {
          return Promise.resolve(resolve(query)).then(onFulfilled);
        },
      };
      return builder;
    },
  };
  return { admin: client as unknown as AdminClient, queries };
}

const now = Date.parse("2026-11-24T12:00:00.000Z");
const ago = (ms: number) => new Date(now - ms).toISOString();
const ok = (count: number, oldest: string | null = null): Result => ({
  data: oldest ? [{ created_at: oldest }] : [],
  count,
  error: null,
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("checkRunCreationLimit", () => {
  const windowOf = (query: Query) =>
    now - Date.parse(query.filters["gte:created_at"]);

  it("allows a user under every limit and scopes the queries", async () => {
    const { admin, queries } = fakeAdmin(() => ok(0));
    await expect(checkRunCreationLimit(admin, "user-1", now)).resolves.toEqual({
      allowed: true,
    });
    expect(queries).toHaveLength(3);
    // One global query (no owner filter) and two per-user queries.
    expect(queries.filter((query) => query.filters["eq:owner_id"] === "user-1")).toHaveLength(2);
    expect(queries.filter((query) => !query.filters["eq:owner_id"])).toHaveLength(1);
  });

  it("reports the hourly limit with the time until a slot frees up", async () => {
    const { admin } = fakeAdmin((query) =>
      query.filters["eq:owner_id"] && windowOf(query) === 3_600_000
        ? ok(5, ago(45 * 60_000))
        : ok(5),
    );
    await expect(checkRunCreationLimit(admin, "user-1", now)).resolves.toEqual({
      allowed: false,
      code: "run_rate_limited_hour",
      retryAfterSeconds: 15 * 60,
    });
  });

  it("checks the global limit before the per-user ones", async () => {
    const { admin } = fakeAdmin((query) =>
      query.filters["eq:owner_id"] ? ok(99, ago(1_000)) : ok(150, ago(23 * 3_600_000)),
    );
    await expect(checkRunCreationLimit(admin, "user-1", now)).resolves.toMatchObject({
      allowed: false,
      code: "global_quota_exhausted",
      retryAfterSeconds: 3_600,
    });
  });

  it("honours limits configured through the environment", async () => {
    vi.stubEnv("RATE_LIMIT_RUNS_PER_USER_DAY", "2");
    const { admin } = fakeAdmin((query) =>
      query.filters["eq:owner_id"] && windowOf(query) > 3_600_000 ? ok(2, ago(3_600_000)) : ok(0),
    );
    await expect(checkRunCreationLimit(admin, "user-1", now)).resolves.toMatchObject({
      code: "run_rate_limited_day",
    });
  });

  it("fails closed when a count cannot be read", async () => {
    const { admin } = fakeAdmin(() => ({ data: null, count: null, error: { code: "57014" } }));
    await expect(checkRunCreationLimit(admin, "user-1", now)).resolves.toEqual({
      allowed: false,
      code: "server_error",
    });
  });
});

describe("checkStepLimit", () => {
  it("counts only the user's attempts through the run owner", async () => {
    const { admin, queries } = fakeAdmin(() => ok(3));
    await expect(checkStepLimit(admin, "user-1", now)).resolves.toEqual({ allowed: true });
    expect(queries.every((query) => query.table === "step_attempts")).toBe(true);
    expect(queries.every((query) => query.select.includes("agent_runs!inner"))).toBe(true);
    expect(queries.every((query) => query.filters["eq:agent_runs.owner_id"] === "user-1")).toBe(
      true,
    );
  });

  it("pauses at the per-minute limit", async () => {
    const { admin } = fakeAdmin((query) =>
      now - Date.parse(query.filters["gte:created_at"]) === 60_000
        ? ok(10, ago(50_000))
        : ok(10),
    );
    await expect(checkStepLimit(admin, "user-1", now)).resolves.toEqual({
      allowed: false,
      code: "step_rate_limited",
      retryAfterSeconds: 10,
    });
  });
});
