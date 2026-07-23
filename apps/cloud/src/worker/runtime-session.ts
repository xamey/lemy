import { decryptSecret, encryptSecret } from "./secrets";

export type ToolApprovalMode = "auto" | "ask";

export interface RuntimeSessionClaims {
  approvedTools: string[];
  authorization: string;
  expiresAt: number;
  principal: string;
  projectId: string;
  threadId: string;
  toolApprovalMode: ToolApprovalMode;
}

export interface RuntimeSession extends RuntimeSessionClaims {
  agentName: string;
  token: string;
}

const MAX_SESSION_SECONDS = 5 * 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRINCIPAL = /^[0-9a-f]{64}$/;
const TOOL_NAME = /^[A-Za-z0-9_.:-]{1,128}$/;

function base64Url(value: string): string {
  return value.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64(value: string): string {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  return normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
}

function scope(projectId: string, threadId: string): string {
  return `runtime-session:${projectId}:${threadId}`;
}

function validateClaims(
  claims: RuntimeSessionClaims,
  nowSeconds: number,
  requireFutureExpiry: boolean,
): void {
  if (!UUID.test(claims.projectId) || !UUID.test(claims.threadId)) {
    throw new Error("Runtime session is invalid");
  }
  if (!PRINCIPAL.test(claims.principal)) throw new Error("Runtime session is invalid");
  if (!/^Bearer\s+\S+$/i.test(claims.authorization) || claims.authorization.length > 8_200) {
    throw new Error("Runtime session is invalid");
  }
  if (
    !Number.isSafeInteger(claims.expiresAt)
    || claims.expiresAt > nowSeconds + MAX_SESSION_SECONDS
  ) throw new Error("Runtime session expiry is invalid");
  if (requireFutureExpiry && claims.expiresAt <= nowSeconds) {
    throw new Error("Runtime session expired");
  }
  if (claims.toolApprovalMode !== "auto" && claims.toolApprovalMode !== "ask") {
    throw new Error("Runtime session is invalid");
  }
  if (
    !Array.isArray(claims.approvedTools)
    || claims.approvedTools.length > 128
    || claims.approvedTools.some((name) => !TOOL_NAME.test(name))
  ) throw new Error("Runtime session is invalid");
}

export async function runtimeAgentName(
  projectId: string,
  principal: string,
  threadId: string,
): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${projectId}\0${principal}\0${threadId}`),
  ));
  const hash = base64Url(btoa(String.fromCharCode(...digest))).slice(0, 22);
  return `${projectId}--${hash}--${threadId}`;
}

export async function createRuntimeSession(
  claims: RuntimeSessionClaims,
  key: string,
  nowSeconds: number = Math.floor(Date.now() / 1_000),
): Promise<RuntimeSession> {
  const normalized = {
    ...claims,
    approvedTools: [...new Set(claims.approvedTools)].sort(),
  };
  validateClaims(normalized, nowSeconds, false);
  if (normalized.expiresAt <= nowSeconds) throw new Error("Runtime session expiry is invalid");
  const encrypted = await encryptSecret(
    JSON.stringify(normalized),
    key,
    scope(normalized.projectId, normalized.threadId),
  );
  return {
    ...normalized,
    agentName: await runtimeAgentName(
      normalized.projectId,
      normalized.principal,
      normalized.threadId,
    ),
    token: `v1.${base64Url(encrypted.iv)}.${base64Url(encrypted.ciphertext)}`,
  };
}

export async function openRuntimeSession(
  token: string,
  key: string,
  projectId: string,
  threadId: string,
  nowSeconds: number = Math.floor(Date.now() / 1_000),
): Promise<RuntimeSessionClaims> {
  const [version, iv, ciphertext, ...rest] = token.split(".");
  if (
    rest.length
    || version !== "v1"
    || !/^[A-Za-z0-9_-]{16}$/.test(iv ?? "")
    || !/^[A-Za-z0-9_-]{32,16384}$/.test(ciphertext ?? "")
  ) throw new Error("Runtime session is invalid");
  try {
    const claims = JSON.parse(await decryptSecret(
      { iv: base64(iv!), ciphertext: base64(ciphertext!) },
      key,
      scope(projectId, threadId),
    )) as RuntimeSessionClaims;
    validateClaims(claims, nowSeconds, true);
    if (claims.projectId !== projectId || claims.threadId !== threadId) {
      throw new Error("Runtime session is invalid");
    }
    return claims;
  } catch (error) {
    if (error instanceof Error && error.message === "Runtime session expired") throw error;
    throw new Error("Runtime session is invalid");
  }
}
