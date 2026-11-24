import { describe, expect, it } from "vitest";
import {
  DEFAULT_RATE_LIMITS,
  HOUR_MS,
  MINUTE_MS,
  evaluateWindow,
  getRateLimits,
} from "./policy";

describe("getRateLimits", () => {
  it("uses defaults when nothing is configured", () => {
    expect(getRateLimits({})).toEqual(DEFAULT_RATE_LIMITS);
  });

  it("reads positive integers and ignores invalid values", () => {
    const limits = getRateLimits({
      RATE_LIMIT_RUNS_PER_USER_DAY: "3",
      RATE_LIMIT_RUNS_GLOBAL_DAY: " 40 ",
      RATE_LIMIT_STEPS_PER_USER_MINUTE: "0",
      RATE_LIMIT_STEPS_PER_USER_DAY: "-5",
      RATE_LIMIT_RUNS_PER_USER_HOUR: "2.5",
    });
    expect(limits).toEqual({
      ...DEFAULT_RATE_LIMITS,
      runsPerUserDay: 3,
      runsGlobalDay: 40,
    });
  });
});

describe("evaluateWindow", () => {
  const now = Date.parse("2026-11-24T12:00:00.000Z");

  it("allows requests under the limit", () => {
    expect(evaluateWindow({ count: 4, oldest: null }, 5, HOUR_MS, now)).toEqual({
      allowed: true,
    });
  });

  it("blocks at the limit until the oldest row leaves the window", () => {
    const oldest = new Date(now - 40 * MINUTE_MS).toISOString();
    expect(evaluateWindow({ count: 5, oldest }, 5, HOUR_MS, now)).toEqual({
      allowed: false,
      retryAfterSeconds: 20 * 60,
    });
  });

  it("never asks to wait less than one second", () => {
    const oldest = new Date(now - MINUTE_MS).toISOString();
    expect(evaluateWindow({ count: 10, oldest }, 10, MINUTE_MS, now)).toEqual({
      allowed: false,
      retryAfterSeconds: 1,
    });
  });

  it("falls back to the full window when the timestamp is unknown", () => {
    expect(evaluateWindow({ count: 2, oldest: null }, 1, MINUTE_MS, now)).toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    });
  });
});
