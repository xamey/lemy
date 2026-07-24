import { describe, expect, it } from "vitest";

import { requiresToolApproval } from "../src/worker/project-agent";

describe("project agent approval policies", () => {
  it("supports never, mutation-only, remembered, and always approval", () => {
    expect(requiresToolApproval({ approvedTools: [], toolApprovalMode: "auto" }, "api.list", true)).toBe(false);
    expect(requiresToolApproval({ approvedTools: [], toolApprovalMode: "mutations" }, "api.list", false)).toBe(false);
    expect(requiresToolApproval({ approvedTools: [], toolApprovalMode: "mutations" }, "api.create", true)).toBe(true);
    expect(requiresToolApproval({ approvedTools: ["api.create"], toolApprovalMode: "mutations" }, "api.create", true)).toBe(false);
    expect(requiresToolApproval({ approvedTools: ["api.list"], toolApprovalMode: "always" }, "api.list", false)).toBe(true);
  });
});
