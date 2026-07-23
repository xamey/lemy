CREATE TABLE runtime_session_lease (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  principal TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX runtime_session_lease_scope_idx
  ON runtime_session_lease(project_id, principal, expires_at);

CREATE TRIGGER access_request_pending_limit
BEFORE INSERT ON access_request
WHEN NEW.status = 'pending'
  AND (SELECT COUNT(*) FROM access_request WHERE status = 'pending') >= 5000
BEGIN
  SELECT RAISE(ABORT, 'Waitlist is full');
END;
