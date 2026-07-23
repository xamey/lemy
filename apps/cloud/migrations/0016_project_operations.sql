DROP TABLE agent_access_token;

CREATE TABLE agent_access_token (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  permission TEXT NOT NULL CHECK (permission IN ('read', 'write')),
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);

CREATE INDEX agent_access_token_project_id_idx
  ON agent_access_token(project_id, created_at DESC);

CREATE TABLE project_run (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('runtime', 'playground')),
  status TEXT NOT NULL CHECK (status IN ('completed', 'error', 'aborted')),
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  tool_calls INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  started_at INTEGER NOT NULL,
  completed_at INTEGER NOT NULL
);

CREATE INDEX project_run_project_completed_idx
  ON project_run(project_id, completed_at DESC);
