import { describe, expect, it } from "vitest";

import { normalizeApprovedTools, normalizeToolApprovalMode } from "../src/approval.js";

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

describe("normalizeToolApprovalMode", () => {
  it("supports every approval policy and preserves the legacy ask alias", () => {
    expect(normalizeToolApprovalMode("auto")).toBe("auto");
    expect(normalizeToolApprovalMode("mutations")).toBe("mutations");
    expect(normalizeToolApprovalMode("always")).toBe("always");
    expect(normalizeToolApprovalMode("ask")).toBe("mutations");
  });
});
