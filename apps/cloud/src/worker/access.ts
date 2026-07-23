export type AccessRequestStatus = "pending" | "granted" | "revoked";

export interface AccessRequest {
  id: string;
  email: string;
  status: AccessRequestStatus;
  requestedAt: string;
  updatedAt: string;
}

interface AccessRequestRow {
  id: string;
  email: string;
  status: AccessRequestStatus;
  requested_at: number;
  updated_at: number;
}

function publicAccessRequest(row: AccessRequestRow): AccessRequest {
  return {
    id: row.id,
    email: row.email,
    status: row.status,
    requestedAt: new Date(row.requested_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export function normalizeAccessEmail(value: unknown): string {
  if (typeof value !== "string") throw new Error("A valid email is required");
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("A valid email is required");
  }
  return email;
}

export async function requestCloudAccess(
  db: D1Database,
  value: unknown,
): Promise<void> {
  const email = normalizeAccessEmail(value);
  const now = Date.now();
  await db.prepare(
    `INSERT INTO access_request (id, email, status, requested_at, updated_at)
      VALUES (?, ?, 'pending', ?, ?)
      ON CONFLICT(email) DO UPDATE SET
        status = CASE
          WHEN access_request.status = 'granted' THEN access_request.status
          ELSE 'pending'
        END,
        requested_at = CASE
          WHEN access_request.status = 'granted' THEN access_request.requested_at
          ELSE excluded.requested_at
        END,
        updated_at = excluded.updated_at`,
  ).bind(crypto.randomUUID(), email, now, now).run();
}

export async function hasCloudAccess(db: D1Database, userId: string): Promise<boolean> {
  return Boolean(await db.prepare(
    `SELECT 1 FROM user
      JOIN access_request ON access_request.email = lower(user.email)
      WHERE user.id = ?
        AND user.email_verified = 1
        AND access_request.status = 'granted'`,
  ).bind(userId).first());
}

export async function listAccessRequests(db: D1Database): Promise<AccessRequest[]> {
  const rows = await db.prepare(
    `SELECT id, email, status, requested_at, updated_at
      FROM access_request WHERE status != 'revoked'
      ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, requested_at`,
  ).all<AccessRequestRow>();
  return rows.results.map(publicAccessRequest);
}

export async function setAccessRequestStatus(
  db: D1Database,
  id: string,
  status: Exclude<AccessRequestStatus, "pending">,
): Promise<AccessRequest | null> {
  const result = await db.prepare(
    `UPDATE access_request SET status = ?, updated_at = ? WHERE id = ?
      RETURNING id, email, status, requested_at, updated_at`,
  ).bind(status, Date.now(), id).run();
  const row = result.results[0] as unknown as AccessRequestRow | undefined;
  return row ? publicAccessRequest(row) : null;
}

export async function grantCloudAccessByEmail(
  db: D1Database,
  email: string,
): Promise<void> {
  const now = Date.now();
  await db.prepare(
    `INSERT INTO access_request (id, email, status, requested_at, updated_at)
      VALUES (?, ?, 'granted', ?, ?)
      ON CONFLICT(email) DO UPDATE SET status = 'granted', updated_at = excluded.updated_at`,
  ).bind(crypto.randomUUID(), normalizeAccessEmail(email), now, now).run();
}
