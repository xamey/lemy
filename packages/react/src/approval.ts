export type ToolApprovalMode = "auto" | "ask";

const TOOL_NAME = /^[A-Za-z0-9_.:-]{1,128}$/;

export function normalizeApprovedTools(approvedTools: readonly string[] = []): string[] {
  const normalized = [...new Set(approvedTools)].sort();
  if (normalized.length > 128 || normalized.some((name) => !TOOL_NAME.test(name))) {
    throw new Error("approvedTools contains an invalid tool name");
  }
  return normalized;
}
