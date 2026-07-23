CREATE TABLE admin_login_attempt (
  identity_hash TEXT PRIMARY KEY,
  window_started_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL
);

CREATE INDEX admin_login_attempt_window_idx
  ON admin_login_attempt(window_started_at);
