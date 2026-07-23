import { describe, expect, it } from "vitest";

import { normalizeApprovedTools } from "../src/approval.js";

describe("normalizeApprovedTools", () => {
  it("deduplicates and sorts remembered tools", () => {
    expect(normalizeApprovedTools(["linear.create_issue", "api.listTasks", "linear.create_issue"]))
      .toEqual(["api.listTasks", "linear.create_issue"]);
  });

  it("rejects invalid and excessive tool lists", () => {
    expect(() => normalizeApprovedTools(["invalid tool"])).toThrow("approvedTools");
    expect(() => normalizeApprovedTools(Array.from({ length: 129 }, (_, index) => `tool_${index}`)))
      .toThrow("approvedTools");
  });
});
