const MAX_THREADS_PER_PROJECT = 100;
const MAX_THREADS_PER_PRINCIPAL = 25;

interface ProjectThreadRow {
  agent_name: string;
}

export async function registerProjectThread(
  db: D1Database,
  projectId: string,
  principal: string,
  threadId: string,
  agentName: string,
): Promise<void> {
  const now = Date.now();
  const existing = await db.prepare(
    "SELECT agent_name FROM project_thread WHERE project_id = ? AND principal = ? AND thread_id = ?",
  ).bind(projectId, principal, threadId).first<ProjectThreadRow>();
  if (existing) {
    if (existing.agent_name !== agentName) throw new Error("Conversation identity is invalid");
    await db.prepare(
      "UPDATE project_thread SET updated_at = ? WHERE project_id = ? AND principal = ? AND thread_id = ?",
    ).bind(now, projectId, principal, threadId).run();
    return;
  }
  const result = await db.prepare(
    `INSERT INTO project_thread
      (project_id, principal, thread_id, agent_name, created_at, updated_at)
     SELECT ?, ?, ?, ?, ?, ?
     WHERE (SELECT COUNT(*) FROM project_thread WHERE project_id = ?) < ?
       AND (SELECT COUNT(*) FROM project_thread WHERE project_id = ? AND principal = ?) < ?`,
  ).bind(
    projectId,
    principal,
    threadId,
    agentName,
    now,
    now,
    projectId,
    MAX_THREADS_PER_PROJECT,
    projectId,
    principal,
    MAX_THREADS_PER_PRINCIPAL,
  ).run();
  if (!result.meta.changes) throw new Error("Conversation limit reached");
}

export async function listProjectAgentNames(
  db: D1Database,
  projectId: string,
): Promise<string[]> {
  const result = await db.prepare(
    "SELECT agent_name FROM project_thread WHERE project_id = ? ORDER BY created_at",
  ).bind(projectId).all<ProjectThreadRow>();
  return result.results.map((row) => row.agent_name);
}
