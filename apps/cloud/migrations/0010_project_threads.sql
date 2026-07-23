CREATE TABLE project_thread (
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  principal TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  agent_name TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, principal, thread_id)
);

CREATE INDEX project_thread_project_id_idx ON project_thread(project_id);
