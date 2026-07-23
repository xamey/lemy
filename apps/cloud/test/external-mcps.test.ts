import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import {
  connectExternalMcpWithBearer,
  createExternalMcp,
  decryptExternalMcpCredential,
  disconnectExternalMcp,
  getExternalMcp,
  listExternalMcps,
  validateExternalMcpUrl,
} from "../src/worker/external-mcps";
import { createProject } from "../src/worker/projects";

const projectInput = {
  name: "Tasks API",
  openapiSchemaUrl: "https://api.example.com/openapi.json",
  openapiBaseUrl: "https://api.example.com",
  bearerValidationUrl: "https://api.example.com/me",
  corsOrigins: ["https://app.example.com"],
  allowMutations: false,
  llmProvider: "openai" as const,
  llmModel: "gpt-5.6-luna",
  skills: [],
  llmBaseUrl: null,
};

describe("external MCPs", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM project WHERE owner_id IN ('mcp-user-1', 'mcp-user-2')").run();
    const now = Date.now();
    await env.DB.batch(
      ["mcp-user-1", "mcp-user-2"].map((id) =>
        env.DB.prepare(
          "INSERT OR IGNORE INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
        ).bind(id, id, `${id}@example.com`, now, now),
      ),
    );
  });

  it("keeps MCP configuration scoped to its project owner", async () => {
    const project = await createProject(env, "mcp-user-1", projectInput);
    const mcp = await createExternalMcp(env, "mcp-user-1", project.id, {
      name: "GitHub",
      url: "https://mcp.example.com/mcp",
      authType: "oauth",
    });

    expect(await listExternalMcps(env.DB, "mcp-user-1", project.id)).toEqual([mcp]);
    expect(await listExternalMcps(env.DB, "mcp-user-2", project.id)).toEqual([]);
    expect(await getExternalMcp(env.DB, "mcp-user-2", project.id, mcp.id)).toBeNull();
  });

  it("encrypts a Bearer and clears it on disconnect", async () => {
    const project = await createProject(env, "mcp-user-1", projectInput);
    const mcp = await createExternalMcp(env, "mcp-user-1", project.id, {
      name: "Private MCP",
      url: "https://mcp.example.com/mcp",
      authType: "bearer",
    });

    const connected = await connectExternalMcpWithBearer(
      env,
      "mcp-user-1",
      project.id,
      mcp.id,
      "Bearer external-secret",
    );
    const stored = await getExternalMcp(env.DB, "mcp-user-1", project.id, mcp.id);
    const raw = await env.DB.prepare(
      "SELECT credential_ciphertext FROM external_mcp WHERE id = ?",
    ).bind(mcp.id).first<{ credential_ciphertext: string }>();

    expect(connected).toMatchObject({ connected: true });
    expect(raw?.credential_ciphertext).not.toContain("external-secret");
    expect(await decryptExternalMcpCredential(env, stored!)).toEqual({
      type: "bearer",
      token: "external-secret",
    });

    expect(
      await disconnectExternalMcp(env.DB, "mcp-user-1", project.id, mcp.id),
    ).toMatchObject({ connected: false });
    expect(
      await decryptExternalMcpCredential(
        env,
        (await getExternalMcp(env.DB, "mcp-user-1", project.id, mcp.id))!,
      ),
    ).toBeNull();
  });

  it("rejects remote URLs that can target private infrastructure", () => {
    const blockedUrls = [
      "https://169.254.169.254/mcp",
      "https://10.0.0.1/mcp",
      "https://service.internal/mcp",
      "https://[::1]/mcp",
      "https://[::]/mcp",
      "https://[::ffff:127.0.0.1]/mcp",
      "https://[::ffff:169.254.169.254]/mcp",
      "https://[fe80::1]/mcp",
      "https://[fc00::1]/mcp",
      "https://[ff02::1]/mcp",
    ];

    for (const url of blockedUrls) {
      expect(() => validateExternalMcpUrl(url)).toThrow("public HTTPS");
    }
  });

  it("caps external MCPs per project", async () => {
    const project = await createProject(env, "mcp-user-1", projectInput);
    await Promise.all(Array.from({ length: 16 }, (_, index) => createExternalMcp(
      env,
      "mcp-user-1",
      project.id,
      { name: `MCP ${index}`, url: `https://mcp${index}.example.com/mcp`, authType: "bearer" },
    )));

    await expect(createExternalMcp(env, "mcp-user-1", project.id, {
      name: "One too many",
      url: "https://overflow.example.com/mcp",
      authType: "bearer",
    })).rejects.toThrow("External MCP limit reached");
  });
});
