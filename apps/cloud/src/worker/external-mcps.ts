import type { Env } from "./env";
import { publicHttpsUrl } from "./outbound-url";
import { getProject } from "./projects";
import { decryptSecret, encryptSecret, type EncryptedSecret } from "./secrets";

export type ExternalMcpAuthType = "oauth" | "bearer";

export interface ExternalMcpInput {
  name: string;
  url: string;
  authType: ExternalMcpAuthType;
}

export interface ExternalMcpCredential {
  type: ExternalMcpAuthType;
  token?: string;
  [key: string]: unknown;
}

export interface StoredExternalMcp {
  id: string;
  projectId: string;
  ownerId: string;
  name: string;
  url: string;
  authType: ExternalMcpAuthType;
  connected: boolean;
  credential: EncryptedSecret | null;
  createdAt: string;
  updatedAt: string;
}

export type PublicExternalMcp = Omit<StoredExternalMcp, "ownerId" | "credential">;

interface ExternalMcpRow {
  id: string;
  project_id: string;
  owner_id: string;
  name: string;
  url: string;
  auth_type: ExternalMcpAuthType;
  connected: number;
  credential_ciphertext: string | null;
  credential_iv: string | null;
  created_at: number;
  updated_at: number;
}

const COLUMNS = `external_mcp.id, external_mcp.project_id, project.owner_id,
  external_mcp.name, external_mcp.url, external_mcp.auth_type, external_mcp.connected,
  external_mcp.credential_ciphertext, external_mcp.credential_iv,
  external_mcp.created_at, external_mcp.updated_at`;

function fromRow(row: ExternalMcpRow): StoredExternalMcp {
  return {
    id: row.id,
    projectId: row.project_id,
    ownerId: row.owner_id,
    name: row.name,
    url: row.url,
    authType: row.auth_type,
    connected: Boolean(row.connected),
    credential:
      row.credential_ciphertext && row.credential_iv
        ? { ciphertext: row.credential_ciphertext, iv: row.credential_iv }
        : null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function publicMcp(mcp: StoredExternalMcp): PublicExternalMcp {
  const { ownerId: _ownerId, credential: _credential, ...safe } = mcp;
  return safe;
}

export function validateExternalMcpUrl(value: string, allowLocal = false): URL {
  try {
    return publicHttpsUrl(value, allowLocal);
  } catch {
    throw new Error("MCP URL must be a public HTTPS URL");
  }
}

export function parseExternalMcpInput(value: unknown, allowLocal = false): ExternalMcpInput {
  if (!value || typeof value !== "object") throw new Error("External MCP is required");
  const candidate = value as Record<string, unknown>;
  const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
  const rawUrl = typeof candidate.url === "string" ? candidate.url.trim() : "";
  if (!name || name.length > 80) throw new Error("MCP name must be between 1 and 80 characters");
  if (candidate.authType !== "oauth" && candidate.authType !== "bearer") {
    throw new Error("MCP authentication must be oauth or bearer");
  }
  return {
    name,
    url: validateExternalMcpUrl(rawUrl, allowLocal).toString(),
    authType: candidate.authType,
  };
}

export async function createExternalMcp(
  env: Env,
  ownerId: string,
  projectId: string,
  value: unknown,
): Promise<PublicExternalMcp> {
  if (!(await getProject(env.DB, ownerId, projectId))) throw new Error("Project not found");
  const input = parseExternalMcpInput(value, env.LOCAL_DEV_MODE === "true");
  const id = crypto.randomUUID();
  const now = Date.now();
  const result = await env.DB.prepare(
    `INSERT INTO external_mcp
      (id, project_id, name, url, auth_type, connected, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, 0, ?, ?
      WHERE (SELECT COUNT(*) FROM external_mcp WHERE project_id = ?) < 16`,
  ).bind(id, projectId, input.name, input.url, input.authType, now, now, projectId).run();
  if (!result.meta.changes) throw new Error("External MCP limit reached");
  return publicMcp((await getExternalMcp(env.DB, ownerId, projectId, id))!);
}

export async function listExternalMcps(
  db: D1Database,
  ownerId: string,
  projectId: string,
): Promise<PublicExternalMcp[]> {
  const result = await db.prepare(
    `SELECT ${COLUMNS} FROM external_mcp
      JOIN project ON project.id = external_mcp.project_id
      WHERE external_mcp.project_id = ? AND project.owner_id = ?
      ORDER BY external_mcp.created_at`,
  ).bind(projectId, ownerId).all<ExternalMcpRow>();
  return result.results.map(fromRow).map(publicMcp);
}

export async function listConnectedExternalMcps(
  db: D1Database,
  projectId: string,
): Promise<PublicExternalMcp[]> {
  const result = await db.prepare(
    `SELECT ${COLUMNS} FROM external_mcp
      JOIN project ON project.id = external_mcp.project_id
      WHERE external_mcp.project_id = ? AND external_mcp.connected = 1
      ORDER BY external_mcp.created_at`,
  ).bind(projectId).all<ExternalMcpRow>();
  return result.results.map(fromRow).map(publicMcp);
}

export async function getExternalMcp(
  db: D1Database,
  ownerId: string,
  projectId: string,
  id: string,
): Promise<StoredExternalMcp | null> {
  const row = await db.prepare(
    `SELECT ${COLUMNS} FROM external_mcp
      JOIN project ON project.id = external_mcp.project_id
      WHERE external_mcp.id = ? AND external_mcp.project_id = ? AND project.owner_id = ?`,
  ).bind(id, projectId, ownerId).first<ExternalMcpRow>();
  return row ? fromRow(row) : null;
}

export async function getExternalMcpForProxy(
  db: D1Database,
  projectId: string,
  id: string,
): Promise<StoredExternalMcp | null> {
  const row = await db.prepare(
    `SELECT ${COLUMNS} FROM external_mcp
      JOIN project ON project.id = external_mcp.project_id
      WHERE external_mcp.id = ? AND external_mcp.project_id = ?`,
  ).bind(id, projectId).first<ExternalMcpRow>();
  return row ? fromRow(row) : null;
}

function credentialScope(mcp: StoredExternalMcp): string {
  return `${mcp.ownerId}:${mcp.projectId}:${mcp.id}`;
}

export async function decryptExternalMcpCredential(
  env: Env,
  mcp: StoredExternalMcp,
): Promise<ExternalMcpCredential | null> {
  if (!mcp.credential) return null;
  return JSON.parse(
    await decryptSecret(mcp.credential, env.PROJECT_SECRETS_KEY, credentialScope(mcp)),
  ) as ExternalMcpCredential;
}

export async function saveExternalMcpCredential(
  env: Env,
  mcp: StoredExternalMcp,
  credential: ExternalMcpCredential,
  connected: boolean,
): Promise<PublicExternalMcp> {
  const encrypted = await encryptSecret(
    JSON.stringify(credential),
    env.PROJECT_SECRETS_KEY,
    credentialScope(mcp),
  );
  await env.DB.prepare(
    `UPDATE external_mcp SET connected = ?, credential_ciphertext = ?, credential_iv = ?, updated_at = ?
      WHERE id = ? AND project_id = ?`,
  ).bind(
    Number(connected),
    encrypted.ciphertext,
    encrypted.iv,
    Date.now(),
    mcp.id,
    mcp.projectId,
  ).run();
  return publicMcp((await getExternalMcp(env.DB, mcp.ownerId, mcp.projectId, mcp.id))!);
}

export async function connectExternalMcpWithBearer(
  env: Env,
  ownerId: string,
  projectId: string,
  id: string,
  value: string,
): Promise<PublicExternalMcp | null> {
  const mcp = await getExternalMcp(env.DB, ownerId, projectId, id);
  if (!mcp || mcp.authType !== "bearer") return null;
  const token = value.trim().replace(/^Bearer\s+/i, "");
  if (!token || token.length > 8_192 || /\s/.test(token)) throw new Error("Bearer is invalid");
  return saveExternalMcpCredential(env, mcp, { type: "bearer", token }, true);
}

export async function disconnectExternalMcp(
  db: D1Database,
  ownerId: string,
  projectId: string,
  id: string,
): Promise<PublicExternalMcp | null> {
  await db.prepare(
    `UPDATE external_mcp SET connected = 0, credential_ciphertext = NULL,
      credential_iv = NULL, updated_at = ?
      WHERE id = ? AND project_id = ? AND EXISTS (
        SELECT 1 FROM project WHERE project.id = external_mcp.project_id AND project.owner_id = ?
      )`,
  ).bind(Date.now(), id, projectId, ownerId).run();
  const mcp = await getExternalMcp(db, ownerId, projectId, id);
  return mcp ? publicMcp(mcp) : null;
}

export async function deleteExternalMcp(
  db: D1Database,
  ownerId: string,
  projectId: string,
  id: string,
): Promise<boolean> {
  const result = await db.prepare(
    `DELETE FROM external_mcp WHERE id = ? AND project_id = ? AND EXISTS (
      SELECT 1 FROM project WHERE project.id = external_mcp.project_id AND project.owner_id = ?
    )`,
  ).bind(id, projectId, ownerId).run();
  return Boolean(result.meta.changes);
}

export function externalMcpConnectionName(mcp: Pick<PublicExternalMcp, "id" | "name">): string {
  const slug = mcp.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "mcp";
  return `${slug.slice(0, 40)}_${mcp.id.replaceAll("-", "").slice(0, 8)}`;
}
