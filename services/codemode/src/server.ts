import { DynamicWorkerExecutor } from "@cloudflare/codemode";
import { openApiMcpServer, type RequestOptions } from "@cloudflare/codemode/mcp";
import { createMcpHandler } from "agents/mcp";

import { assertAllowedOperation, buildApiUrl, resolveApiBaseUrl } from "./openapi.js";

interface Env {
  LOADER: WorkerLoader;
  OPENAPI_SCHEMA_URL: string;
  OPENAPI_BASE_URL?: string;
  API_NAME?: string;
  ALLOW_MUTATIONS?: string;
}

const SCHEMA_FETCH_TIMEOUT_MS = 10_000;
const API_FETCH_TIMEOUT_MS = 30_000;
const REDACTED = "[REDACTED]";

let specCache:
  | { schemaUrl: string; promise: Promise<Record<string, unknown>> }
  | undefined;

function isBearer(value: string | null): value is string {
  return Boolean(value && /^Bearer\s+\S+$/i.test(value));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

async function loadSpec(schemaUrl: string): Promise<Record<string, unknown>> {
  if (specCache?.schemaUrl === schemaUrl) return specCache.promise;

  const promise = fetch(schemaUrl, { signal: AbortSignal.timeout(SCHEMA_FETCH_TIMEOUT_MS) }).then(
    async (response) => {
      if (!response.ok) throw new Error(`OpenAPI request failed: ${response.status}`);
      const spec = asRecord(await response.json());
      if (!spec || typeof spec.openapi !== "string" || !asRecord(spec.paths)) {
        throw new Error("OpenAPI response is not a valid document");
      }
      return spec;
    },
  );

  specCache = { schemaUrl, promise };
  void promise.catch(() => {
    if (specCache?.promise === promise) specCache = undefined;
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
  const result = redactCredentials(
    contentType.includes("json") ? await response.json() : await response.text(),
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

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      if (!env.OPENAPI_SCHEMA_URL) {
        return Response.json({ status: "unhealthy" }, { status: 503 });
      }
      try {
        await loadSpec(env.OPENAPI_SCHEMA_URL);
        return Response.json({ status: "ok" });
      } catch {
        return Response.json({ status: "unhealthy" }, { status: 503 });
      }
    }

    const authorization = request.headers.get("Authorization");
    if (!isBearer(authorization)) {
      return new Response("Bearer token required", { status: 401 });
    }
    if (!env.OPENAPI_SCHEMA_URL) {
      return new Response("OPENAPI_SCHEMA_URL is required", { status: 503 });
    }

    const spec = await loadSpec(env.OPENAPI_SCHEMA_URL);
    const allowMutations = env.ALLOW_MUTATIONS?.toLowerCase() === "true";
    const info = spec.info as Record<string, unknown> | undefined;

    const server = openApiMcpServer({
      spec,
      executor: new DynamicWorkerExecutor({ loader: env.LOADER }),
      name: env.API_NAME || (typeof info?.title === "string" ? info.title : "openapi-api"),
      version: typeof info?.version === "string" ? info.version : "1.0.0",
      description: allowMutations
        ? "Mutating operations are enabled. Confirm intent before changing data."
        : "This server is read-only. Mutating operations are blocked by policy.",
      request: async (options) => {
        assertAllowedOperation(spec, options.method, options.path, allowMutations);
        const baseUrl = resolveApiBaseUrl(spec, env.OPENAPI_SCHEMA_URL, env.OPENAPI_BASE_URL, options);
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
  },
} satisfies ExportedHandler<Env>;
