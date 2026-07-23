import { DynamicWorkerExecutor } from "@cloudflare/codemode";
import { openApiMcpServer, type RequestOptions } from "@cloudflare/codemode/mcp";
import { createMcpHandler } from "agents/mcp";

import { assertAllowedOperation, buildApiUrl, resolveApiBaseUrl } from "./openapi.js";

export interface CodeModeEnv {
  LOADER: WorkerLoader;
  OPENAPI_SCHEMA_URL: string;
  OPENAPI_BASE_URL?: string;
  API_NAME?: string;
  ALLOW_MUTATIONS?: string;
}

export interface OpenApiMcpConfig {
  schemaUrl: string;
  baseUrl?: string | null;
  apiName?: string | null;
  allowMutations?: boolean;
}

const SCHEMA_FETCH_TIMEOUT_MS = 10_000;
const API_FETCH_TIMEOUT_MS = 30_000;
const MAX_SCHEMA_BYTES = 1_000_000;
const MAX_API_RESPONSE_BYTES = 128_000;
const MAX_CACHED_SPECS = 20;
const REDACTED = "[REDACTED]";

const specCache = new Map<string, Promise<Record<string, unknown>>>();

async function limitedText(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("Upstream response is too large");
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error("Upstream response is too large");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function isBearer(value: string | null): value is string {
  return Boolean(value && /^Bearer\s+\S+$/i.test(value));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export async function loadOpenApiSpec(
  schemaUrl: string,
  refresh = false,
): Promise<Record<string, unknown>> {
  if (refresh) specCache.delete(schemaUrl);
  const cached = specCache.get(schemaUrl);
  if (cached) return cached;

  const promise = fetch(schemaUrl, { signal: AbortSignal.timeout(SCHEMA_FETCH_TIMEOUT_MS) }).then(
    async (response) => {
      if (!response.ok) throw new Error(`OpenAPI request failed: ${response.status}`);
      const spec = asRecord(JSON.parse(await limitedText(response, MAX_SCHEMA_BYTES)));
      if (!spec || typeof spec.openapi !== "string" || !asRecord(spec.paths)) {
        throw new Error("OpenAPI response is not a valid document");
      }
      return spec;
    },
  );

  specCache.set(schemaUrl, promise);
  if (specCache.size > MAX_CACHED_SPECS) specCache.delete(specCache.keys().next().value!);
  void promise.catch(() => {
    if (specCache.get(schemaUrl) === promise) specCache.delete(schemaUrl);
  });
  return promise;
}

export function redactCredentials(value: unknown, authorization: string): unknown {
  const token = authorization.replace(/^Bearer\s+/i, "");
  const secrets = [...new Set([authorization, token])].sort((left, right) => right.length - left.length);
  const redactString = (text: string): string => {
    for (const secret of secrets) text = text.replaceAll(secret, REDACTED);
    return text;
  };
  const redact = (entry: unknown): unknown => {
    if (typeof entry === "string") return redactString(entry);
    if (Array.isArray(entry)) return entry.map(redact);
    if (entry !== null && typeof entry === "object") {
      return Object.fromEntries(
        Object.entries(entry).map(([key, nested]) => [redactString(key), redact(nested)]),
      );
    }
    return entry;
  };

  return redact(value);
}

export async function parseResponse(response: Response, authorization: string): Promise<unknown> {
  if (response.status === 204) return null;

  const contentType = response.headers.get("Content-Type") ?? "";
  const text = await limitedText(response, MAX_API_RESPONSE_BYTES);
  const result = redactCredentials(
    contentType.includes("json") ? JSON.parse(text) : text,
    authorization,
  );
  if (!response.ok) {
    const detail = typeof result === "string" ? result : (JSON.stringify(result) ?? String(result));
    throw new Error(`API request failed: ${response.status} ${detail.slice(0, 2_000)}`);
  }
  return result;
}

function requestBody(options: RequestOptions): BodyInit | undefined {
  if (options.body === undefined) return undefined;
  return options.rawBody ? (options.body as BodyInit) : JSON.stringify(options.body);
}

export async function handleOpenApiMcp(
  request: Request,
  env: Pick<CodeModeEnv, "LOADER">,
  ctx: ExecutionContext,
  config: OpenApiMcpConfig,
): Promise<Response> {
    const authorization = request.headers.get("Authorization");
    if (!isBearer(authorization)) {
      return new Response("Bearer token required", { status: 401 });
    }
    if (!config.schemaUrl) {
      return new Response("OpenAPI schema URL is required", { status: 503 });
    }

    const spec = await loadOpenApiSpec(config.schemaUrl);
    const allowMutations = config.allowMutations === true;
    const info = spec.info as Record<string, unknown> | undefined;

    const server = openApiMcpServer({
      spec,
      executor: new DynamicWorkerExecutor({ loader: env.LOADER }),
      name: config.apiName || (typeof info?.title === "string" ? info.title : "openapi-api"),
      version: typeof info?.version === "string" ? info.version : "1.0.0",
      description: allowMutations
        ? "Mutating operations are enabled. Confirm intent before changing data."
        : "This server is read-only. Mutating operations are blocked by policy.",
      request: async (options) => {
        assertAllowedOperation(spec, options.method, options.path, allowMutations);
        const baseUrl = resolveApiBaseUrl(spec, config.schemaUrl, config.baseUrl ?? undefined, options);
        const headers: Record<string, string> = { Authorization: authorization };
        if (options.contentType) {
          headers["Content-Type"] = options.contentType;
        } else if (options.body !== undefined) {
          headers["Content-Type"] = "application/json";
        }

        return parseResponse(
          await fetch(buildApiUrl(baseUrl, options.path, options.query), {
            method: options.method,
            headers,
            body: requestBody(options),
            redirect: "manual",
            signal: AbortSignal.timeout(API_FETCH_TIMEOUT_MS),
          }),
          authorization,
        );
      },
    });

    return createMcpHandler(server, { route: "/mcp" })(request, env, ctx);
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      if (!env.OPENAPI_SCHEMA_URL) {
        return Response.json({ status: "unhealthy" }, { status: 503 });
      }
      try {
        await loadOpenApiSpec(env.OPENAPI_SCHEMA_URL);
        return Response.json({ status: "ok" });
      } catch {
        return Response.json({ status: "unhealthy" }, { status: 503 });
      }
    }

    return handleOpenApiMcp(request, env, ctx, {
      schemaUrl: env.OPENAPI_SCHEMA_URL,
      baseUrl: env.OPENAPI_BASE_URL,
      apiName: env.API_NAME,
      allowMutations: env.ALLOW_MUTATIONS?.toLowerCase() === "true",
    });
  },
} satisfies ExportedHandler<CodeModeEnv>;
