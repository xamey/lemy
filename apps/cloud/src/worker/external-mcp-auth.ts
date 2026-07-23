import {
  auth,
  extractWWWAuthenticateParams,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

import type { Env } from "./env";
import { assertLimitedBody, limitResponse } from "./request-body";
import {
  decryptExternalMcpCredential,
  getExternalMcp,
  saveExternalMcpCredential,
  validateExternalMcpUrl,
  type ExternalMcpCredential,
  type PublicExternalMcp,
  type StoredExternalMcp,
} from "./external-mcps";

interface OAuthCredential extends ExternalMcpCredential {
  type: "oauth";
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  codeVerifier?: string;
  state?: string;
  discoveryState?: OAuthDiscoveryState;
}

function callbackUrl(env: Env): string {
  return new URL("/api/external-mcp/oauth/callback", env.PUBLIC_APP_URL).toString();
}

export function externalMcpOAuthClientMetadata(env: Env): OAuthClientMetadata {
  return {
    redirect_uris: [callbackUrl(env)],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    client_name: "Lemy Cloud",
  };
}

function clientMetadataUrl(env: Env): string | undefined {
  const url = new URL("/api/external-mcp/oauth/client-metadata", env.PUBLIC_APP_URL);
  return url.protocol === "https:" ? url.toString() : undefined;
}

function randomValue(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function guardedFetch(env: Env, fetchFn: typeof fetch): typeof fetch {
  return async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    validateExternalMcpUrl(url, env.LOCAL_DEV_MODE === "true");
    const timeout = AbortSignal.timeout(30_000);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    const response = await fetchFn(input, { ...init, redirect: "manual", signal });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new Error("Remote redirects are not allowed");
    }
    return response;
  };
}

class StoredOAuthProvider implements OAuthClientProvider {
  authorizationUrl?: URL;
  clientMetadataUrl?: string;

  constructor(
    private readonly env: Env,
    private readonly mcp: StoredExternalMcp,
    private readonly credential: OAuthCredential,
  ) {
    this.clientMetadataUrl = clientMetadataUrl(env);
  }

  get redirectUrl() {
    return callbackUrl(this.env);
  }

  get clientMetadata() {
    return externalMcpOAuthClientMetadata(this.env);
  }

  state() {
    if (!this.credential.state) throw new Error("OAuth state is missing");
    return this.credential.state;
  }

  clientInformation() {
    return this.credential.clientInformation;
  }

  saveClientInformation(value: OAuthClientInformationMixed) {
    this.credential.clientInformation = value;
  }

  tokens() {
    return this.credential.tokens;
  }

  saveTokens(value: OAuthTokens) {
    this.credential.tokens = value;
  }

  redirectToAuthorization(url: URL) {
    this.authorizationUrl = url;
  }

  saveCodeVerifier(value: string) {
    this.credential.codeVerifier = value;
  }

  codeVerifier() {
    if (!this.credential.codeVerifier) throw new Error("OAuth code verifier is missing");
    return this.credential.codeVerifier;
  }

  saveDiscoveryState(value: OAuthDiscoveryState) {
    this.credential.discoveryState = value;
  }

  discoveryState() {
    return this.credential.discoveryState;
  }

  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery") {
    if (scope === "all" || scope === "client") delete this.credential.clientInformation;
    if (scope === "all" || scope === "tokens") delete this.credential.tokens;
    if (scope === "all" || scope === "verifier") delete this.credential.codeVerifier;
    if (scope === "all" || scope === "discovery") delete this.credential.discoveryState;
  }

  clearPending() {
    delete this.credential.state;
    delete this.credential.codeVerifier;
  }

  async persist(connected: boolean): Promise<PublicExternalMcp> {
    return saveExternalMcpCredential(this.env, this.mcp, this.credential, connected);
  }
}

function oauthCredential(value: ExternalMcpCredential | null): OAuthCredential {
  return value?.type === "oauth" ? (value as OAuthCredential) : { type: "oauth" };
}

async function oauthChallenge(mcp: StoredExternalMcp, fetchFn: typeof fetch) {
  const response = await fetchFn(mcp.url, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "Lemy Cloud", version: "0.1.0" },
      },
    }),
  });
  const challenge = extractWWWAuthenticateParams(response);
  await response.body?.cancel();
  if (response.status !== 401) throw new Error("The MCP server did not request OAuth");
  return challenge;
}

export async function beginExternalMcpOAuth(
  env: Env,
  ownerId: string,
  projectId: string,
  id: string,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  const mcp = await getExternalMcp(env.DB, ownerId, projectId, id);
  if (!mcp || mcp.authType !== "oauth") throw new Error("External MCP not found");
  const stored = oauthCredential(await decryptExternalMcpCredential(env, mcp));
  delete stored.tokens;
  stored.state = `${projectId}.${id}.${randomValue()}`;
  const provider = new StoredOAuthProvider(env, mcp, stored);
  const safeFetch = guardedFetch(env, fetchFn);

  try {
    const challenge = await oauthChallenge(mcp, safeFetch);
    const result = await auth(provider, {
      serverUrl: mcp.url,
      resourceMetadataUrl: challenge.resourceMetadataUrl,
      scope: challenge.scope,
      fetchFn: safeFetch,
    });
    if (result !== "REDIRECT" || !provider.authorizationUrl) {
      throw new Error("OAuth authorization URL was not returned");
    }
    validateExternalMcpUrl(provider.authorizationUrl.toString(), env.LOCAL_DEV_MODE === "true");
    await provider.persist(false);
    return provider.authorizationUrl.toString();
  } catch {
    await provider.persist(false);
    throw new Error("OAuth connection failed");
  }
}

export async function finishExternalMcpOAuth(
  env: Env,
  ownerId: string,
  code: string,
  state: string,
  fetchFn: typeof fetch = fetch,
): Promise<PublicExternalMcp> {
  const [projectId, id, nonce, ...rest] = state.split(".");
  if (rest.length || !projectId || !id || !nonce) throw new Error("OAuth state is invalid");
  const mcp = await getExternalMcp(env.DB, ownerId, projectId, id);
  if (!mcp || mcp.authType !== "oauth") throw new Error("External MCP not found");
  const stored = oauthCredential(await decryptExternalMcpCredential(env, mcp));
  if (stored.state !== state) throw new Error("OAuth state is invalid");
  const provider = new StoredOAuthProvider(env, mcp, stored);

  try {
    const result = await auth(provider, {
      serverUrl: mcp.url,
      authorizationCode: code,
      fetchFn: guardedFetch(env, fetchFn),
    });
    if (result !== "AUTHORIZED" || !provider.tokens()?.access_token) {
      throw new Error("OAuth token was not returned");
    }
    provider.clearPending();
    return await provider.persist(true);
  } catch {
    provider.clearPending();
    await provider.persist(false);
    throw new Error("OAuth connection failed");
  }
}

const REQUEST_HEADERS = [
  "accept",
  "content-type",
  "last-event-id",
  "mcp-protocol-version",
  "mcp-session-id",
];
const RESPONSE_HEADERS = ["cache-control", "content-type", "mcp-session-id", "retry-after"];

interface ForwardableRequest {
  url: string;
  method: string;
  headers: Headers;
  body: ReadableStream<Uint8Array> | null;
  arrayBuffer(): Promise<ArrayBuffer>;
  clone(): ForwardableRequest;
}

function accessToken(credential: ExternalMcpCredential | null): string | undefined {
  if (credential?.type === "bearer") return credential.token;
  if (credential?.type === "oauth") return (credential as OAuthCredential).tokens?.access_token;
  return undefined;
}

async function forward(
  mcp: StoredExternalMcp,
  request: ForwardableRequest,
  token: string,
  fetchFn: typeof fetch,
): Promise<Response> {
  const target = new URL(mcp.url);
  for (const [key, value] of new URL(request.url).searchParams) target.searchParams.append(key, value);
  const headers = new Headers();
  for (const name of REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("authorization", `Bearer ${token}`);
  let body: ArrayBuffer | undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    await assertLimitedBody(request, 256_000);
    body = await request.arrayBuffer();
  }
  return fetchFn(
    new Request(target, {
      method: request.method,
      headers,
      body,
    }),
  );
}

async function safeResponse(response: Response): Promise<Response> {
  const bounded = await limitResponse(response, 256_000);
  const headers = new Headers();
  for (const name of RESPONSE_HEADERS) {
    const value = bounded.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(bounded.body, { status: bounded.status, headers });
}

export async function proxyExternalMcpRequest(
  env: Env,
  mcp: StoredExternalMcp,
  request: Request,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  if (!mcp.connected) return new Response("External MCP is disconnected", { status: 409 });
  const credential = await decryptExternalMcpCredential(env, mcp);
  const token = accessToken(credential);
  if (typeof token !== "string") return new Response("External MCP is disconnected", { status: 409 });
  const safeFetch = guardedFetch(env, fetchFn);
  const retryRequest = credential?.type === "oauth" ? request.clone() : null;
  let response = await forward(mcp, request, token, safeFetch);

  if (response.status === 401 && credential?.type === "oauth") {
    await response.body?.cancel();
    const provider = new StoredOAuthProvider(env, mcp, credential as OAuthCredential);
    try {
      const result = await auth(provider, { serverUrl: mcp.url, fetchFn: safeFetch });
      if (result === "AUTHORIZED" && provider.tokens()?.access_token) {
        await provider.persist(true);
        response = await forward(mcp, retryRequest!, provider.tokens()!.access_token, safeFetch);
      }
    } catch {
      return new Response("External MCP authorization expired", { status: 401 });
    }
  }
  return safeResponse(response);
}
