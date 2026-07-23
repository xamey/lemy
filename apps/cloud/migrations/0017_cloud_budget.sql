CREATE TABLE cloud_budget (
  bucket TEXT PRIMARY KEY NOT NULL,
  used INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0),
  updated_at INTEGER NOT NULL
);
