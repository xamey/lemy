import type { AuthSession } from "./auth";

const TOKEN_PREFIX = "lemy_agent_";

interface AgentTokenRow {
  id: string;
  permission: AgentTokenPermission;
  project_id: string;
  user_id: string;
  name: string;
  created_at: number;
  last_used_at: number | null;
}

interface AgentSessionRow {
  permission: AgentTokenPermission;
  project_id: string;
  token_id: string;
  user_id: string;
  name: string;
  email: string;
  email_verified: number;
  image: string | null;
  created_at: number;
  updated_at: number;
}

export type AgentTokenPermission = "read" | "write";

export interface AgentTokenAccess {
  permission: AgentTokenPermission;
  projectId: string;
}

type AgentAuthSession = NonNullable<AuthSession> & {
  agentAccess: AgentTokenAccess;
};

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function publicToken(row: AgentTokenRow) {
  return {
    id: row.id,
    name: row.name,
    permission: row.permission,
    projectId: row.project_id,
    createdAt: new Date(row.created_at).toISOString(),
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : null,
  };
}

export async function createAgentAccessToken(
  db: D1Database,
  userId: string,
  projectId: string,
  value: unknown,
) {
  const candidate = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
  if (!name || name.length > 80) throw new Error("Token name must contain 1 to 80 characters");
  const permission = candidate.permission;
  if (permission !== "read" && permission !== "write") {
    throw new Error("Permission must be read or write");
  }
  if (!await db.prepare(
    "SELECT 1 FROM project WHERE id = ? AND owner_id = ? AND status != 'deleting'",
  ).bind(projectId, userId).first()) throw new Error("Project not found");

  const id = crypto.randomUUID();
  const secret = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const token = `${TOKEN_PREFIX}${secret}`;
  const createdAt = Date.now();
  await db.prepare(
    `INSERT INTO agent_access_token
      (id, user_id, project_id, name, permission, token_hash, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ?
      WHERE (SELECT COUNT(*) FROM agent_access_token WHERE project_id = ?) < 10`,
  ).bind(
    id,
    userId,
    projectId,
    name,
    permission,
    await hashToken(token),
    createdAt,
    projectId,
  ).run().then((result) => {
    if (!result.meta.changes) throw new Error("Project agent token limit reached (10)");
  });
  return {
    id,
    name,
    permission,
    projectId,
    token,
    createdAt: new Date(createdAt).toISOString(),
    lastUsedAt: null,
  };
}

export async function listAgentAccessTokens(db: D1Database, userId: string, projectId: string) {
  const result = await db.prepare(
    `SELECT id, user_id, project_id, name, permission, created_at, last_used_at
      FROM agent_access_token
      WHERE user_id = ? AND project_id = ?
      ORDER BY created_at DESC`,
  ).bind(userId, projectId).all<AgentTokenRow>();
  return result.results.map(publicToken);
}

export async function revokeAgentAccessToken(
  db: D1Database,
  userId: string,
  projectId: string,
  id: string,
): Promise<boolean> {
  const result = await db.prepare(
    "DELETE FROM agent_access_token WHERE id = ? AND user_id = ? AND project_id = ?",
  ).bind(id, userId, projectId).run();
  return Boolean(result.meta.changes);
}

export function agentAccess(session: AuthSession): AgentTokenAccess | null {
  const access = (session as (NonNullable<AuthSession> & {
    agentAccess?: AgentTokenAccess;
  }) | null)?.agentAccess;
  return access
      && (access.permission === "read" || access.permission === "write")
      && typeof access.projectId === "string"
    ? access
    : null;
}

export async function getAgentAccessTokenSession(
  db: D1Database,
  authorization: string | null,
): Promise<AgentAuthSession | null> {
  const match = authorization?.match(/^Bearer\s+(lemy_agent_[A-Za-z0-9_-]{43})$/i);
  if (!match) return null;
  const row = await db.prepare(
    `SELECT agent_access_token.id AS token_id, agent_access_token.project_id,
      agent_access_token.permission, user.id AS user_id, user.name, user.email,
      user.email_verified, user.image, user.created_at, user.updated_at
      FROM agent_access_token JOIN user ON user.id = agent_access_token.user_id
      WHERE agent_access_token.token_hash = ?`,
  ).bind(await hashToken(match[1])).first<AgentSessionRow>();
  if (!row) return null;
  const usedAt = Date.now();
  await db.prepare(
    "UPDATE agent_access_token SET last_used_at = ? WHERE id = ? AND (last_used_at IS NULL OR last_used_at < ?)",
  ).bind(usedAt, row.token_id, usedAt - 300_000).run();
  const now = new Date();
  return {
    agentAccess: {
      permission: row.permission,
      projectId: row.project_id,
    },
    user: {
      id: row.user_id,
      name: row.name,
      email: row.email,
      emailVerified: Boolean(row.email_verified),
      image: row.image,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    },
    session: {
      id: `agent:${row.token_id}`,
      userId: row.user_id,
      token: row.token_id,
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
      updatedAt: now,
      ipAddress: null,
      userAgent: "Lemy agent token",
    },
  };
}
