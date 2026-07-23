export type ProjectRunSource = "runtime" | "playground";
export type ProjectRunStatus = "completed" | "error" | "aborted";

export interface ProjectRunInput {
  id: string;
  projectId: string;
  threadId: string;
  source: ProjectRunSource;
  status: ProjectRunStatus;
  model: string;
  inputTokens: number;
  outputTokens: number;
  toolCalls: number;
  error: string | null;
  startedAt: number;
  completedAt: number;
}

interface ProjectRunRow {
  id: string;
  project_id: string;
  thread_id: string;
  source: ProjectRunSource;
  status: ProjectRunStatus;
  model: string;
  input_tokens: number;
  output_tokens: number;
  tool_calls: number;
  error: string | null;
  started_at: number;
  completed_at: number;
}

function publicRun(row: ProjectRunRow) {
  return {
    id: row.id,
    projectId: row.project_id,
    threadId: row.thread_id,
    source: row.source,
    status: row.status,
    model: row.model,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    toolCalls: row.tool_calls,
    error: row.error,
    startedAt: new Date(row.started_at).toISOString(),
    completedAt: new Date(row.completed_at).toISOString(),
  };
}

export async function recordProjectRun(db: D1Database, run: ProjectRunInput): Promise<void> {
  await db.batch([
    db.prepare(
      `INSERT OR REPLACE INTO project_run (
        id, project_id, thread_id, source, status, model, input_tokens,
        output_tokens, tool_calls, error, started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      run.id,
      run.projectId,
      run.threadId,
      run.source,
      run.status,
      run.model,
      Math.max(0, Math.trunc(run.inputTokens)),
      Math.max(0, Math.trunc(run.outputTokens)),
      Math.max(0, Math.trunc(run.toolCalls)),
      run.error?.slice(0, 500) ?? null,
      run.startedAt,
      run.completedAt,
    ),
    db.prepare(
      `DELETE FROM project_run
        WHERE project_id = ? AND id NOT IN (
          SELECT id FROM project_run
          WHERE project_id = ?
          ORDER BY completed_at DESC
          LIMIT 100
        )`,
    ).bind(run.projectId, run.projectId),
  ]);
}

export async function listProjectRuns(
  db: D1Database,
  ownerId: string,
  projectId: string,
) {
  const result = await db.prepare(
    `SELECT project_run.*
      FROM project_run JOIN project ON project.id = project_run.project_id
      WHERE project_run.project_id = ? AND project.owner_id = ?
      ORDER BY project_run.completed_at DESC
      LIMIT 30`,
  ).bind(projectId, ownerId).all<ProjectRunRow>();
  return result.results.map(publicRun);
}
