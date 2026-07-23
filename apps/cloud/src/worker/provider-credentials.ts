import type { Env } from "./env";
import type { LlmProvider } from "./model-catalog";
import { decryptSecret, encryptSecret } from "./secrets";

export type ProviderValidationStatus = "not_configured" | "validated" | "invalid";

export interface ProviderConfiguration {
  provider: LlmProvider;
  configured: boolean;
  status: ProviderValidationStatus;
  validatedAt: string | null;
}

interface ProviderCredentialRow {
  provider: LlmProvider;
  api_key_ciphertext: string;
  api_key_iv: string;
  validation_status: Exclude<ProviderValidationStatus, "not_configured">;
  validated_at: number | null;
}

type ProviderFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const PROVIDERS: LlmProvider[] = ["openai", "anthropic"];

export class ProviderValidationError extends Error {
  constructor(
    readonly kind: "rejected" | "unavailable",
    provider: LlmProvider,
  ) {
    super(kind === "rejected"
      ? `${provider === "openai" ? "OpenAI" : "Anthropic"} rejected this API key`
      : `${provider === "openai" ? "OpenAI" : "Anthropic"} validation is unavailable`);
  }
}

function credentialScope(ownerId: string, provider: LlmProvider): string {
  return `provider:${ownerId}:${provider}`;
}

function providerRequest(provider: LlmProvider, apiKey: string): [string, RequestInit] {
  return provider === "openai"
    ? ["https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
      }]
    : ["https://api.anthropic.com/v1/models", {
        headers: {
          "anthropic-version": "2023-06-01",
          "x-api-key": apiKey,
        },
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
      }];
}

export async function validateProviderApiKey(
  provider: LlmProvider,
  apiKey: string,
  providerFetch: ProviderFetch = fetch,
): Promise<void> {
  let response: Response;
  try {
    response = await providerFetch(...providerRequest(provider, apiKey));
  } catch {
    throw new ProviderValidationError("unavailable", provider);
  }
  if (response.ok) return;
  throw new ProviderValidationError(
    response.status === 401 || response.status === 403 ? "rejected" : "unavailable",
    provider,
  );
}

export async function listProviderConfigurations(
  db: D1Database,
  ownerId: string,
): Promise<ProviderConfiguration[]> {
  const rows = await db.prepare(
    `SELECT provider, api_key_ciphertext, api_key_iv, validation_status, validated_at
      FROM provider_credential WHERE owner_id = ?`,
  ).bind(ownerId).all<ProviderCredentialRow>();
  const byProvider = new Map(rows.results.map((row) => [row.provider, row]));
  return PROVIDERS.map((provider) => {
    const row = byProvider.get(provider);
    return row
      ? {
          provider,
          configured: true,
          status: row.validation_status,
          validatedAt: row.validated_at ? new Date(row.validated_at).toISOString() : null,
        }
      : { provider, configured: false, status: "not_configured", validatedAt: null };
  });
}

async function credentialRow(
  db: D1Database,
  ownerId: string,
  provider: LlmProvider,
): Promise<ProviderCredentialRow | null> {
  return db.prepare(
    `SELECT provider, api_key_ciphertext, api_key_iv, validation_status, validated_at
      FROM provider_credential WHERE owner_id = ? AND provider = ?`,
  ).bind(ownerId, provider).first<ProviderCredentialRow>();
}

export async function getConfiguredProviderCredential(
  env: Env,
  ownerId: string,
  provider: LlmProvider,
): Promise<{ apiKey: string; version: string } | null> {
  const row = await credentialRow(env.DB, ownerId, provider);
  if (!row) return null;
  return {
    apiKey: await decryptSecret(
    { ciphertext: row.api_key_ciphertext, iv: row.api_key_iv },
    env.PROJECT_SECRETS_KEY,
    credentialScope(ownerId, provider),
    ),
    version: row.api_key_ciphertext,
  };
}

export async function getProviderApiKey(
  env: Env,
  ownerId: string,
  provider: LlmProvider,
): Promise<string | null> {
  const row = await credentialRow(env.DB, ownerId, provider);
  if (!row || row.validation_status !== "validated") return null;
  return decryptSecret(
    { ciphertext: row.api_key_ciphertext, iv: row.api_key_iv },
    env.PROJECT_SECRETS_KEY,
    credentialScope(ownerId, provider),
  );
}

export async function hasValidatedProvider(
  db: D1Database,
  ownerId: string,
  provider: LlmProvider,
): Promise<boolean> {
  return Boolean(await db.prepare(
    `SELECT 1 FROM provider_credential
      WHERE owner_id = ? AND provider = ? AND validation_status = 'validated'`,
  ).bind(ownerId, provider).first());
}

export async function saveValidatedProviderCredential(
  env: Env,
  ownerId: string,
  provider: LlmProvider,
  apiKey: string,
): Promise<void> {
  const encrypted = await encryptSecret(
    apiKey,
    env.PROJECT_SECRETS_KEY,
    credentialScope(ownerId, provider),
  );
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO provider_credential (
      owner_id, provider, api_key_ciphertext, api_key_iv, validation_status,
      validated_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'validated', ?, ?, ?)
    ON CONFLICT(owner_id, provider) DO UPDATE SET
      api_key_ciphertext = excluded.api_key_ciphertext,
      api_key_iv = excluded.api_key_iv,
      validation_status = 'validated',
      validated_at = excluded.validated_at,
      updated_at = excluded.updated_at`,
  ).bind(ownerId, provider, encrypted.ciphertext, encrypted.iv, now, now, now).run();
}

export async function setProviderValidationStatus(
  db: D1Database,
  ownerId: string,
  provider: LlmProvider,
  status: "validated" | "invalid",
  version: string,
): Promise<boolean> {
  const now = Date.now();
  const result = await db.prepare(
    `UPDATE provider_credential SET validation_status = ?,
      validated_at = CASE WHEN ? = 'validated' THEN ? ELSE validated_at END,
      updated_at = ? WHERE owner_id = ? AND provider = ? AND api_key_ciphertext = ?`,
  ).bind(status, status, now, now, ownerId, provider, version).run();
  return Boolean(result.meta.changes);
}
