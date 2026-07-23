import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type ApiCall = (path: string, method?: string, body?: unknown) => Promise<unknown>;

interface ControlMcpScope {
  permission: "read" | "write";
  projectId: string;
}

const skill = z.object({
  name: z.string(),
  description: z.string(),
  instructions: z.string(),
});

const project = {
  name: z.string(),
  openapiSchemaUrl: z.string().url(),
  openapiBaseUrl: z.string().url().nullable().optional(),
  bearerValidationUrl: z.string().url(),
  corsOrigins: z.array(z.string().url()),
  allowMutations: z.boolean().default(false),
  llmProvider: z.enum(["openai", "anthropic"]),
  llmModel: z.string(),
  skills: z.array(skill).default([]),
};

function result(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

export function createControlMcpServer(call: ApiCall, scope?: ControlMcpScope) {
  const server = new McpServer({ name: "Lemy Cloud", version: "0.1.0" });
  const projectId = scope ? z.literal(scope.projectId) : z.string().uuid();
  const tool = <T extends z.ZodRawShape>(
    name: string,
    description: string,
    inputSchema: T,
    action: (input: Record<string, unknown>) => Promise<unknown>,
  ) => server.registerTool(
    name,
    { description, inputSchema },
    (async (input: Record<string, unknown>) => result(await action(input))) as never,
  );

  if (!scope) tool("list_projects", "List the authenticated user's Lemy projects.", {},
    () => call("/api/projects"));
  tool("get_project", "Get one Lemy project and its current configuration.", { projectId },
    ({ projectId }) => call(`/api/projects/${projectId}`));
  if (!scope) tool("list_model_providers", "List configured model providers and the models available to projects.", {},
    () => call("/api/providers"));
  if (!scope) tool("configure_model_provider", "Validate and save an OpenAI or Anthropic API key for the workspace.", {
    provider: z.enum(["openai", "anthropic"]),
    apiKey: z.string().min(1).max(512),
  }, ({ provider, apiKey }) => call(`/api/providers/${provider}`, "PUT", { apiKey }));
  if (!scope) tool("validate_model_provider", "Refresh validation for a configured workspace model provider.", {
    provider: z.enum(["openai", "anthropic"]),
  }, ({ provider }) => call(`/api/providers/${provider}/validate`, "POST"));
  if (!scope) tool("create_project", "Create and provision a Lemy project from an OpenAPI API.", project,
    (input) => call("/api/projects", "POST", input));
  if (!scope || scope.permission === "write") {
    tool("update_project", "Replace a project's configuration and restart it.", {
      projectId,
      ...project,
    }, ({ projectId, ...input }) => call(`/api/projects/${projectId}`, "PUT", input));
    tool("restart_project", "Restart a project after confirming this lifecycle action with the user.", {
      projectId,
      confirmed: z.literal(true).describe("True only after explicit user confirmation"),
    }, ({ projectId }) => call(`/api/projects/${projectId}/restart`, "POST"));
    tool("delete_project", "Delete a project after explicit user confirmation.", {
      projectId,
      confirmed: z.literal(true).describe("True only after explicit user confirmation"),
    }, ({ projectId }) => call(`/api/projects/${projectId}`, "DELETE"));
  }
  tool("list_external_mcps", "List external MCP servers configured for a project.", {
    projectId,
  }, ({ projectId }) => call(`/api/projects/${projectId}/mcps`));
  if (!scope || scope.permission === "write") {
    tool("add_external_mcp", "Add an OAuth or Bearer-authenticated external MCP server to a project.", {
      projectId,
      name: z.string(),
      url: z.string().url(),
      authType: z.enum(["oauth", "bearer"]),
    }, ({ projectId, ...input }) => call(`/api/projects/${projectId}/mcps`, "POST", input));
    tool("connect_external_mcp", "Connect an external MCP. OAuth returns a URL for the user to open; Bearer requires its token.", {
      projectId,
      mcpId: z.string().uuid(),
      bearer: z.string().optional(),
    }, ({ projectId, mcpId, bearer }) => call(
      `/api/projects/${projectId}/mcps/${mcpId}/connect`,
      "POST",
      bearer ? { bearer } : {},
    ));
    tool("disconnect_external_mcp", "Disconnect an external MCP after explicit user confirmation.", {
      projectId,
      mcpId: z.string().uuid(),
      confirmed: z.literal(true).describe("True only after explicit user confirmation"),
    }, ({ projectId, mcpId }) => call(`/api/projects/${projectId}/mcps/${mcpId}/disconnect`, "POST"));
    tool("delete_external_mcp", "Remove an external MCP after explicit user confirmation.", {
      projectId,
      mcpId: z.string().uuid(),
      confirmed: z.literal(true).describe("True only after explicit user confirmation"),
    }, ({ projectId, mcpId }) => call(`/api/projects/${projectId}/mcps/${mcpId}`, "DELETE"));
  }

  return server;
}
