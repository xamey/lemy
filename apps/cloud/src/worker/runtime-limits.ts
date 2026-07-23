const MAX_PROJECT_SESSIONS = 10;
const MAX_PRINCIPAL_SESSIONS = 3;

export async function reserveRuntimeSession(
  db: D1Database,
  projectId: string,
  principal: string,
  expiresAt: number,
): Promise<void> {
  const now = Date.now();
  await db.prepare("DELETE FROM runtime_session_lease WHERE expires_at <= ?").bind(now).run();
  const result = await db.prepare(
    `INSERT INTO runtime_session_lease (id, project_id, principal, expires_at)
      SELECT ?, ?, ?, ?
      WHERE (SELECT COUNT(*) FROM runtime_session_lease
        WHERE project_id = ? AND expires_at > ?) < ?
      AND (SELECT COUNT(*) FROM runtime_session_lease
        WHERE project_id = ? AND principal = ? AND expires_at > ?) < ?`,
  ).bind(
    crypto.randomUUID(),
    projectId,
    principal,
    expiresAt,
    projectId,
    now,
    MAX_PROJECT_SESSIONS,
    projectId,
    principal,
    now,
    MAX_PRINCIPAL_SESSIONS,
  ).run();
  if (!result.meta.changes) throw new Error("Concurrent runtime session limit reached");
}
