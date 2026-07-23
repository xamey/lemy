import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  beginExternalMcpOAuth,
  finishExternalMcpOAuth,
  proxyExternalMcpRequest,
} from "../src/worker/external-mcp-auth";
import {
  connectExternalMcpWithBearer,
  createExternalMcp,
  decryptExternalMcpCredential,
  getExternalMcp,
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

describe("external MCP authentication", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM project WHERE owner_id = 'oauth-user'").run();
    const now = Date.now();
    await env.DB.prepare(
      "INSERT OR IGNORE INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
    ).bind("oauth-user", "OAuth User", "oauth-user@example.com", now, now).run();
  });

  it("runs MCP OAuth discovery, PKCE, registration, and callback exchange", async () => {
    const project = await createProject(env, "oauth-user", projectInput);
    const mcp = await createExternalMcp(env, "oauth-user", project.id, {
      name: "OAuth MCP",
      url: "https://mcp.example.com/mcp",
      authType: "oauth",
    });
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      if (url === "https://mcp.example.com/mcp" && method === "POST") {
        const headers = new Headers(input instanceof Request ? input.headers : init?.headers);
        if (headers.get("authorization") === "Bearer refreshed-access-token") {
          return new Response("proxied");
        }
        return new Response(null, {
          status: 401,
          headers: {
            "WWW-Authenticate":
              'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource"',
          },
        });
      }
      if (url === "https://mcp.example.com/.well-known/oauth-protected-resource") {
        return Response.json({
          resource: "https://mcp.example.com/mcp",
          authorization_servers: ["https://auth.example.com"],
          scopes_supported: ["mcp:tools"],
        });
      }
      if (url === "https://auth.example.com/.well-known/oauth-authorization-server") {
        return Response.json({
          issuer: "https://auth.example.com",
          authorization_endpoint: "https://auth.example.com/authorize",
          token_endpoint: "https://auth.example.com/token",
          registration_endpoint: "https://auth.example.com/register",
          response_types_supported: ["code"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["none"],
        });
      }
      if (url === "https://auth.example.com/register" && method === "POST") {
        const metadata = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json({ ...metadata, client_id: "lemy-client" });
      }
      if (url === "https://auth.example.com/token" && method === "POST") {
        const body = new URLSearchParams(String(init?.body));
        if (body.get("grant_type") === "refresh_token") {
          expect(body.get("refresh_token")).toBe("oauth-refresh-token");
          return Response.json({
            access_token: "refreshed-access-token",
            refresh_token: "oauth-refresh-token",
            token_type: "Bearer",
          });
        }
        expect(body.get("code")).toBe("authorization-code");
        expect(body.get("code_verifier")).toBeTruthy();
        expect(body.get("resource")).toBe("https://mcp.example.com/mcp");
        return Response.json({
          access_token: "oauth-access-token",
          refresh_token: "oauth-refresh-token",
          token_type: "Bearer",
          expires_in: 3600,
        });
      }
      return new Response("unexpected", { status: 404 });
    });

    const authorizationUrl = await beginExternalMcpOAuth(
      env,
      "oauth-user",
      project.id,
      mcp.id,
      fetchFn as typeof fetch,
    );
    const redirect = new URL(authorizationUrl);
    const state = redirect.searchParams.get("state")!;
    expect(redirect.origin + redirect.pathname).toBe("https://auth.example.com/authorize");
    expect(redirect.searchParams.get("code_challenge_method")).toBe("S256");
    expect(redirect.searchParams.get("resource")).toBe("https://mcp.example.com/mcp");

    const connected = await finishExternalMcpOAuth(
      env,
      "oauth-user",
      "authorization-code",
      state,
      fetchFn as typeof fetch,
    );
    const stored = await getExternalMcp(env.DB, "oauth-user", project.id, mcp.id);
    const credential = await decryptExternalMcpCredential(env, stored!);

    expect(connected.connected).toBe(true);
    expect(credential).toMatchObject({
      type: "oauth",
      tokens: {
        access_token: "oauth-access-token",
        refresh_token: "oauth-refresh-token",
      },
    });
    expect(JSON.stringify(credential)).not.toContain(state);
    expect(JSON.stringify(credential)).not.toContain("code_verifier");

    const response = await proxyExternalMcpRequest(
      env,
      stored!,
      new Request("https://cloud.test/external-mcp/project/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      fetchFn as typeof fetch,
    );
    const refreshed = await decryptExternalMcpCredential(
      env,
      (await getExternalMcp(env.DB, "oauth-user", project.id, mcp.id))!,
    );
    expect(await response.text()).toBe("proxied");
    expect(refreshed).toMatchObject({
      tokens: { access_token: "refreshed-access-token" },
    });
  });

  it("replaces the user bearer with the external MCP bearer", async () => {
    const project = await createProject(env, "oauth-user", projectInput);
    const created = await createExternalMcp(env, "oauth-user", project.id, {
      name: "Bearer MCP",
      url: "https://mcp.example.com/mcp",
      authType: "bearer",
    });
    await connectExternalMcpWithBearer(
      env,
      "oauth-user",
      project.id,
      created.id,
      "external-secret",
    );
    const mcp = await getExternalMcp(env.DB, "oauth-user", project.id, created.id);
    const fetchFn = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const forwarded = request instanceof Request ? request : new Request(request);
      expect(forwarded.headers.get("authorization")).toBe("Bearer external-secret");
      expect(forwarded.headers.has("x-lemy-internal-token")).toBe(false);
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return Response.json({ jsonrpc: "2.0", id: 1, result: { tools: [] } });
    });

    const response = await proxyExternalMcpRequest(
      env,
      mcp!,
      new Request("https://cloud.test/external-mcp/project/mcp", {
        method: "POST",
        headers: {
          authorization: "Bearer user-token",
          "content-type": "application/json",
          "x-lemy-internal-token": "internal-assertion",
        },
        body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
      }),
      fetchFn as typeof fetch,
    );

    expect(response.status).toBe(200);
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("does not follow OAuth redirects to private infrastructure", async () => {
    const project = await createProject(env, "oauth-user", projectInput);
    const mcp = await createExternalMcp(env, "oauth-user", project.id, {
      name: "Redirecting MCP",
      url: "https://mcp.example.com/mcp",
      authType: "oauth",
    });
    const fetchFn = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: "http://169.254.169.254/metadata" },
    }));

    await expect(beginExternalMcpOAuth(
      env,
      "oauth-user",
      project.id,
      mcp.id,
      fetchFn as typeof fetch,
    )).rejects.toThrow("OAuth connection failed");
    expect(fetchFn).toHaveBeenCalledOnce();
  });
});
