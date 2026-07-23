CREATE TABLE access_request (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'granted', 'revoked')),
  requested_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX access_request_status_requested_at_idx
  ON access_request(status, requested_at);
