import { Hono } from "hono";
import { createMcpHandler } from "agents/mcp";
import { getAgentByName } from "agents";

import { isBearerAuthorization, validateBearer } from "./bearer-validation";
import { createAuth, getAuthSession, type AuthSession } from "./auth";
import {
  hasCloudAccess,
  listAccessRequests,
  requestCloudAccess,
  setAccessRequestStatus,
} from "./access";
import {
  agentAccess,
  createAgentAccessToken,
  getAgentAccessTokenSession,
  listAgentAccessTokens,
  revokeAgentAccessToken,
} from "./agent-access-tokens";
import { sendAccessApprovalEmail } from "./access-email";
import { createControlMcpServer } from "./control-mcp";
import { getCloudBudgetUsage } from "./cloud-budget";
import {
  deleteProviderCredential,
  getConfiguredProviderCredential,
  hasValidatedProvider,
  listProviderConfigurations,
  ProviderValidationError,
  saveValidatedProviderCredential,
  setProviderValidationStatus,
  validateProviderApiKey,
} from "./provider-credentials";
import type { Env } from "./env";
import {
  beginExternalMcpOAuth,
  externalMcpOAuthClientMetadata,
  finishExternalMcpOAuth,
  proxyExternalMcpRequest,
} from "./external-mcp-auth";
import {
  connectExternalMcpWithBearer,
  createExternalMcp,
  deleteExternalMcp,
  disconnectExternalMcp,
  getExternalMcp,
  getExternalMcpForProxy,
  listExternalMcps,
} from "./external-mcps";
import { modelCatalog, type LlmProvider } from "./model-catalog";
import { parseProjectInput } from "./project-input";
import {
  checkRateLimit,
  recordFailedAdminLogin,
  type RateLimitResult,
} from "./rate-limit";
import {
  parseLimitedJson,
  RequestTooLargeError,
} from "./request-body";
import {
  createProject,
  getProject,
  getProjectById,
  listProjects,
  setProjectStatus,
  toPublicProject,
  updateProject,
} from "./projects";
import { registerProjectThread } from "./project-threads";
import { listProjectRuns } from "./project-runs";
import {
  destroyProject,
  provisionProject,
  restartProject,
} from "./project-lifecycle";
import {
  createRuntimeSession,
  openRuntimeSession,
  runtimeAgentName,
} from "./runtime-session";
import { reserveRuntimeSession } from "./runtime-limits";

interface Variables {
  session: AuthSession;
}

interface Services {
  getSession(env: Env, request: Request): Promise<AuthSession>;
  provision(env: Env, projectId: string): Promise<void>;
  restart(env: Env, projectId: string): Promise<void>;
  destroy(env: Env, ownerId: string, projectId: string): Promise<void>;
  agent(request: Request, env: Env, agentName: string): Promise<Response>;
  validate(authorization: string, validationUrl: string): Promise<string>;
  validateProvider(provider: LlmProvider, apiKey: string): Promise<void>;
  notifyAccessGranted(env: Env, email: string): Promise<boolean>;
  playground(
    env: Env,
    agentName: string,
    runtimeToken: string,
    prompt: string,
  ): Promise<{ answer: string; pendingTools: string[]; status: string }>;
}

const defaultServices: Services = {
  getSession: getAuthSession,
  provision: provisionProject,
  restart: restartProject,
  destroy: destroyProject,
  agent: async (request, env, agentName) => {
    if (!env.LEMY_AGENT) return new Response("Think runtime unavailable", { status: 503 });
    return (await getAgentByName(env.LEMY_AGENT, agentName)).fetch(request);
  },
  validate: validateBearer,
  validateProvider: validateProviderApiKey,
  notifyAccessGranted: sendAccessApprovalEmail,
  playground: async (env, agentName, runtimeToken, prompt) => {
    if (!env.LEMY_AGENT) throw new Error("Think runtime unavailable");
    return (await getAgentByName(env.LEMY_AGENT, agentName))
      .playground(runtimeToken, prompt);
  },
};

const JSON_BODY_LIMIT = 256_000;
const RUNTIME_SESSION_BODY_LIMIT = 8_192;

function userId(session: AuthSession): string | null {
  return session?.user.id ?? null;
}

async function offeredModels(env: Env, ownerId: string) {
  const configurations = await listProviderConfigurations(env.DB, ownerId);
  const available = new Set(configurations
    .filter(({ status }) => status === "validated")
    .map(({ provider }) => provider));
  return modelCatalog(env.LEMY_MODEL_CATALOG_JSON)
    .filter(({ provider }) => available.has(provider));
}

function clientIdentity(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? "unknown";
}

function rateLimitFailure(
  result: RateLimitResult,
  retryAfterSeconds = 60,
): Response | null {
  if (result === "allowed") return null;
  return Response.json(
    { error: result === "limited" ? "Rate limit exceeded" : "Rate limiting unavailable" },
    {
      status: result === "limited" ? 429 : 503,
      headers: result === "limited"
        ? { "Retry-After": String(retryAfterSeconds) }
        : undefined,
    },
  );
}

async function body(request: Request): Promise<unknown> {
  return parseLimitedJson(request, JSON_BODY_LIMIT);
}

async function lifecycleFailure(
  env: Env,
  ownerId: string,
  request: Request,
): Promise<Response | null> {
  let failure = rateLimitFailure(await checkRateLimit(
    env,
    env.LIFECYCLE_RATE_LIMITER,
    `lifecycle:${ownerId}`,
  ));
  if (!failure) {
    failure = rateLimitFailure(await checkRateLimit(
      env,
      env.LIFECYCLE_RATE_LIMITER,
      `lifecycle-ip:${clientIdentity(request)}`,
    ));
  }
  return failure;
}

function providerName(value: string): LlmProvider | null {
  return value === "openai" || value === "anthropic" ? value : null;
}

function providerApiKey(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("API key is required");
  }
  const key = (value as { apiKey?: unknown }).apiKey;
  if (typeof key !== "string" || !key.trim() || key.length > 512) {
    throw new Error("API key must contain 1 to 512 characters");
  }
  return key.trim();
}

function playgroundInput(value: unknown) {
  const candidate = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const bearer = typeof candidate.bearer === "string" ? candidate.bearer.trim() : "";
  const prompt = typeof candidate.prompt === "string" ? candidate.prompt.trim() : "";
  const toolApprovalMode = candidate.toolApprovalMode ?? "ask";
  if (!bearer || bearer.length > 8_192) throw new Error("Bearer token is required");
  if (!prompt || prompt.length > 4_000) {
    throw new Error("Prompt must contain 1 to 4000 characters");
  }
  if (toolApprovalMode !== "auto" && toolApprovalMode !== "ask") {
    throw new Error("Tool approval mode must be auto or ask");
  }
  return {
    authorization: /^Bearer\s+/i.test(bearer) ? bearer : `Bearer ${bearer}`,
    prompt,
    toolApprovalMode: toolApprovalMode as "auto" | "ask",
  };
}

function runtimeCorsOrigin(project: { corsOrigins: string[] }, request: Request): string | null {
  const origin = request.headers.get("origin");
  return origin && project.corsOrigins.includes(origin) ? origin : null;
}

function withRuntimeCors(response: Response, origin: string | null): Response {
  if (!origin) return response;
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Vary", "Origin");
  return new Response(response.body, { status: response.status, headers });
}

function accessRequestOrigin(env: Env, request: Request): string | null {
  const origin = request.headers.get("origin");
  return origin && [env.PUBLIC_APP_URL ?? "", ...(env.ACCESS_REQUEST_ORIGINS ?? "").split(",")]
    .some((candidate) => candidate.trim().replace(/\/$/, "") === origin)
    ? origin
    : null;
}

function withAccessRequestCors(response: Response, origin: string): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Vary", "Origin");
  return new Response(response.body, { status: response.status, headers });
}

async function sameSecret(left: string, right: string): Promise<boolean> {
  const digest = async (value: string) =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  const [leftDigest, rightDigest] = await Promise.all([digest(left), digest(right)]);
  let difference = 0;
  for (let index = 0; index < leftDigest.length; index += 1) {
    difference |= leftDigest[index] ^ rightDigest[index];
  }
  return difference === 0;
}

async function hasAdminAuthorization(env: Env, authorization?: string): Promise<boolean> {
  if (!env.ADMIN_LOGIN || !env.ADMIN_PASSWORD) return false;
  if (!authorization?.startsWith("Basic ")) return false;
  try {
    const value = atob(authorization.slice(6));
    const separator = value.indexOf(":");
    if (separator < 0) return false;
    const [loginMatches, passwordMatches] = await Promise.all([
      sameSecret(value.slice(0, separator), env.ADMIN_LOGIN),
      sameSecret(value.slice(separator + 1), env.ADMIN_PASSWORD),
    ]);
    return loginMatches && passwordMatches;
  } catch {
    return false;
  }
}

export function createCloudApp(overrides: Partial<Services> = {}) {
  const services = { ...defaultServices, ...overrides };
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();

  app.get("/api/health", (c) => c.json({ status: "ok" }));
  app.use("/api/auth/*", async (c, next) => {
    const failure = rateLimitFailure(await checkRateLimit(
      c.env,
      c.env.AUTH_RATE_LIMITER,
      `auth:${clientIdentity(c.req.raw)}`,
    ));
    return failure ?? next();
  });
  app.on(["GET", "POST"], "/api/auth/*", (c) => createAuth(c.env).handler(c.req.raw));

  app.use("/api/*", async (c, next) => {
    if (
      c.req.path.startsWith("/api/auth/")
      || c.req.path.startsWith("/api/internal/")
      || c.req.path.startsWith("/api/admin/")
      || c.req.path === "/api/access-requests"
    ) {
      return next();
    }
    if (/^Bearer\s+lemy_agent_/i.test(c.req.header("authorization") ?? "")) {
      const failure = rateLimitFailure(await checkRateLimit(
        c.env,
        c.env.CONTROL_RATE_LIMITER,
        `agent-auth:${clientIdentity(c.req.raw)}`,
      ));
      if (failure) return failure;
    }
    c.set("session", await services.getSession(c.env, c.req.raw));
    return next();
  });

  app.use("/api/*", async (c, next) => {
    if (
      c.req.path.startsWith("/api/auth/")
      || c.req.path.startsWith("/api/internal/")
      || c.req.path === "/api/health"
    ) return next();
    const ownerId = userId(c.get("session"));
    const mutation = !["GET", "HEAD", "OPTIONS"].includes(c.req.method);
    let failure = rateLimitFailure(await checkRateLimit(
      c.env,
      mutation ? c.env.MUTATION_RATE_LIMITER : c.env.CONTROL_RATE_LIMITER,
      `${mutation ? "mutation" : "control"}:${ownerId ?? clientIdentity(c.req.raw)}`,
    ));
    if (mutation && !failure) {
      failure = rateLimitFailure(await checkRateLimit(
        c.env,
        c.env.MUTATION_RATE_LIMITER,
        `mutation-ip:${clientIdentity(c.req.raw)}`,
      ));
    }
    return failure ?? next();
  });

  app.get("/api/session", async (c) => {
    const session = c.get("session");
    const ownerId = userId(session);
    if (!session || !ownerId) return c.json(null);
    return c.json({
      ...session,
      access: {
        granted: await hasCloudAccess(c.env.DB, ownerId),
      },
    });
  });

  app.options("/api/access-requests", (c) => {
    const origin = accessRequestOrigin(c.env, c.req.raw);
    if (!origin) return c.body(null, 403);
    return withAccessRequestCors(new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Headers": "content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Max-Age": "600",
      },
    }), origin);
  });

  app.post("/api/access-requests", async (c) => {
    const origin = accessRequestOrigin(c.env, c.req.raw);
    if (!origin) return c.json({ error: "Origin not allowed" }, 403);
    const limited = rateLimitFailure(await checkRateLimit(
      c.env,
      c.env.ACCESS_REQUEST_RATE_LIMITER,
      `access-request:${clientIdentity(c.req.raw)}`,
    ));
    if (limited) return withAccessRequestCors(limited, origin);
    try {
      const value = await body(c.req.raw) as { email?: unknown };
      await requestCloudAccess(c.env.DB, value.email);
      return withAccessRequestCors(c.json({ requested: true }, 201), origin);
    } catch (error) {
      return withAccessRequestCors(c.json({
        error: error instanceof Error ? error.message : "Access request is invalid",
      }, error instanceof RequestTooLargeError ? 413 : 400), origin);
    }
  });

  app.use("/api/*", async (c, next) => {
    if (
      c.req.path.startsWith("/api/auth/")
      || c.req.path.startsWith("/api/internal/")
      || c.req.path.startsWith("/api/admin/")
      || c.req.path === "/api/health"
      || c.req.path === "/api/access-requests"
      || c.req.path === "/api/session"
    ) return next();
    const session = c.get("session");
    const ownerId = userId(session);
    if (!session || !ownerId) return c.json({ error: "Authentication required" }, 401);
    if (!await hasCloudAccess(c.env.DB, ownerId)) {
      return c.json({ error: "Lemy Cloud access is awaiting approval" }, 403);
    }
    return next();
  });

  app.use("/api/*", async (c, next) => {
    const access = agentAccess(c.get("session"));
    if (!access) return next();
    if (c.req.path === "/api/projects" && c.req.method === "GET") return next();
    const projectPath = `/api/projects/${access.projectId}`;
    if (c.req.path !== projectPath && !c.req.path.startsWith(`${projectPath}/`)) {
      return c.json({ error: "Agent token is scoped to another project" }, 403);
    }
    if (c.req.path === `${projectPath}/playground`) {
      return c.json({ error: "Agent tokens cannot run playground requests" }, 403);
    }
    if (
      access.permission === "read"
      && !["GET", "HEAD", "OPTIONS"].includes(c.req.method)
    ) return c.json({ error: "Agent token is read-only" }, 403);
    return next();
  });

  app.use("/api/admin/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    if (await hasAdminAuthorization(c.env, c.req.header("authorization"))) {
      return next();
    }
    const failure = rateLimitFailure(await recordFailedAdminLogin(
      c.env,
      clientIdentity(c.req.raw),
    ), 300);
    return failure ?? c.json(
      { error: "Administrator authentication required" },
      401,
      { "WWW-Authenticate": 'Basic realm="Lemy admin"' },
    );
  });
  app.get("/api/admin/access-requests", async (c) =>
    c.json(await listAccessRequests(c.env.DB)));
  app.post("/api/admin/access-requests/:id/grant", async (c) => {
    const request = await setAccessRequestStatus(c.env.DB, c.req.param("id"), "granted");
    if (!request) return c.json({ error: "Access request not found" }, 404);
    return c.json({
      emailSent: await services.notifyAccessGranted(c.env, request.email),
      granted: true,
    });
  });
  app.post("/api/admin/access-requests/:id/revoke", async (c) => {
    const request = await setAccessRequestStatus(c.env.DB, c.req.param("id"), "revoked");
    return request
      ? c.json({ revoked: true })
      : c.json({ error: "Access request not found" }, 404);
  });

  app.use("/api/providers", async (c, next) => {
    if (!userId(c.get("session"))) return c.json({ error: "Authentication required" }, 401);
    return next();
  });
  app.use("/api/providers/*", async (c, next) => {
    if (!userId(c.get("session"))) return c.json({ error: "Authentication required" }, 401);
    return next();
  });
  app.get("/api/providers", async (c) => {
    const ownerId = userId(c.get("session"))!;
    return c.json({
      providers: await listProviderConfigurations(c.env.DB, ownerId),
      models: await offeredModels(c.env, ownerId),
    });
  });
  app.get("/api/usage", async (c) =>
    c.json(await getCloudBudgetUsage(c.env, userId(c.get("session"))!)));
  app.put("/api/providers/:provider", async (c) => {
    const provider = providerName(c.req.param("provider"));
    if (!provider) return c.json({ error: "Provider not found" }, 404);
    let apiKey: string;
    try {
      apiKey = providerApiKey(await body(c.req.raw));
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : "API key is invalid" },
        error instanceof RequestTooLargeError ? 413 : 400,
      );
    }
    try {
      await services.validateProvider(provider, apiKey);
      await saveValidatedProviderCredential(
        c.env,
        userId(c.get("session"))!,
        provider,
        apiKey,
      );
      const configurations = await listProviderConfigurations(
        c.env.DB,
        userId(c.get("session"))!,
      );
      return c.json(configurations.find((item) => item.provider === provider)!);
    } catch (error) {
      if (!(error instanceof ProviderValidationError)) {
        return c.json({ error: "Provider configuration failed" }, 500);
      }
      return c.json({
        error: error.message,
      }, error.kind === "unavailable" ? 502 : 400);
    }
  });
  app.delete("/api/providers/:provider", async (c) => {
    const provider = providerName(c.req.param("provider"));
    if (!provider) return c.json({ error: "Provider not found" }, 404);
    await deleteProviderCredential(c.env.DB, userId(c.get("session"))!, provider);
    return c.body(null, 204);
  });
  app.post("/api/providers/:provider/validate", async (c) => {
    const provider = providerName(c.req.param("provider"));
    if (!provider) return c.json({ error: "Provider not found" }, 404);
    const ownerId = userId(c.get("session"))!;
    const credential = await getConfiguredProviderCredential(c.env, ownerId, provider);
    if (!credential) return c.json({ error: "Provider is not configured" }, 404);
    try {
      await services.validateProvider(provider, credential.apiKey);
      if (!await setProviderValidationStatus(
        c.env.DB,
        ownerId,
        provider,
        "validated",
        credential.version,
      )) return c.json({ error: "Provider changed; retry validation" }, 409);
    } catch (error) {
      if (error instanceof ProviderValidationError && error.kind === "rejected") {
        if (!await setProviderValidationStatus(
          c.env.DB,
          ownerId,
          provider,
          "invalid",
          credential.version,
        )) return c.json({ error: "Provider changed; retry validation" }, 409);
      }
      const status = error instanceof ProviderValidationError && error.kind === "rejected"
        ? 400
        : 502;
      return c.json({
        error: error instanceof ProviderValidationError
          ? error.message
          : "Provider validation failed",
      }, status);
    }
    const configurations = await listProviderConfigurations(c.env.DB, ownerId);
    return c.json(configurations.find((item) => item.provider === provider)!);
  });

  app.get("/api/external-mcp/oauth/client-metadata", (c) =>
    c.json(externalMcpOAuthClientMetadata(c.env)),
  );

  app.get("/api/external-mcp/oauth/callback", async (c) => {
    const ownerId = userId(c.get("session"));
    const state = c.req.query("state") ?? "";
    const code = c.req.query("code") ?? "";
    const destination = new URL("/", c.env.PUBLIC_APP_URL);
    if (!ownerId || !state || !code || c.req.query("error")) {
      destination.searchParams.set("mcp", "error");
      return c.redirect(destination.toString());
    }
    try {
      if (await lifecycleFailure(c.env, ownerId, c.req.raw)) {
        throw new Error("Project lifecycle unavailable");
      }
      const mcp = await finishExternalMcpOAuth(c.env, ownerId, code, state);
      await setProjectStatus(c.env.DB, mcp.projectId, "provisioning");
      c.executionCtx.waitUntil(services.restart(c.env, mcp.projectId));
      destination.searchParams.set("mcp", "connected");
    } catch {
      destination.searchParams.set("mcp", "error");
    }
    return c.redirect(destination.toString());
  });

  app.use("/api/projects/*", async (c, next) => {
    if (!userId(c.get("session"))) return c.json({ error: "Authentication required" }, 401);
    return next();
  });
  app.use("/api/projects", async (c, next) => {
    if (!userId(c.get("session"))) return c.json({ error: "Authentication required" }, 401);
    return next();
  });

  app.get("/api/projects", async (c) => {
    const ownerId = userId(c.get("session"))!;
    const access = agentAccess(c.get("session"));
    if (!access) return c.json(await listProjects(c.env.DB, ownerId));
    const project = await getProject(c.env.DB, ownerId, access.projectId);
    return c.json(project ? [toPublicProject(project)] : []);
  });

  app.get("/api/projects/:projectId/agent-tokens", async (c) => {
    if (agentAccess(c.get("session"))) {
      return c.json({ error: "Use the dashboard session to manage agent tokens" }, 403);
    }
    const ownerId = userId(c.get("session"))!;
    const projectId = c.req.param("projectId");
    if (!await getProject(c.env.DB, ownerId, projectId)) {
      return c.json({ error: "Project not found" }, 404);
    }
    return c.json(await listAgentAccessTokens(c.env.DB, ownerId, projectId));
  });
  app.post("/api/projects/:projectId/agent-tokens", async (c) => {
    if (agentAccess(c.get("session"))) {
      return c.json({ error: "Use the dashboard session to manage agent tokens" }, 403);
    }
    try {
      return c.json(await createAgentAccessToken(
        c.env.DB,
        userId(c.get("session"))!,
        c.req.param("projectId"),
        await body(c.req.raw),
      ), 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid token";
      return c.json({ error: message }, message === "Project not found" ? 404 : 400);
    }
  });
  app.delete("/api/projects/:projectId/agent-tokens/:id", async (c) => {
    if (agentAccess(c.get("session"))) {
      return c.json({ error: "Use the dashboard session to manage agent tokens" }, 403);
    }
    return await revokeAgentAccessToken(
      c.env.DB,
      userId(c.get("session"))!,
      c.req.param("projectId"),
      c.req.param("id"),
    )
      ? c.body(null, 204)
      : c.json({ error: "Agent token not found" }, 404);
  });

  app.post("/api/projects", async (c) => {
    try {
      const ownerId = userId(c.get("session"))!;
      const blocked = await lifecycleFailure(c.env, ownerId, c.req.raw);
      if (blocked) return blocked;
      const input = parseProjectInput(
        await body(c.req.raw),
        await offeredModels(c.env, ownerId),
        c.env.LOCAL_DEV_MODE === "true",
      );
      const project = await createProject(
        c.env,
        ownerId,
        input,
      );
      c.executionCtx.waitUntil(services.provision(c.env, project.id));
      return c.json(project, 202);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid project";
      return c.json({ error: message }, message.startsWith("Project limit reached") ? 409 : 400);
    }
  });

  app.get("/api/projects/:id", async (c) => {
    const project = await getProject(c.env.DB, userId(c.get("session"))!, c.req.param("id"));
    return project ? c.json(toPublicProject(project)) : c.json({ error: "Project not found" }, 404);
  });

  app.get("/api/projects/:projectId/runs", async (c) => {
    const ownerId = userId(c.get("session"))!;
    const projectId = c.req.param("projectId");
    if (!await getProject(c.env.DB, ownerId, projectId)) {
      return c.json({ error: "Project not found" }, 404);
    }
    return c.json(await listProjectRuns(c.env.DB, ownerId, projectId));
  });

  app.post("/api/projects/:projectId/playground", async (c) => {
    const ownerId = userId(c.get("session"))!;
    const project = await getProject(c.env.DB, ownerId, c.req.param("projectId"));
    if (!project) return c.json({ error: "Project not found" }, 404);
    if (project.status !== "ready") return c.json({ error: "Project is not ready" }, 409);
    let input: ReturnType<typeof playgroundInput>;
    try {
      input = playgroundInput(await parseLimitedJson(c.req.raw, RUNTIME_SESSION_BODY_LIMIT));
    } catch (error) {
      return c.json({
        error: error instanceof Error ? error.message : "Playground input is invalid",
      }, error instanceof RequestTooLargeError ? 413 : 400);
    }
    if (!isBearerAuthorization(input.authorization)) {
      return c.json({ error: "Bearer token is invalid" }, 400);
    }
    let principal: string;
    try {
      principal = await services.validate(input.authorization, project.bearerValidationUrl);
    } catch {
      return c.json({ error: "Bearer token rejected" }, 401);
    }
    let failure = rateLimitFailure(await checkRateLimit(
      c.env,
      c.env.RUNTIME_PROJECT_RATE_LIMITER,
      `playground-project:${project.id}`,
    ));
    if (!failure) {
      failure = rateLimitFailure(await checkRateLimit(
        c.env,
        c.env.RUNTIME_PRINCIPAL_RATE_LIMITER,
        `playground-principal:${project.id}:${principal}`,
      ));
    }
    if (failure) return failure;
    if (!await hasValidatedProvider(c.env.DB, ownerId, project.llmProvider)) {
      return c.json({ error: "The project's model provider is not available" }, 409);
    }
    const threadId = crypto.randomUUID();
    const runtime = await createRuntimeSession({
      approvedTools: [],
      authorization: input.authorization,
      expiresAt: Math.floor(Date.now() / 1_000) + 300,
      principal,
      projectId: project.id,
      threadId,
      toolApprovalMode: input.toolApprovalMode,
    }, c.env.PROJECT_SECRETS_KEY);
    await registerProjectThread(c.env.DB, project.id, principal, threadId, runtime.agentName);
    try {
      return c.json({
        ...await services.playground(
          c.env,
          runtime.agentName,
          runtime.token,
          input.prompt,
        ),
        threadId,
      });
    } catch {
      return c.json({ error: "Playground turn failed" }, 502);
    }
  });

  app.put("/api/projects/:id", async (c) => {
    try {
      const blocked = await lifecycleFailure(c.env, userId(c.get("session"))!, c.req.raw);
      if (blocked) return blocked;
      const input = parseProjectInput(
        await body(c.req.raw),
        await offeredModels(c.env, userId(c.get("session"))!),
        c.env.LOCAL_DEV_MODE === "true",
      );
      const project = await updateProject(
        c.env,
        userId(c.get("session"))!,
        c.req.param("id"),
        input,
      );
      if (!project) return c.json({ error: "Project not found" }, 404);
      c.executionCtx.waitUntil(services.restart(c.env, project.id));
      return c.json(project, 202);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Invalid project" }, 400);
    }
  });

  app.post("/api/projects/:id/restart", async (c) => {
    const ownerId = userId(c.get("session"))!;
    const blocked = await lifecycleFailure(c.env, ownerId, c.req.raw);
    if (blocked) return blocked;
    const project = await getProject(c.env.DB, ownerId, c.req.param("id"));
    if (!project) return c.json({ error: "Project not found" }, 404);
    if (project.status === "deleting") return c.json({ error: "Project is being deleted" }, 409);
    await setProjectStatus(c.env.DB, project.id, "provisioning");
    c.executionCtx.waitUntil(services.restart(c.env, project.id));
    return c.json({ ...toPublicProject(project), status: "provisioning" }, 202);
  });

  app.delete("/api/projects/:id", async (c) => {
    const ownerId = userId(c.get("session"))!;
    const blocked = await lifecycleFailure(c.env, ownerId, c.req.raw);
    if (blocked) return blocked;
    const project = await getProject(c.env.DB, ownerId, c.req.param("id"));
    if (!project) return c.json({ error: "Project not found" }, 404);
    await setProjectStatus(c.env.DB, project.id, "deleting");
    c.executionCtx.waitUntil(services.destroy(c.env, ownerId, project.id));
    return c.json({ id: project.id, status: "deleting" }, 202);
  });

  app.get("/api/projects/:projectId/mcps", async (c) => {
    const ownerId = userId(c.get("session"))!;
    const project = await getProject(c.env.DB, ownerId, c.req.param("projectId"));
    if (!project) return c.json({ error: "Project not found" }, 404);
    return c.json(await listExternalMcps(c.env.DB, ownerId, project.id));
  });

  app.post("/api/projects/:projectId/mcps", async (c) => {
    try {
      const mcp = await createExternalMcp(
        c.env,
        userId(c.get("session"))!,
        c.req.param("projectId"),
        await body(c.req.raw),
      );
      return c.json(mcp, 201);
    } catch (error) {
      if (error instanceof RequestTooLargeError) {
        return c.json({ error: error.message }, 413);
      }
      const message = error instanceof Error && error.message === "Project not found"
        ? error.message
        : error instanceof Error && error.message === "External MCP limit reached"
          ? error.message
          : "External MCP is invalid or already exists";
      return c.json(
        { error: message },
        message === "Project not found" ? 404 : message === "External MCP limit reached" ? 409 : 400,
      );
    }
  });

  app.post("/api/projects/:projectId/mcps/:mcpId/connect", async (c) => {
    const ownerId = userId(c.get("session"))!;
    const blocked = await lifecycleFailure(c.env, ownerId, c.req.raw);
    if (blocked) return blocked;
    const projectId = c.req.param("projectId");
    const mcp = await getExternalMcp(c.env.DB, ownerId, projectId, c.req.param("mcpId"));
    if (!mcp) return c.json({ error: "External MCP not found" }, 404);
    try {
      if (mcp.authType === "oauth") {
        return c.json({ authorizationUrl: await beginExternalMcpOAuth(c.env, ownerId, projectId, mcp.id) });
      }
      const payload = (await body(c.req.raw)) as { bearer?: unknown };
      const connected = await connectExternalMcpWithBearer(
        c.env,
        ownerId,
        projectId,
        mcp.id,
        typeof payload.bearer === "string" ? payload.bearer : "",
      );
      if (!connected) return c.json({ error: "External MCP not found" }, 404);
      await setProjectStatus(c.env.DB, projectId, "provisioning");
      c.executionCtx.waitUntil(services.restart(c.env, projectId));
      return c.json(connected, 202);
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : "MCP connection failed" },
        400,
      );
    }
  });

  app.post("/api/projects/:projectId/mcps/:mcpId/disconnect", async (c) => {
    const ownerId = userId(c.get("session"))!;
    const blocked = await lifecycleFailure(c.env, ownerId, c.req.raw);
    if (blocked) return blocked;
    const projectId = c.req.param("projectId");
    const mcp = await disconnectExternalMcp(
      c.env.DB,
      ownerId,
      projectId,
      c.req.param("mcpId"),
    );
    if (!mcp) return c.json({ error: "External MCP not found" }, 404);
    await setProjectStatus(c.env.DB, projectId, "provisioning");
    c.executionCtx.waitUntil(services.restart(c.env, projectId));
    return c.json(mcp, 202);
  });

  app.delete("/api/projects/:projectId/mcps/:mcpId", async (c) => {
    const ownerId = userId(c.get("session"))!;
    const blocked = await lifecycleFailure(c.env, ownerId, c.req.raw);
    if (blocked) return blocked;
    const projectId = c.req.param("projectId");
    const mcp = await getExternalMcp(c.env.DB, ownerId, projectId, c.req.param("mcpId"));
    if (!mcp) return c.json({ error: "External MCP not found" }, 404);
    await deleteExternalMcp(c.env.DB, ownerId, projectId, mcp.id);
    if (mcp.connected) {
      await setProjectStatus(c.env.DB, projectId, "provisioning");
      c.executionCtx.waitUntil(services.restart(c.env, projectId));
    }
    return c.body(null, 204);
  });

  app.all("/control/mcp", async (c) => {
    const authorization = c.req.header("authorization");
    const authLimited = rateLimitFailure(await checkRateLimit(
      c.env,
      c.env.CONTROL_RATE_LIMITER,
      `agent-mcp-auth:${clientIdentity(c.req.raw)}`,
    ));
    if (authLimited) return authLimited;
    const session = await getAgentAccessTokenSession(c.env.DB, authorization ?? null);
    const ownerId = userId(session);
    if (!ownerId) {
      return c.json({ error: "A valid Lemy agent Bearer token is required" }, 401, {
        "WWW-Authenticate": "Bearer",
      });
    }
    if (!await hasCloudAccess(c.env.DB, ownerId)) {
      return c.json({ error: "Lemy Cloud access is awaiting approval" }, 403);
    }
    const limited = rateLimitFailure(await checkRateLimit(
      c.env,
      c.env.CONTROL_RATE_LIMITER,
      `agent-mcp:${ownerId}`,
    ));
    if (limited) return limited;
    const access = agentAccess(session);
    if (!access) return c.json({ error: "Agent token scope is invalid" }, 401);
    const call = async (path: string, method = "GET", payload?: unknown) => {
      const headers = new Headers({ authorization: authorization! });
      const clientIp = c.req.header("cf-connecting-ip");
      if (clientIp) headers.set("cf-connecting-ip", clientIp);
      if (payload !== undefined) headers.set("content-type", "application/json");
      const response = await app.fetch(new Request(new URL(path, c.env.PUBLIC_APP_URL), {
        method,
        headers,
        body: payload === undefined ? undefined : JSON.stringify(payload),
      }), c.env, c.executionCtx);
      if (response.status === 204) return { ok: true };
      const value = await response.json().catch(() => ({ error: "Lemy API returned an invalid response" }));
      if (!response.ok) throw new Error(
        typeof value === "object" && value && "error" in value
          ? String((value as { error: unknown }).error)
          : `Lemy API request failed (${response.status})`,
      );
      return value;
    };
    return createMcpHandler(createControlMcpServer(call, access), { route: "/control/mcp" })(
      c.req.raw,
      c.env,
      c.executionCtx as unknown as ExecutionContext,
    );
  });

  app.all("/external-mcp/:projectId/:mcpId", async (c) => {
    const projectId = c.req.param("projectId");
    let runtimeSession = null;
    const runtimeToken = c.req.header("x-lemy-runtime-session") ?? "";
    const runtimeThread = c.req.header("x-lemy-runtime-thread") ?? "";
    if (runtimeToken && runtimeThread) {
      try {
        runtimeSession = await openRuntimeSession(
          runtimeToken,
          c.env.PROJECT_SECRETS_KEY,
          projectId,
          runtimeThread,
        );
      } catch {
        return c.text("Project not found", 404);
      }
    }
    if (!runtimeSession) return c.text("Project not found", 404);
    const project = await getProjectById(c.env.DB, projectId);
    if (!project || project.status === "deleting") return c.text("Project not found", 404);
    if (!await hasCloudAccess(c.env.DB, project.ownerId)) return c.text("Project not found", 404);
    const failure = rateLimitFailure(await checkRateLimit(
      c.env,
      c.env.RUNTIME_PROJECT_RATE_LIMITER,
      `external-mcp:${project.id}`,
    ));
    if (failure) return failure;
    if (runtimeSession) {
      const principalFailure = rateLimitFailure(await checkRateLimit(
        c.env,
        c.env.RUNTIME_PRINCIPAL_RATE_LIMITER,
        `external-mcp:${project.id}:${runtimeSession.principal}`,
      ));
      if (principalFailure) return principalFailure;
    }
    const mcp = await getExternalMcpForProxy(c.env.DB, project.id, c.req.param("mcpId"));
    if (!mcp || !mcp.connected) return c.text("External MCP not found", 404);
    try {
      return await proxyExternalMcpRequest(c.env, mcp, c.req.raw);
    } catch {
      return c.text("External MCP unavailable", 502);
    }
  });

  app.post("/runtime/:projectId/session", async (c) => {
    let failure = rateLimitFailure(await checkRateLimit(
      c.env,
      c.env.AUTH_RATE_LIMITER,
      `runtime-session-edge:${clientIdentity(c.req.raw)}`,
    ));
    if (failure) return failure;
    const project = await getProjectById(c.env.DB, c.req.param("projectId"));
    if (!project || project.status === "deleting") return c.json({ error: "Project not found" }, 404);
    if (!await hasCloudAccess(c.env.DB, project.ownerId)) {
      return c.json({ error: "Workspace access is not active" }, 403);
    }
    const origin = c.req.header("origin");
    const allowedOrigin = runtimeCorsOrigin(project, c.req.raw);
    if (origin && !allowedOrigin) return c.json({ error: "Origin not allowed" }, 403);
    if (project.status !== "ready") {
      return withRuntimeCors(Response.json({ error: "Project is not ready" }, { status: 409 }), allowedOrigin);
    }
    const authorization = c.req.header("authorization");
    if (!isBearerAuthorization(authorization)) {
      return withRuntimeCors(Response.json({ error: "Bearer token required" }, { status: 401 }), allowedOrigin);
    }
    let principal: string;
    try {
      principal = await services.validate(authorization, project.bearerValidationUrl);
    } catch {
      return withRuntimeCors(Response.json({ error: "Bearer token rejected" }, { status: 401 }), allowedOrigin);
    }
    failure = rateLimitFailure(await checkRateLimit(
      c.env,
      c.env.RUNTIME_PROJECT_RATE_LIMITER,
      `runtime-session-project:${project.id}`,
    ));
    if (!failure) {
      failure = rateLimitFailure(await checkRateLimit(
        c.env,
        c.env.RUNTIME_PRINCIPAL_RATE_LIMITER,
        `runtime-session-principal:${project.id}:${principal}`,
      ));
    }
    if (failure) return withRuntimeCors(failure, allowedOrigin);
    if (!await hasValidatedProvider(c.env.DB, project.ownerId, project.llmProvider)) {
      return withRuntimeCors(Response.json({
        error: "The project's model provider is not available",
      }, { status: 409 }), allowedOrigin);
    }
    try {
      const value = await parseLimitedJson(c.req.raw, RUNTIME_SESSION_BODY_LIMIT) as {
        approvedTools?: unknown;
        threadId?: unknown;
        toolApprovalMode?: unknown;
      };
      const threadId = value.threadId === undefined ? crypto.randomUUID() : value.threadId;
      const approvedTools = value.approvedTools === undefined ? [] : value.approvedTools;
      const toolApprovalMode = value.toolApprovalMode === undefined ? "ask" : value.toolApprovalMode;
      if (typeof threadId !== "string" || !Array.isArray(approvedTools)) {
        throw new Error("Runtime session input is invalid");
      }
      const expiresAt = Math.floor(Date.now() / 1_000) + 300;
      const session = await createRuntimeSession({
        approvedTools: approvedTools as string[],
        authorization,
        expiresAt,
        principal,
        projectId: project.id,
        threadId,
        toolApprovalMode: toolApprovalMode as "auto" | "ask",
      }, c.env.PROJECT_SECRETS_KEY);
      await registerProjectThread(
        c.env.DB,
        project.id,
        principal,
        threadId,
        session.agentName,
      );
      await reserveRuntimeSession(
        c.env.DB,
        project.id,
        principal,
        threadId,
        expiresAt * 1_000,
      );
      return withRuntimeCors(Response.json({
        expiresAt,
        protocol: "cloudflare-think",
        runtimePath: `/runtime/${project.id}/agent/${threadId}`,
        threadId,
        token: session.token,
      }), allowedOrigin);
    } catch (error) {
      return withRuntimeCors(Response.json({
        error: error instanceof Error ? error.message : "Runtime session input is invalid",
      }, { status: error instanceof RequestTooLargeError ? 413 : 400 }), allowedOrigin);
    }
  });

  app.options("/runtime/:projectId/session", async (c) => {
    const project = await getProjectById(c.env.DB, c.req.param("projectId"));
    if (!project || project.status === "deleting") return c.body(null, 404);
    const origin = runtimeCorsOrigin(project, c.req.raw);
    if (!origin) return c.body(null, 403);
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Headers": "authorization, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Max-Age": "600",
        Vary: "Origin",
      },
    });
  });

  app.all("/runtime/:projectId/agent/:threadId/*", async (c) => {
    const projectId = c.req.param("projectId");
    const threadId = c.req.param("threadId");
    const project = await getProjectById(c.env.DB, projectId);
    if (!project || project.status !== "ready") return c.text("Project not found", 404);
    if (!await hasCloudAccess(c.env.DB, project.ownerId)) return c.text("Project not found", 404);
    const origin = c.req.header("origin");
    const allowedOrigin = runtimeCorsOrigin(project, c.req.raw);
    if (origin && !allowedOrigin) return c.text("Origin not allowed", 403);
    if (c.req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Headers": "content-type",
          "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
          "Access-Control-Allow-Origin": allowedOrigin ?? "",
          "Access-Control-Max-Age": "600",
          Vary: "Origin",
        },
      });
    }
    const token = c.req.query("token") ?? "";
    let session;
    try {
      session = await openRuntimeSession(
        token,
        c.env.PROJECT_SECRETS_KEY,
        projectId,
        threadId,
      );
    } catch {
      return withRuntimeCors(c.text("Runtime session rejected", 401), allowedOrigin);
    }
    let failure = rateLimitFailure(await checkRateLimit(
      c.env,
      c.env.RUNTIME_PROJECT_RATE_LIMITER,
      `runtime-connect-project:${project.id}`,
    ));
    if (!failure) {
      failure = rateLimitFailure(await checkRateLimit(
        c.env,
        c.env.RUNTIME_PRINCIPAL_RATE_LIMITER,
        `runtime-connect-principal:${project.id}:${session.principal}`,
      ));
    }
    if (failure) return withRuntimeCors(failure, allowedOrigin);
    const url = new URL(c.req.url);
    url.searchParams.delete("token");
    const headers = new Headers(c.req.raw.headers);
    headers.set("x-lemy-runtime-session", token);
    return withRuntimeCors(await services.agent(
      new Request(url, {
        body: ["GET", "HEAD"].includes(c.req.method) ? undefined : c.req.raw.body,
        headers,
        method: c.req.method,
      }),
      c.env,
      await runtimeAgentName(project.id, session.principal, threadId),
    ), allowedOrigin);
  });

  return app;
}
