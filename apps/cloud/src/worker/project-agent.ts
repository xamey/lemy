import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import {
  DynamicWorkerExecutor,
  McpConnector,
  OpenApiConnector,
  sanitizeToolName,
  type ConnectorTool,
  type OpenApiRequestOptions,
} from "@cloudflare/codemode";
import {
  Think,
  type ChatErrorContext,
  type ChatResponseResult,
  type Session,
  type SkillSource,
  type StepContext,
  type TurnConfig,
  type TurnContext,
} from "@cloudflare/think";
import { createExecuteTool } from "@cloudflare/think/tools/execute";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { getCurrentAgent, type Connection, type ConnectionContext } from "agents";
import type { ToolSet } from "ai";

import {
  loadOpenApiSpec,
  parseResponse,
} from "../../../../services/codemode/src/server";
import {
  assertAllowedOperation,
  buildApiUrl,
  resolveApiBaseUrl,
} from "../../../../services/codemode/src/openapi";
import type { Env } from "./env";
import { hasCloudAccess } from "./access";
import { consumeDynamicWorkerBudget } from "./cloud-budget";
import {
  externalMcpConnectionName,
  listConnectedExternalMcps,
  type PublicExternalMcp,
} from "./external-mcps";
import { publicHttpsUrl } from "./outbound-url";
import { getProviderApiKey } from "./provider-credentials";
import { getProjectById, type StoredProject } from "./projects";
import { checkRateLimit } from "./rate-limit";
import {
  recordProjectRun,
  type ProjectRunSource,
  type ProjectRunStatus,
} from "./project-runs";
import { openRuntimeSession, type RuntimeSessionClaims } from "./runtime-session";

interface RuntimeConnectionState {
  approvedTools: string[];
  token: string;
  toolApprovalMode: "auto" | "ask";
}

function projectIdFromAgentName(name: string): string {
  const projectId = name.slice(0, 36);
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) throw new Error("Project agent identity is invalid");
  return projectId;
}

function threadIdFromAgentName(name: string): string {
  const threadId = name.slice(-36);
  if (!/^[0-9a-f-]{36}$/i.test(threadId)) throw new Error("Project agent identity is invalid");
  return threadId;
}

function currentConnectionState(fallback?: RuntimeConnectionState): RuntimeConnectionState | null {
  const state = getCurrentAgent().connection?.state;
  if (!state || typeof state !== "object" || Array.isArray(state)) return fallback ?? null;
  const value = state as Partial<RuntimeConnectionState>;
  return typeof value.token === "string"
      && (value.toolApprovalMode === "auto" || value.toolApprovalMode === "ask")
      && Array.isArray(value.approvedTools)
    ? value as RuntimeConnectionState
    : null;
}

function body(options: OpenApiRequestOptions): BodyInit | undefined {
  if (options.body === undefined) return undefined;
  return JSON.stringify(options.body);
}

function method(value: string | undefined): "DELETE" | "GET" | "PATCH" | "POST" | "PUT" {
  const normalized = (value ?? "GET").toUpperCase();
  if (!["DELETE", "GET", "PATCH", "POST", "PUT"].includes(normalized)) {
    throw new Error("Unsupported API method");
  }
  return normalized as "DELETE" | "GET" | "PATCH" | "POST" | "PUT";
}

function query(values: Record<string, unknown> | undefined) {
  if (!values) return undefined;
  const normalized: Record<string, string | number | boolean | undefined> = {};
  for (const [key, value] of Object.entries(values)) {
    if (
      value !== undefined
      && typeof value !== "string"
      && typeof value !== "number"
      && typeof value !== "boolean"
    ) throw new Error("API query parameter is invalid");
    normalized[key] = value;
  }
  return normalized;
}

function mutationToolNames(spec: Record<string, unknown>): Set<string> {
  const names = new Set<string>();
  const paths = spec.paths && typeof spec.paths === "object"
    ? spec.paths as Record<string, unknown>
    : {};
  for (const [path, rawItem] of Object.entries(paths)) {
    if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) continue;
    const item = rawItem as Record<string, unknown>;
    for (const method of ["post", "put", "patch", "delete", "options", "head"]) {
      const operation = item[method];
      if (!operation || typeof operation !== "object" || Array.isArray(operation)) continue;
      const operationId = (operation as Record<string, unknown>).operationId;
      names.add(sanitizeToolName(
        typeof operationId === "string" ? operationId : `${method}_${path}`,
      ));
    }
  }
  return names;
}

class ProjectSkillSource implements SkillSource {
  readonly id: string;
  fingerprint = "empty";
  private project?: StoredProject;

  constructor(
    projectId: string,
    private readonly loadProject: () => Promise<StoredProject>,
  ) {
    this.id = `project:${projectId}`;
  }

  async refresh() {
    this.project = await this.loadProject();
    this.fingerprint = this.project.updatedAt;
  }

  async list() {
    if (!this.project) await this.refresh();
    return this.project!.skills.map(({ name, description }) => ({ name, description }));
  }

  async load(name: string) {
    if (!this.project) await this.refresh();
    const skill = this.project!.skills.find((entry) => entry.name === name);
    return skill ? { ...skill, body: skill.instructions } : null;
  }
}

class ProjectOpenApiConnector extends OpenApiConnector<Env> {
  private mutations = new Set<string>();

  constructor(
    ctx: DurableObjectState,
    env: Env,
    private readonly project: StoredProject,
    private readonly runtimeToken: string,
    private readonly threadId: string,
    private readonly approval: Pick<RuntimeConnectionState, "approvedTools" | "toolApprovalMode">,
  ) {
    super(ctx, env);
  }

  name() {
    return "api";
  }

  protected instructions() {
    return `Use ${this.project.name} for the user's application data and actions.`;
  }

  protected async spec() {
    const spec = await loadOpenApiSpec(this.project.openapiSchemaUrl);
    this.mutations = mutationToolNames(spec);
    return spec;
  }

  protected tool(name: string, tool: ConnectorTool): ConnectorTool {
    const approvalName = `${this.name()}.${name}`;
    const needsApproval = this.project.allowMutations
      && (name === "request" || this.mutations.has(name))
      && this.approval.toolApprovalMode === "ask"
      && !this.approval.approvedTools.includes(approvalName);
    return needsApproval ? { ...tool, requiresApproval: true } : tool;
  }

  protected async request(options: OpenApiRequestOptions): Promise<unknown> {
    const session = await openRuntimeSession(
      this.runtimeToken,
      this.env.PROJECT_SECRETS_KEY,
      this.project.id,
      this.threadId,
    );
    const spec = await this.spec();
    const requestMethod = method(options.method);
    assertAllowedOperation(spec, requestMethod, options.path, this.project.allowMutations);
    const rawBaseUrl = resolveApiBaseUrl(
      spec,
      this.project.openapiSchemaUrl,
      this.project.openapiBaseUrl ?? undefined,
      { method: requestMethod, path: options.path },
    );
    const baseUrl = publicHttpsUrl(rawBaseUrl, this.env.LOCAL_DEV_MODE === "true").toString();
    const headers: Record<string, string> = { Authorization: session.authorization };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    return parseResponse(await fetch(buildApiUrl(baseUrl, options.path, query(options.params)), {
      body: body(options),
      headers,
      method: requestMethod,
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    }), session.authorization);
  }
}

class ProjectMcpConnector extends McpConnector<Env> {
  private transport?: StreamableHTTPClientTransport;

  constructor(
    ctx: DurableObjectState,
    env: Env,
    private readonly mcp: PublicExternalMcp,
    private readonly runtimeToken: string,
    private readonly threadId: string,
    private readonly approval: Pick<RuntimeConnectionState, "approvedTools" | "toolApprovalMode">,
  ) {
    super(ctx, env);
  }

  name() {
    return externalMcpConnectionName(this.mcp);
  }

  protected instructions() {
    return `Use ${this.mcp.name} when its external tools are relevant.`;
  }

  protected async createConnection() {
    const url = new URL(`/external-mcp/${this.mcp.projectId}/${this.mcp.id}`, this.env.PUBLIC_APP_URL);
    this.transport = new StreamableHTTPClientTransport(url, {
      requestInit: {
        headers: {
          "x-lemy-runtime-session": this.runtimeToken,
          "x-lemy-runtime-thread": this.threadId,
        },
      },
    });
    const client = new Client({ name: "Lemy", version: "0.1.0" });
    await client.connect(this.transport);
    return {
      client,
      fetchTools: async () => (await client.listTools()).tools,
      instructions: this.instructions(),
      name: this.name(),
    };
  }

  protected tool(name: string, tool: ConnectorTool): ConnectorTool {
    const approvalName = `${this.name()}.${name}`;
    return this.approval.toolApprovalMode === "ask"
        && !this.approval.approvedTools.includes(approvalName)
      ? { ...tool, requiresApproval: true }
      : tool;
  }

  async onPassEnd() {
    await this.transport?.close().catch(() => undefined);
    this.transport = undefined;
  }
}

export class LemyProjectAgent extends Think<Cloudflare.Env> {
  static options = { sendIdentityOnConnect: false };
  workspaceBash = false;
  chatStreamStallTimeoutMs = 120_000;
  maxSteps = 8;

  private project?: StoredProject;
  private externalMcps: PublicExternalMcp[] = [];
  private providerApiKey?: string;
  private programmaticState?: RuntimeConnectionState;
  private run?: {
    id: string;
    inputTokens: number;
    outputTokens: number;
    source: ProjectRunSource;
    startedAt: number;
    toolCalls: number;
  };
  private runSource: ProjectRunSource = "runtime";
  private skillSource?: ProjectSkillSource;

  private get projectId() {
    return projectIdFromAgentName(this.name);
  }

  private async loadProject(): Promise<StoredProject> {
    const project = await getProjectById(this.env.DB, this.projectId);
    if (
      !project
      || project.status !== "ready"
      || !await hasCloudAccess(this.env.DB, project.ownerId)
    ) throw new Error("Project is unavailable");
    this.project = project;
    return project;
  }

  async refresh() {
    const project = await this.loadProject();
    await this.loadProviderApiKey(project);
    this.externalMcps = await listConnectedExternalMcps(this.env.DB, project.id);
  }

  private async loadProviderApiKey(project: StoredProject): Promise<void> {
    const apiKey = await getProviderApiKey(
      this.env,
      project.ownerId,
      project.llmProvider,
    );
    if (!apiKey) throw new Error(`${project.llmProvider === "openai" ? "OpenAI" : "Anthropic"} is unavailable`);
    this.providerApiKey = apiKey;
  }

  private selectedModel(project = this.project) {
    if (!project) throw new Error("Project configuration is unavailable");
    if (!this.providerApiKey) throw new Error("Project model provider is unavailable");
    if (project.llmProvider === "openai") {
      return createOpenAI({
        apiKey: this.providerApiKey,
      })(project.llmModel);
    }
    return createAnthropic({
      apiKey: this.providerApiKey,
    })(project.llmModel);
  }

  async configureSession(session: Session) {
    await this.refresh();
    const project = this.project!;
    return session.withContext("soul", {
      provider: { get: async () => this.systemPrompt(project) },
    }).withCachedPrompt();
  }

  getModel() {
    return this.selectedModel();
  }

  getSystemPrompt() {
    return this.systemPrompt(this.project);
  }

  private systemPrompt(project = this.project) {
    if (!project) return "You are Lemy, an assistant for the user's application.";
    return [
      `You are Lemy, the agent for ${project.name}.`,
      "Use the execute tool to read or act on application data through its typed connectors.",
      project.allowMutations
        ? "Mutating API operations are enabled and may require user approval."
        : "The application API is read-only. Never attempt mutations.",
      "Use external MCP connectors when they are relevant. Never expose credentials or internal tokens.",
    ].join("\n");
  }

  async getSkills() {
    const project = this.project ?? await this.loadProject();
    this.skillSource ??= new ProjectSkillSource(project.id, () => this.loadProject());
    await this.skillSource.refresh();
    return [this.skillSource];
  }

  getTools(): ToolSet {
    const state = currentConnectionState(this.programmaticState);
    if (!state || !this.project || !this.env.LOADER) return {};
    const connectors = [
      new ProjectOpenApiConnector(
        this.ctx,
        this.env,
        this.project,
        state.token,
        threadIdFromAgentName(this.name),
        state,
      ),
      ...this.externalMcps.map((mcp) => new ProjectMcpConnector(
        this.ctx,
        this.env,
        mcp,
        state.token,
        threadIdFromAgentName(this.name),
        state,
      )),
    ];
    const dynamicExecutor = new DynamicWorkerExecutor({
      loader: this.env.LOADER,
      timeout: 15_000,
    });
    const executor: Pick<DynamicWorkerExecutor, "execute"> = {
      execute: async (...args) => {
        try {
          await consumeDynamicWorkerBudget(this.env, this.project!.ownerId);
        } catch (error) {
          return {
            error: error instanceof Error ? error.message : "Code Mode is temporarily unavailable",
            result: null,
          };
        }
        return dynamicExecutor.execute(...args);
      },
    };
    return {
      execute: createExecuteTool(this, {
        connectors,
        executor,
      }),
    };
  }

  async onConnect(connection: Connection, context: ConnectionContext) {
    const token = context.request.headers.get("x-lemy-runtime-session") ?? "";
    const session = await openRuntimeSession(
      token,
      this.env.PROJECT_SECRETS_KEY,
      this.projectId,
      threadIdFromAgentName(this.name),
    );
    connection.setState({
      approvedTools: session.approvedTools,
      token,
      toolApprovalMode: session.toolApprovalMode,
    });
    await super.onConnect(connection, context);
  }

  private async runtimeSession(): Promise<RuntimeSessionClaims> {
    const state = currentConnectionState(this.programmaticState);
    if (!state) throw new Error("Runtime session required");
    return openRuntimeSession(
      state.token,
      this.env.PROJECT_SECRETS_KEY,
      this.projectId,
      threadIdFromAgentName(this.name),
    );
  }

  async beforeTurn(context: TurnContext): Promise<TurnConfig> {
    if ((await this.getMessages()).length > 100) {
      throw new Error("Conversation message limit reached. Start a new thread.");
    }
    this.run = {
      id: crypto.randomUUID(),
      inputTokens: 0,
      outputTokens: 0,
      source: this.runSource,
      startedAt: Date.now(),
      toolCalls: 0,
    };
    const session = await this.runtimeSession();
    const project = await this.loadProject();
    if (await checkRateLimit(
      this.env,
      this.env.RUNTIME_PROJECT_RATE_LIMITER,
      `think-turn-project:${project.id}`,
    ) !== "allowed") throw new Error("Project rate limit exceeded");
    if (await checkRateLimit(
      this.env,
      this.env.RUNTIME_PRINCIPAL_RATE_LIMITER,
      `think-turn-principal:${project.id}:${session.principal}`,
    ) !== "allowed") throw new Error("User rate limit exceeded");
    await this.loadProviderApiKey(project);
    const excluded = new Set(["bash", "delete", "edit", "find", "grep", "list", "read", "write"]);
    return {
      activeTools: Object.keys(context.tools).filter((name) => !excluded.has(name)),
      maxOutputTokens: 4_096,
      model: this.selectedModel(project),
      system: this.systemPrompt(project),
    };
  }

  async onStepFinish(context: StepContext) {
    if (!this.run) return;
    this.run.inputTokens += context.usage.inputTokens ?? 0;
    this.run.outputTokens += context.usage.outputTokens ?? 0;
    this.run.toolCalls += context.toolCalls.length;
  }

  private async finishRun(status: ProjectRunStatus, error: string | null = null) {
    const run = this.run;
    this.run = undefined;
    if (!run) return;
    await recordProjectRun(this.env.DB, {
      ...run,
      projectId: this.projectId,
      threadId: threadIdFromAgentName(this.name),
      model: this.project?.llmModel ?? "unknown",
      status,
      error,
      completedAt: Date.now(),
    }).catch(() => undefined);
  }

  async onChatResponse(result: ChatResponseResult) {
    await this.finishRun(
      result.status === "completed" ? "completed" : result.status,
      result.error ? "Agent turn failed" : null,
    );
  }

  onChatError(error: unknown, context?: ChatErrorContext) {
    this.ctx.waitUntil(this.finishRun("error", "Agent turn failed"));
    return super.onChatError(error, context);
  }

  async playground(runtimeToken: string, prompt: string) {
    const session = await openRuntimeSession(
      runtimeToken,
      this.env.PROJECT_SECRETS_KEY,
      this.projectId,
      threadIdFromAgentName(this.name),
    );
    this.programmaticState = {
      approvedTools: session.approvedTools,
      token: runtimeToken,
      toolApprovalMode: session.toolApprovalMode,
    };
    this.runSource = "playground";
    try {
      const result = await this.saveMessages([{
        id: crypto.randomUUID(),
        role: "user",
        parts: [{ type: "text", text: prompt }],
      }]);
      const message = [...await this.getMessages()]
        .reverse()
        .find(({ role }) => role === "assistant");
      const parts = message?.parts ?? [];
      return {
        answer: parts
          .filter((part): part is typeof part & { text: string } =>
            part.type === "text" && typeof (part as { text?: unknown }).text === "string")
          .map(({ text }) => text)
          .join(""),
        pendingTools: parts.flatMap((part) => {
          const value = part as unknown as {
            state?: string;
            toolName?: string;
            type?: string;
          };
          if (value.state !== "approval-requested") return [];
          return [value.toolName ?? value.type?.replace(/^tool-/, "") ?? "tool"];
        }),
        status: result.status,
      };
    } finally {
      this.programmaticState = undefined;
      this.runSource = "runtime";
    }
  }

  async purge() {
    await this.ctx.storage.deleteAll();
  }
}
