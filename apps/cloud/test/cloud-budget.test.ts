import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import {
  consumeDynamicWorkerBudget,
  getCloudBudgetUsage,
} from "../src/worker/cloud-budget";

describe("cloud budget", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM cloud_budget").run();
  });

  it("atomically rejects Code Mode executions above the monthly limit", async () => {
    const budgetEnv = { DB: env.DB, MAX_DYNAMIC_WORKERS_PER_MONTH: "2" };

    expect(await consumeDynamicWorkerBudget(budgetEnv, "owner-1", Date.UTC(2026, 6, 1))).toBe(1);
    expect(await consumeDynamicWorkerBudget(budgetEnv, "owner-1", Date.UTC(2026, 6, 2))).toBe(2);
    await expect(consumeDynamicWorkerBudget(budgetEnv, "owner-1", Date.UTC(2026, 6, 3)))
      .rejects.toThrow("Monthly Code Mode budget reached");
  });

  it("starts a new budget each UTC month", async () => {
    const budgetEnv = { DB: env.DB, MAX_DYNAMIC_WORKERS_PER_MONTH: "1" };

    expect(await consumeDynamicWorkerBudget(budgetEnv, "owner-1", Date.UTC(2026, 6, 31))).toBe(1);
    expect(await consumeDynamicWorkerBudget(budgetEnv, "owner-1", Date.UTC(2026, 7, 1))).toBe(1);
  });

  it("reports the current workspace usage and limit", async () => {
    const budgetEnv = { DB: env.DB, MAX_DYNAMIC_WORKERS_PER_MONTH: "12" };
    const now = Date.UTC(2026, 6, 1);
    await consumeDynamicWorkerBudget(budgetEnv, "owner-1", now);

    expect(await getCloudBudgetUsage(budgetEnv, "owner-1", now)).toEqual({
      used: 1,
      limit: 500,
      month: "2026-07",
    });
  });
});
