import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import {
  agentAccess,
  createAgentAccessToken,
  getAgentAccessTokenSession,
  listAgentAccessTokens,
  revokeAgentAccessToken,
} from "../src/worker/agent-access-tokens";
import { createProject } from "../src/worker/projects";

describe("agent access tokens", () => {
  let projectId: string;

  beforeEach(async () => {
    const now = Date.now();
    await env.DB.prepare("DELETE FROM project WHERE owner_id = 'agent-user'").run();
    await env.DB.prepare(
      "INSERT OR IGNORE INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
    ).bind("agent-user", "Agent user", "agent@example.com", now, now).run();
    projectId = (await createProject(env, "agent-user", {
      name: "Tasks",
      openapiSchemaUrl: "https://api.example.com/openapi.json",
      openapiBaseUrl: "https://api.example.com",
      bearerValidationUrl: "https://api.example.com/me",
      corsOrigins: ["https://app.example.com"],
      allowMutations: false,
      llmProvider: "openai",
      llmModel: "gpt-5.6-luna",
      skills: [],
    })).id;
  });

  it("reveals a token once, authenticates it, and supports revocation", async () => {
    const created = await createAgentAccessToken(
      env.DB,
      "agent-user",
      projectId,
      { name: "Codex", permission: "write" },
    );

    expect(created.token).toMatch(/^lemy_agent_[A-Za-z0-9_-]{43}$/);
    expect(await listAgentAccessTokens(env.DB, "agent-user", projectId)).toEqual([
      expect.objectContaining({
        id: created.id,
        name: "Codex",
        permission: "write",
        projectId,
      }),
    ]);
    const authenticated = await getAgentAccessTokenSession(env.DB, `Bearer ${created.token}`);
    expect(authenticated?.user.id).toBe("agent-user");
    expect(agentAccess(authenticated)).toEqual({ permission: "write", projectId });

    expect(await revokeAgentAccessToken(env.DB, "agent-user", projectId, created.id)).toBe(true);
    expect(await getAgentAccessTokenSession(env.DB, `Bearer ${created.token}`)).toBeNull();
  });

  it("keeps tokens scoped to an owned project and validates permissions", async () => {
    await expect(createAgentAccessToken(
      env.DB,
      "agent-user",
      crypto.randomUUID(),
      { name: "Unknown", permission: "read" },
    )).rejects.toThrow("Project not found");
    await expect(createAgentAccessToken(
      env.DB,
      "agent-user",
      projectId,
      { name: "Invalid", permission: "admin" },
    )).rejects.toThrow("Permission must be read or write");
  });

  it("rejects malformed and unknown bearer credentials", async () => {
    expect(await getAgentAccessTokenSession(env.DB, "Bearer customer-api-token")).toBeNull();
    expect(await getAgentAccessTokenSession(env.DB, "Bearer lemy_agent_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"))
      .toBeNull();
  });
});
