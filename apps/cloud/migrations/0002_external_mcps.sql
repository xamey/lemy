CREATE TABLE external_mcp (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  auth_type TEXT NOT NULL CHECK(auth_type IN ('oauth', 'bearer')),
  connected INTEGER NOT NULL DEFAULT 0,
  credential_ciphertext TEXT,
  credential_iv TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(project_id, name)
);

CREATE INDEX external_mcp_project_id_idx ON external_mcp(project_id);
