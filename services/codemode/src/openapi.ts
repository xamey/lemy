import type { RequestOptions } from "@cloudflare/codemode/mcp";

type OpenApiDocument = Record<string, unknown>;

const READ_METHODS = new Set(["GET"]);
const HTTP_METHODS = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);

interface IndexedOperation {
  pattern: RegExp;
  templated: boolean;
  pathItem: Record<string, unknown>;
  operation: Record<string, unknown>;
}

const operationIndexCache = new WeakMap<OpenApiDocument, Map<string, IndexedOperation[]>>();

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pathPattern(template: string): RegExp {
  let source = "^";
  let cursor = 0;

  for (const match of template.matchAll(/\{[^/{}]+\}/g)) {
    const index = match.index ?? cursor;
    source += escapeRegex(template.slice(cursor, index));
    source += "[^/]+";
    cursor = index + match[0].length;
  }

  source += `${escapeRegex(template.slice(cursor))}$`;
  return new RegExp(source);
}

function assertSafePath(path: string): void {
  if (!path.startsWith("/") || path.startsWith("//") || /[?#\\]/.test(path)) {
    throw new Error("Invalid API path");
  }

  let segments: string[];
  try {
    segments = path.split("/").map((segment) => decodeURIComponent(segment));
  } catch (error) {
    throw new Error("Invalid API path", { cause: error });
  }

  if (
    segments.some(
      (segment) => segment === "." || segment === ".." || /[/\\]/.test(segment),
    )
  ) {
    throw new Error("Invalid API path");
  }
}

function expandServerUrl(server: Record<string, unknown>): string | undefined {
  const rawUrl = server.url;
  if (typeof rawUrl !== "string" || rawUrl.length === 0) return undefined;

  const variables = asRecord(server.variables) ?? {};
  return rawUrl.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const variable = asRecord(variables[name]);
    const defaultValue = variable?.default;
    if (typeof defaultValue !== "string" && typeof defaultValue !== "number") {
      throw new Error(`OpenAPI server variable ${name} has no default`);
    }
    return encodeURIComponent(String(defaultValue));
  });
}

function normalizeBaseUrl(rawUrl: string, schemaUrl: string): string {
  const url = new URL(rawUrl, schemaUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("OpenAPI API server must use HTTP or HTTPS");
  }

  url.search = "";
  url.hash = "";
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.toString();
}

function resolveServerUrl(
  container: Record<string, unknown> | undefined,
  schemaUrl: string,
): string | undefined {
  const servers = Array.isArray(container?.servers) ? container.servers : [];
  for (const candidate of servers) {
    const server = asRecord(candidate);
    if (!server) continue;
    const expanded = expandServerUrl(server);
    if (expanded) return normalizeBaseUrl(expanded, schemaUrl);
  }
  return undefined;
}

function resolveLocalPointer(spec: OpenApiDocument, reference: string): unknown {
  if (!reference.startsWith("#/")) {
    throw new Error(`Invalid local Path Item $ref: ${reference}`);
  }

  let pointer: string;
  try {
    pointer = decodeURIComponent(reference.slice(1));
  } catch (error) {
    throw new Error(`Invalid local Path Item $ref: ${reference}`, { cause: error });
  }

  let value: unknown = spec;
  for (const rawToken of pointer.slice(1).split("/")) {
    if (/~(?:[^01]|$)/.test(rawToken)) {
      throw new Error(`Invalid local Path Item $ref: ${reference}`);
    }
    const token = rawToken.replace(/~1/g, "/").replace(/~0/g, "~");
    const record = asRecord(value);
    if (!record || !Object.hasOwn(record, token)) {
      throw new Error(`Invalid local Path Item $ref: ${reference}`);
    }
    value = record[token];
  }
  return value;
}

function resolvePathItem(
  spec: OpenApiDocument,
  value: unknown,
): Record<string, unknown> | undefined {
  let pathItem = asRecord(value);
  const seen = new Set<Record<string, unknown>>();

  while (pathItem && Object.hasOwn(pathItem, "$ref")) {
    if (seen.has(pathItem)) throw new Error("OpenAPI Path Item $ref is cyclic");
    seen.add(pathItem);

    const reference = pathItem.$ref;
    if (typeof reference !== "string") throw new Error("Invalid local Path Item $ref");
    pathItem = asRecord(resolveLocalPointer(spec, reference));
    if (!pathItem) throw new Error(`Invalid local Path Item $ref: ${reference}`);
  }

  return pathItem;
}

export function resolveApiBaseUrl(
  spec: OpenApiDocument,
  schemaUrl: string,
  override?: string,
  request?: Pick<RequestOptions, "method" | "path">,
): string {
  if (override?.trim()) return normalizeBaseUrl(override.trim(), schemaUrl);

  const matched = request ? findOperation(spec, request.method, request.path) : undefined;
  for (const container of [matched?.operation, matched?.pathItem, spec]) {
    const resolved = resolveServerUrl(container, schemaUrl);
    if (resolved) return resolved;
  }

  const schema = new URL(schemaUrl);
  return normalizeBaseUrl(schema.origin, schemaUrl);
}

function operationIndex(spec: OpenApiDocument): Map<string, IndexedOperation[]> {
  const cached = operationIndexCache.get(spec);
  if (cached) return cached;

  const index = new Map<string, IndexedOperation[]>();
  for (const [template, value] of Object.entries(asRecord(spec.paths) ?? {})) {
    const pathItem = resolvePathItem(spec, value);
    if (!pathItem) continue;

    for (const method of HTTP_METHODS) {
      const operation = asRecord(pathItem[method]);
      if (!operation) continue;
      const normalizedMethod = method.toUpperCase();
      const entry = {
        pattern: pathPattern(template),
        templated: /\{[^/{}]+\}/.test(template),
        pathItem,
        operation,
      };
      const operations = index.get(normalizedMethod) ?? [];
      operations.push(entry);
      index.set(normalizedMethod, operations);
    }
  }
  for (const operations of index.values()) {
    operations.sort((left, right) => Number(left.templated) - Number(right.templated));
  }
  operationIndexCache.set(spec, index);
  return index;
}

function findOperation(
  spec: OpenApiDocument,
  method: RequestOptions["method"],
  path: string,
): IndexedOperation | undefined {
  assertSafePath(path);
  return operationIndex(spec)
    .get(method.toUpperCase())
    ?.find(({ pattern }) => pattern.test(path));
}

export function assertAllowedOperation(
  spec: OpenApiDocument,
  method: RequestOptions["method"],
  path: string,
  allowMutations: boolean,
): void {
  assertSafePath(path);

  const normalizedMethod = method.toUpperCase();
  const declared = findOperation(spec, method, path);

  if (!declared) {
    throw new Error(`${normalizedMethod} ${path} is not declared in the OpenAPI schema`);
  }
  if (!READ_METHODS.has(normalizedMethod) && !allowMutations) {
    throw new Error("Mutating API operations are disabled");
  }
}

export function buildApiUrl(
  baseUrl: string,
  path: string,
  query: RequestOptions["query"] = {},
): URL {
  assertSafePath(path);
  const base = new URL(baseUrl);
  const url = new URL(`.${path}`, base);
  if (url.origin !== base.origin) throw new Error("Invalid API path origin");

  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  return url;
}
