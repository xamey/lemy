import {
  normalizeApprovedTools,
  normalizeToolApprovalMode,
  type ToolApprovalMode,
} from "./approval.js";
import { toAuthorizationHeader } from "./auth.js";

export interface RuntimeSession {
  expiresAt: number;
  protocol: "cloudflare-think";
  runtimePath: string;
  threadId: string;
  token: string;
}

export interface RuntimeSessionInput {
  approvedTools?: readonly string[];
  bearerToken: string;
  runtimeUrl: string;
  threadId: string;
  toolApprovalMode?: ToolApprovalMode;
}

function isLocalhost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function createLemyThreadId(): string {
  if (typeof crypto === "undefined" || typeof crypto.randomUUID !== "function") {
    throw new Error("createLemyThreadId requires crypto.randomUUID");
  }
  return crypto.randomUUID();
}

export function parseRuntimeUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("runtimeUrl must be an absolute URL");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalhost(url.hostname))) {
    throw new Error("runtimeUrl must use HTTPS outside local development");
  }
  if (url.search || url.hash) throw new Error("runtimeUrl cannot contain a query or fragment");
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url;
}

export function runtimeAgentPath(runtimeUrl: string, threadId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(threadId)) {
    throw new Error("threadId must be a UUID");
  }
  return `${parseRuntimeUrl(runtimeUrl).pathname}/agent/${threadId}`.replace(/^\/+/, "");
}

export async function createRuntimeSession(
  input: RuntimeSessionInput,
  fetchFn: typeof fetch = fetch,
): Promise<RuntimeSession> {
  const runtimeUrl = parseRuntimeUrl(input.runtimeUrl);
  runtimeAgentPath(input.runtimeUrl, input.threadId);
  const response = await fetchFn(`${runtimeUrl.toString()}/session`, {
    method: "POST",
    headers: {
      Authorization: toAuthorizationHeader(input.bearerToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      approvedTools: normalizeApprovedTools(input.approvedTools),
      threadId: input.threadId,
      toolApprovalMode: normalizeToolApprovalMode(input.toolApprovalMode),
    }),
  });
  const value = await response.json().catch(() => null) as Partial<RuntimeSession> & { error?: unknown } | null;
  if (!response.ok) {
    throw new Error(typeof value?.error === "string" ? value.error : `Lemy session failed (${response.status})`);
  }
  if (
    value?.protocol !== "cloudflare-think"
    || typeof value.token !== "string"
    || typeof value.runtimePath !== "string"
    || value.threadId !== input.threadId
    || typeof value.expiresAt !== "number"
  ) throw new Error("Lemy returned an invalid runtime session");
  return value as RuntimeSession;
}
