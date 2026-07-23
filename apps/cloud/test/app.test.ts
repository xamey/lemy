import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCloudApp } from "../src/worker/app";
import {
  createAgentAccessToken,
  getAgentAccessTokenSession,
} from "../src/worker/agent-access-tokens";
import {
  connectExternalMcpWithBearer,
  createExternalMcp,
} from "../src/worker/external-mcps";
import {
  getProviderApiKey,
  ProviderValidationError,
  saveValidatedProviderCredential,
} from "../src/worker/provider-credentials";

function session(userId: string | null) {
  return userId
    ? {
        user: {
          id: userId,
          name: userId,
          email: `${userId}@example.com`,
          emailVerified: true,
          image: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        session: {
          id: `session-${userId}`,
          userId,
          token: `token-${userId}`,
          expiresAt: new Date(Date.now() + 60_000),
          createdAt: new Date(),
          updatedAt: new Date(),
          ipAddress: null,
          userAgent: null,
        },
      }
    : null;
}

const projectBody = {
  name: "Tasks API",
  openapiSchemaUrl: "https://api.example.com/openapi.json",
  openapiBaseUrl: "https://api.example.com",
  bearerValidationUrl: "https://api.example.com/me",
  corsOrigins: ["https://app.example.com"],
  allowMutations: false,
  llmProvider: "openai",
  llmModel: "gpt-5.6-luna",
};

describe("cloud API", () => {
  const provision = vi.fn(async () => undefined);
  const restart = vi.fn(async () => undefined);
  const destroy = vi.fn(async (workerEnv: typeof env, ownerId: string, projectId: string) => {
    await workerEnv.DB.prepare("DELETE FROM project WHERE id = ? AND owner_id = ?")
      .bind(projectId, ownerId)
      .run();
  });
  const validate = vi.fn(async () => "a".repeat(64));
  const agent = vi.fn(async (_request: Request, _workerEnv: typeof env, _name: string) =>
    new Response("agent"));
  const validateProvider = vi.fn(async () => undefined);
  const notifyAccessGranted = vi.fn(async () => true);
  const playground = vi.fn(async () => ({
    answer: "Two tasks are still open.",
    pendingTools: [],
    status: "completed",
  }));
  const app = createCloudApp({
    agent,
    destroy,
    getSession: async (workerEnv, request) =>
      await getAgentAccessTokenSession(workerEnv.DB, request.headers.get("authorization"))
        ?? session(request.headers.get("x-test-user")),
    notifyAccessGranted,
    playground,
    provision,
    restart,
    validate,
    validateProvider,
  });
  const testEnv = {
    ...env,
    ACCESS_REQUEST_ORIGINS: "https://lemy.example.com",
    ADMIN_LOGIN: "admin",
    ADMIN_PASSWORD: "test-password",
  };

  beforeEach(async () => {
    provision.mockClear();
    restart.mockClear();
    destroy.mockClear();
    validate.mockReset();
    validate.mockResolvedValue("a".repeat(64));
    validateProvider.mockReset();
    validateProvider.mockResolvedValue(undefined);
    agent.mockClear();
    notifyAccessGranted.mockClear();
    playground.mockClear();
    await env.DB.prepare("DELETE FROM admin_login_attempt").run();
    await env.DB.prepare("DELETE FROM runtime_session_lease").run();
    await env.DB.prepare("DELETE FROM project WHERE owner_id IN ('user-1', 'user-2')").run();
    await env.DB.prepare("DELETE FROM provider_credential WHERE owner_id IN ('user-1', 'user-2')").run();
    const now = Date.now();
    await env.DB.batch(["user-1", "user-2"].map((id) => env.DB.prepare(
      "INSERT OR IGNORE INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
    ).bind(id, id, `${id}@example.com`, now, now)));
    await env.DB.batch(["user-1", "user-2"].map((id) => env.DB.prepare(
      `INSERT INTO access_request (id, email, status, requested_at, updated_at)
        VALUES (?, ?, 'granted', ?, ?)
        ON CONFLICT(email) DO UPDATE SET status = 'granted', updated_at = excluded.updated_at`,
    ).bind(`access-${id}`, `${id}@example.com`, now, now)));
    await Promise.all(["user-1", "user-2"].map((id) =>
      saveValidatedProviderCredential(testEnv, id, "openai", `${id}-openai-key`)));
  });

  afterEach(() => vi.unstubAllGlobals());

  async function createProject(ownerId = "user-1") {
    const context = createExecutionContext();
    const response = await app.fetch(new Request("https://cloud.test/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": ownerId },
      body: JSON.stringify(projectBody),
    }), testEnv, context);
    await waitOnExecutionContext(context);
    expect(response.status).toBe(202);
    return response.json<{ id: string; runtimePath: string; llmApiKey?: unknown }>();
  }

  async function readyProject(ownerId = "user-1") {
    const project = await createProject(ownerId);
    await env.DB.prepare("UPDATE project SET status = 'ready' WHERE id = ?").bind(project.id).run();
    return project;
  }

  async function startRuntime(projectId: string, body: Record<string, unknown> = {}) {
    return app.fetch(new Request(`https://cloud.test/runtime/${projectId}/session`, {
      method: "POST",
      headers: {
        authorization: "Bearer customer-secret",
        "content-type": "application/json",
        origin: "https://app.example.com",
      },
      body: JSON.stringify(body),
    }), testEnv);
  }

  it("requires a signed-in user for the control plane", async () => {
    expect((await app.fetch(new Request("https://cloud.test/api/projects"), testEnv)).status).toBe(401);
  });

  it("caps concurrent runtime sessions per principal", async () => {
    const project = await readyProject();
    const responses = await Promise.all([
      startRuntime(project.id),
      startRuntime(project.id),
      startRuntime(project.id),
      startRuntime(project.id),
    ]);

    expect(responses.map(({ status }) => status).sort()).toEqual([200, 200, 200, 400]);
  });

  it("accepts access requests from the Cloud login page", async () => {
    await env.DB.prepare(
      "DELETE FROM access_request WHERE email = 'cloud-login@example.com'",
    ).run();
    const cloudOrigin = new URL(testEnv.PUBLIC_APP_URL).origin;
    const response = await app.fetch(new Request("https://cloud.test/api/access-requests", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: cloudOrigin,
      },
      body: JSON.stringify({ email: "cloud-login@example.com" }),
    }), testEnv);

    expect(response.status).toBe(201);
    expect(response.headers.get("access-control-allow-origin")).toBe(cloudOrigin);
  });

  it("rejects access requests safely when public origins are not configured", async () => {
    const response = await app.fetch(new Request("https://cloud.test/api/access-requests", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://lemy.example.com",
      },
      body: JSON.stringify({ email: "cloud-login@example.com" }),
    }), {
      ...testEnv,
      ACCESS_REQUEST_ORIGINS: undefined,
      PUBLIC_APP_URL: undefined,
    } as unknown as typeof testEnv);

    expect(response.status).toBe(403);
  });

  it("grants and revokes access by requested email through the admin backoffice", async () => {
    const now = Date.now();
    await env.DB.prepare("DELETE FROM access_request WHERE email = 'pending-user@example.com'").run();
    await env.DB.prepare("DELETE FROM user WHERE id = 'pending-user'").run();

    expect((await app.fetch(new Request("https://cloud.test/api/access-requests", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://attacker.example.com",
      },
      body: JSON.stringify({ email: "pending-user@example.com" }),
    }), testEnv)).status).toBe(403);
    expect((await app.fetch(new Request("https://cloud.test/api/access-requests", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://lemy.example.com",
      },
      body: JSON.stringify({ email: "not-an-email" }),
    }), testEnv)).status).toBe(400);

    const requested = await app.fetch(new Request("https://cloud.test/api/access-requests", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://lemy.example.com",
      },
      body: JSON.stringify({ email: " Pending-User@Example.com " }),
    }), testEnv);
    expect(requested.status).toBe(201);
    expect(requested.headers.get("access-control-allow-origin")).toBe("https://lemy.example.com");
    expect(await requested.json()).toEqual({ requested: true });

    await env.DB.prepare(
      "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)",
    ).bind("pending-user", "Pending user", "pending-user@example.com", now, now).run();

    const pendingSession = await app.fetch(new Request("https://cloud.test/api/session", {
      headers: { "x-test-user": "pending-user" },
    }), testEnv);
    expect(await pendingSession.json()).toMatchObject({
      access: { granted: false },
    });
    expect((await app.fetch(new Request("https://cloud.test/api/providers", {
      headers: { "x-test-user": "pending-user" },
    }), testEnv)).status).toBe(403);

    expect((await app.fetch(new Request(
      "https://cloud.test/api/admin/access-requests",
    ), testEnv)).status).toBe(401);
    const adminAuthorization = `Basic ${btoa("admin:test-password")}`;
    expect((await app.fetch(new Request("https://cloud.test/api/admin/access-requests", {
      headers: { authorization: `Basic ${btoa("admin:wrong")}` },
    }), testEnv)).status).toBe(401);
    const requests = await app.fetch(new Request("https://cloud.test/api/admin/access-requests", {
      headers: { authorization: adminAuthorization },
    }), testEnv);
    expect(requests.headers.get("cache-control")).toBe("no-store");
    const entries = await requests.json<Array<{ id: string; email: string }>>();
    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ email: "pending-user@example.com" }),
    ]));
    const requestId = entries.find(({ email }) => email === "pending-user@example.com")!.id;

    const grant = await app.fetch(new Request(
      `https://cloud.test/api/admin/access-requests/${requestId}/grant`,
      { method: "POST", headers: { authorization: adminAuthorization } },
    ), testEnv);
    expect(grant.status).toBe(200);
    expect(await grant.json()).toEqual({ emailSent: true, granted: true });
    expect(notifyAccessGranted).toHaveBeenCalledWith(
      testEnv,
      "pending-user@example.com",
    );
    expect((await app.fetch(new Request("https://cloud.test/api/providers", {
      headers: { "x-test-user": "pending-user" },
    }), testEnv)).status).toBe(403);
    await env.DB.prepare(
      "UPDATE user SET email_verified = 1 WHERE id = 'pending-user'",
    ).run();
    expect((await app.fetch(new Request("https://cloud.test/api/providers", {
      headers: { "x-test-user": "pending-user" },
    }), testEnv)).status).toBe(200);

    const revoke = await app.fetch(new Request(
      `https://cloud.test/api/admin/access-requests/${requestId}/revoke`,
      { method: "POST", headers: { authorization: adminAuthorization } },
    ), testEnv);
    expect(revoke.status).toBe(200);
    expect((await app.fetch(new Request("https://cloud.test/api/providers", {
      headers: { "x-test-user": "pending-user" },
    }), testEnv)).status).toBe(403);
  });

  it("limits waitlist requests to three per minute per IP", async () => {
    let attempts = 0;
    const allowed = { limit: vi.fn(async () => ({ success: true })) };
    const accessRequestLimiter = {
      limit: vi.fn(async () => ({ success: ++attempts <= 3 })),
    };
    const limitedEnv = {
      ...testEnv,
      RATE_LIMITS_DISABLED: undefined,
      MUTATION_RATE_LIMITER: allowed,
      ACCESS_REQUEST_RATE_LIMITER: accessRequestLimiter,
    };
    const joinWaitlist = () => app.fetch(new Request(
      "https://cloud.test/api/access-requests",
      {
        method: "POST",
        headers: {
          "cf-connecting-ip": "203.0.113.20",
          "content-type": "application/json",
          origin: "https://lemy.example.com",
        },
        body: JSON.stringify({ email: "rate-limited@example.com" }),
      },
    ), limitedEnv);

    expect((await joinWaitlist()).status).toBe(201);
    expect((await joinWaitlist()).status).toBe(201);
    expect((await joinWaitlist()).status).toBe(201);
    const blocked = await joinWaitlist();
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("60");
  });

  it("limits failed admin sign-ins to three attempts per five minutes", async () => {
    const allowed = { limit: vi.fn(async () => ({ success: true })) };
    const limitedEnv = {
      ...testEnv,
      RATE_LIMITS_DISABLED: undefined,
      CONTROL_RATE_LIMITER: allowed,
    };
    const signIn = () => app.fetch(new Request(
      "https://cloud.test/api/admin/access-requests",
      {
        headers: {
          authorization: `Basic ${btoa("admin:wrong")}`,
          "cf-connecting-ip": "203.0.113.10",
        },
      },
    ), limitedEnv);

    expect((await signIn()).status).toBe(401);
    expect((await signIn()).status).toBe(401);
    expect((await signIn()).status).toBe(401);
    const blocked = await signIn();
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("300");
    expect((await app.fetch(new Request(
      "https://cloud.test/api/admin/access-requests",
      {
        headers: {
          authorization: `Basic ${btoa("admin:test-password")}`,
          "cf-connecting-ip": "203.0.113.10",
        },
      },
    ), limitedEnv)).status).toBe(200);
    await env.DB.prepare(
      "UPDATE admin_login_attempt SET window_started_at = ?",
    ).bind(Date.now() - 300_001).run();
    expect((await signIn()).status).toBe(401);
  });

  it("returns safe project configuration with the Think runtime base path", async () => {
    const project = await createProject();

    expect(project).not.toHaveProperty("llmApiKey");
    expect(project.runtimePath).toBe(`/runtime/${project.id}`);
    expect(provision).toHaveBeenCalledWith(testEnv, project.id);
  });

  it("scopes projects to their owner", async () => {
    const project = await createProject();
    const response = await app.fetch(new Request(`https://cloud.test/api/projects/${project.id}`, {
      headers: { "x-test-user": "user-2" },
    }), testEnv);

    expect(response.status).toBe(404);
  });

  it("limits automation tokens to one project and permission", async () => {
    const first = await readyProject();
    const second = await readyProject();
    const readToken = await createAgentAccessToken(
      env.DB,
      "user-1",
      first.id,
      { name: "Read-only", permission: "read" },
    );
    const headers = { authorization: `Bearer ${readToken.token}` };

    const projects = await app.fetch(new Request("https://cloud.test/api/projects", {
      headers,
    }), testEnv);
    expect(await projects.json<Array<{ id: string }>>()).toEqual([
      expect.objectContaining({ id: first.id }),
    ]);
    expect((await app.fetch(new Request(
      `https://cloud.test/api/projects/${second.id}`,
      { headers },
    ), testEnv)).status).toBe(403);
    expect((await app.fetch(new Request(
      `https://cloud.test/api/projects/${first.id}/restart`,
      { method: "POST", headers },
    ), testEnv)).status).toBe(403);

    const writeToken = await createAgentAccessToken(
      env.DB,
      "user-1",
      first.id,
      { name: "Write", permission: "write" },
    );
    expect((await app.fetch(new Request(
      `https://cloud.test/api/projects/${first.id}/playground`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${writeToken.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          bearer: "customer-secret",
          prompt: "Spend some tokens",
        }),
      },
    ), testEnv)).status).toBe(403);
  });

  it("only creates projects with a validated workspace provider", async () => {
    await env.DB.prepare("DELETE FROM provider_credential WHERE owner_id = 'user-1'").run();
    const response = await app.fetch(new Request("https://cloud.test/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": "user-1" },
      body: JSON.stringify(projectBody),
    }), testEnv);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "The selected model is not available in this Lemy instance",
    });
    expect(provision).not.toHaveBeenCalled();
  });

  it("creates an encrypted, short-lived Think session and routes its conversation", async () => {
    const project = await readyProject();
    const threadId = "94e3456c-25d8-4e56-954d-e4a1dc00e6d5";
    const sessionResponse = await startRuntime(project.id, {
      approvedTools: ["api.completeTask"],
      threadId,
      toolApprovalMode: "ask",
    });
    const runtime = await sessionResponse.json<{
      protocol: string;
      runtimePath: string;
      token: string;
    }>();

    expect(sessionResponse.status).toBe(200);
    expect(sessionResponse.headers.get("access-control-allow-origin")).toBe("https://app.example.com");
    expect(runtime).toMatchObject({
      protocol: "cloudflare-think",
      runtimePath: `/runtime/${project.id}/agent/${threadId}`,
    });
    expect(runtime.token).not.toContain("customer-secret");
    expect(validate).toHaveBeenCalledWith("Bearer customer-secret", projectBody.bearerValidationUrl);

    expect((await startRuntime(project.id, { threadId })).status).toBe(200);
    const leaseCount = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM runtime_session_lease WHERE project_id = ?",
    ).bind(project.id).first<{ count: number }>();
    expect(leaseCount?.count).toBe(1);

    const routed = await app.fetch(new Request(
      `https://cloud.test${runtime.runtimePath}/get-messages?token=${encodeURIComponent(runtime.token)}`,
      { headers: { origin: "https://app.example.com" } },
    ), testEnv);

    expect(await routed.text()).toBe("agent");
    expect(routed.headers.get("access-control-allow-origin")).toBe("https://app.example.com");
    const [request, , agentName] = agent.mock.calls[0];
    expect(new URL(request.url).pathname).toBe(`${runtime.runtimePath}/get-messages`);
    expect(new URL(request.url).searchParams.has("token")).toBe(false);
    expect(request.headers.get("x-lemy-runtime-session")).toBe(runtime.token);
    expect(agentName).toMatch(new RegExp(`^${project.id}--[A-Za-z0-9_-]{22}--${threadId}$`));
  });

  it("runs a project playground turn with the same bearer validation", async () => {
    const project = await readyProject();
    const response = await app.fetch(new Request(
      `https://cloud.test/api/projects/${project.id}/playground`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-test-user": "user-1" },
        body: JSON.stringify({
          bearer: "customer-secret",
          prompt: "What tasks are still open?",
          toolApprovalMode: "auto",
        }),
      },
    ), testEnv);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      answer: "Two tasks are still open.",
      status: "completed",
    });
    expect(validate).toHaveBeenCalledWith(
      "Bearer customer-secret",
      projectBody.bearerValidationUrl,
    );
    expect(playground).toHaveBeenCalledWith(
      testEnv,
      expect.stringMatching(new RegExp(`^${project.id}--`)),
      expect.stringMatching(/^v1\./),
      "What tasks are still open?",
    );
  });

  it("rejects missing, invalid, cross-origin, and unavailable-provider runtime sessions", async () => {
    const project = await readyProject();
    const missing = await app.fetch(new Request(`https://cloud.test/runtime/${project.id}/session`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://app.example.com" },
      body: "{}",
    }), testEnv);
    validate.mockRejectedValueOnce(new Error("rejected"));
    const invalid = await startRuntime(project.id);
    const wrongOrigin = await app.fetch(new Request(`https://cloud.test/runtime/${project.id}/session`, {
      method: "POST",
      headers: {
        authorization: "Bearer customer-secret",
        "content-type": "application/json",
        origin: "https://attacker.example.com",
      },
      body: "{}",
    }), testEnv);
    await env.DB.prepare(
      "UPDATE provider_credential SET validation_status = 'invalid' WHERE owner_id = 'user-1' AND provider = 'openai'",
    ).run();
    const unavailable = await app.fetch(new Request(`https://cloud.test/runtime/${project.id}/session`, {
      method: "POST",
      headers: {
        authorization: "Bearer customer-secret",
        "content-type": "application/json",
        origin: "https://app.example.com",
      },
      body: "{}",
    }), testEnv);

    expect(missing.status).toBe(401);
    expect(invalid.status).toBe(401);
    expect(wrongOrigin.status).toBe(403);
    expect(unavailable.status).toBe(409);
    expect(agent).not.toHaveBeenCalled();
  });

  it("stops runtime sessions when workspace access is removed", async () => {
    const project = await readyProject();
    await env.DB.prepare(
      "UPDATE access_request SET status = 'revoked' WHERE email = 'user-1@example.com'",
    ).run();

    const response = await startRuntime(project.id);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Workspace access is not active" });
    expect(validate).not.toHaveBeenCalled();
  });

  it("answers runtime preflight only for configured origins", async () => {
    const project = await readyProject();
    const request = (origin: string) => app.fetch(new Request(
      `https://cloud.test/runtime/${project.id}/session`,
      { method: "OPTIONS", headers: { origin } },
    ), testEnv);

    const allowed = await request("https://app.example.com");
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://app.example.com");
    expect((await request("https://attacker.example.com")).status).toBe(403);
  });

  it("enforces project and principal runtime rate limits", async () => {
    const project = await readyProject();
    const denied = { limit: vi.fn(async () => ({ success: false })) };
    const allowed = { limit: vi.fn(async () => ({ success: true })) };

    const response = await app.fetch(new Request(`https://cloud.test/runtime/${project.id}/session`, {
      method: "POST",
      headers: {
        authorization: "Bearer customer-secret",
        "content-type": "application/json",
        origin: "https://app.example.com",
      },
      body: "{}",
    }), {
      ...testEnv,
      RATE_LIMITS_DISABLED: undefined,
      AUTH_RATE_LIMITER: allowed,
      RUNTIME_PROJECT_RATE_LIMITER: denied,
    });

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(agent).not.toHaveBeenCalled();
  });

  it("lets a Think session reach a connected external MCP without exposing its credential", async () => {
    const project = await readyProject();
    const mcp = await createExternalMcp(testEnv, "user-1", project.id, {
      name: "Linear",
      url: "https://mcp.example.com/mcp",
      authType: "bearer",
    });
    await connectExternalMcpWithBearer(testEnv, "user-1", project.id, mcp.id, "mcp-secret");
    const runtimeResponse = await startRuntime(project.id, {
      threadId: "fc5e87d7-33e3-42e5-878f-beb08c074c11",
    });
    const runtime = await runtimeResponse.json<{ threadId: string; token: string }>();
    const remoteFetch = vi.fn(async (request: Request) => {
      expect(request.headers.get("authorization")).toBe("Bearer mcp-secret");
      expect(request.headers.has("x-lemy-runtime-session")).toBe(false);
      return new Response("proxied", { headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", remoteFetch);

    const response = await app.fetch(new Request(
      `https://cloud.test/external-mcp/${project.id}/${mcp.id}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-lemy-runtime-session": runtime.token,
          "x-lemy-runtime-thread": runtime.threadId,
        },
        body: "{}",
      },
    ), testEnv);

    expect(await response.text()).toBe("proxied");
    expect(remoteFetch).toHaveBeenCalledOnce();
  });

  it("deletes project metadata asynchronously", async () => {
    const project = await createProject();
    const context = createExecutionContext();
    const response = await app.fetch(new Request(`https://cloud.test/api/projects/${project.id}`, {
      method: "DELETE",
      headers: { "x-test-user": "user-1" },
    }), testEnv, context);
    await waitOnExecutionContext(context);

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ id: project.id, status: "deleting" });
    expect(destroy).toHaveBeenCalledWith(testEnv, "user-1", project.id);
  });

  it("validates, stores, refreshes, and scopes provider keys", async () => {
    await env.DB.prepare("DELETE FROM provider_credential WHERE owner_id IN ('user-1', 'user-2')").run();
    const configure = await app.fetch(new Request("https://cloud.test/api/providers/openai", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-test-user": "user-1" },
      body: JSON.stringify({ apiKey: "new-openai-key" }),
    }), testEnv);

    expect(configure.status).toBe(200);
    expect(validateProvider).toHaveBeenCalledWith("openai", "new-openai-key");
    expect(await configure.json()).toMatchObject({
      configured: true,
      provider: "openai",
      status: "validated",
    });
    expect(await getProviderApiKey(testEnv, "user-1", "openai")).toBe("new-openai-key");

    validateProvider.mockRejectedValueOnce(new ProviderValidationError("rejected", "openai"));
    const rejectedReplacement = await app.fetch(new Request(
      "https://cloud.test/api/providers/openai",
      {
        method: "PUT",
        headers: { "content-type": "application/json", "x-test-user": "user-1" },
        body: JSON.stringify({ apiKey: "bad-replacement" }),
      },
    ), testEnv);
    expect(rejectedReplacement.status).toBe(400);
    expect(await getProviderApiKey(testEnv, "user-1", "openai")).toBe("new-openai-key");

    const otherOwner = await app.fetch(new Request("https://cloud.test/api/providers", {
      headers: { "x-test-user": "user-2" },
    }), testEnv);
    expect(await otherOwner.json()).toMatchObject({
      providers: expect.arrayContaining([
        expect.objectContaining({ provider: "openai", configured: false }),
      ]),
      models: [],
    });

    validateProvider.mockRejectedValueOnce(new ProviderValidationError("rejected", "openai"));
    const refresh = await app.fetch(new Request(
      "https://cloud.test/api/providers/openai/validate",
      { method: "POST", headers: { "x-test-user": "user-1" } },
    ), testEnv);
    expect(refresh.status).toBe(400);

    const providers = await app.fetch(new Request("https://cloud.test/api/providers", {
      headers: { "x-test-user": "user-1" },
    }), testEnv);
    expect(await providers.json()).toMatchObject({
      providers: expect.arrayContaining([
        expect.objectContaining({ provider: "openai", status: "invalid" }),
      ]),
      models: [],
    });

    const removed = await app.fetch(new Request(
      "https://cloud.test/api/providers/openai",
      { method: "DELETE", headers: { "x-test-user": "user-1" } },
    ), testEnv);
    expect(removed.status).toBe(204);
    expect(await getProviderApiKey(testEnv, "user-1", "openai")).toBeNull();
  });

  it("does not expose unexpected provider errors", async () => {
    validateProvider.mockRejectedValueOnce(new Error("internal upstream detail"));

    const response = await app.fetch(new Request("https://cloud.test/api/providers/openai", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-test-user": "user-1" },
      body: JSON.stringify({ apiKey: "new-openai-key" }),
    }), testEnv);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Provider configuration failed" });
  });
});
