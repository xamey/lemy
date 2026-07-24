import { describe, expect, it } from "vitest";

import {
  createRuntimeSession,
  openRuntimeSession,
  runtimeAgentName,
} from "../src/worker/runtime-session";

const key = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const projectId = "4aa8cfa1-f779-4a7f-af6e-8bf3c0b483b8";
const threadId = "94e3456c-25d8-4e56-954d-e4a1dc00e6d5";

describe("runtime sessions", () => {
  it("encrypts the customer bearer and scopes the agent to project, principal, and thread", async () => {
    const session = await createRuntimeSession({
      approvedTools: ["tasks.completeTask"],
      authorization: "Bearer customer-secret",
      expiresAt: 1_300,
      principal: "a".repeat(64),
      projectId,
      threadId,
      toolApprovalMode: "ask",
    }, key, 1_000);

    expect(session.token).not.toContain("customer-secret");
    expect(session.agentName).toBe(await runtimeAgentName(projectId, "a".repeat(64), threadId));
    await expect(openRuntimeSession(
      session.token,
      key,
      projectId,
      threadId,
      1_000,
    )).resolves.toMatchObject({
      approvedTools: ["tasks.completeTask"],
      authorization: "Bearer customer-secret",
      principal: "a".repeat(64),
      toolApprovalMode: "ask",
    });
  });

  it("rejects expired and cross-project sessions", async () => {
    const session = await createRuntimeSession({
      approvedTools: [],
      authorization: "Bearer customer-secret",
      expiresAt: 1_300,
      principal: "b".repeat(64),
      projectId,
      threadId,
      toolApprovalMode: "auto",
    }, key, 1_000);

    await expect(openRuntimeSession(
      session.token,
      key,
      projectId,
      threadId,
      1_300,
    )).rejects.toThrow("Runtime session expired");
    await expect(openRuntimeSession(
      session.token,
      key,
      "87e5f8c0-043f-45be-b64f-e3600cb50740",
      threadId,
      1_000,
    )).rejects.toThrow("Runtime session is invalid");
  });

  it("rejects sessions with excessive lifetimes", async () => {
    await expect(createRuntimeSession({
      approvedTools: [],
      authorization: "Bearer customer-secret",
      expiresAt: 1_601,
      principal: "c".repeat(64),
      projectId,
      threadId,
      toolApprovalMode: "ask",
    }, key, 1_000)).rejects.toThrow("Runtime session expiry is invalid");
  });

  it.each(["auto", "mutations", "always"] as const)("accepts the %s approval policy", async (toolApprovalMode) => {
    await expect(createRuntimeSession({
      approvedTools: [],
      authorization: "Bearer customer-secret",
      expiresAt: 1_300,
      principal: "d".repeat(64),
      projectId,
      threadId,
      toolApprovalMode,
    }, key, 1_000)).resolves.toMatchObject({ toolApprovalMode });
  });
});
