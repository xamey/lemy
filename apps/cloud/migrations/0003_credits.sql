CREATE TABLE credit_account (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  balance INTEGER NOT NULL DEFAULT 0 CHECK(balance >= 0),
  updated_at INTEGER NOT NULL
);

CREATE TABLE credit_ledger (
  reference TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL CHECK(delta != 0),
  kind TEXT NOT NULL CHECK(kind IN ('stripe_topup', 'local_topup', 'usage', 'refund')),
  created_at INTEGER NOT NULL
);

CREATE INDEX credit_ledger_user_id_created_at_idx
  ON credit_ledger(user_id, created_at DESC);

CREATE TRIGGER credit_ledger_has_funds
BEFORE INSERT ON credit_ledger
WHEN NEW.delta < 0
  AND COALESCE((SELECT balance FROM credit_account WHERE user_id = NEW.user_id), 0) < -NEW.delta
BEGIN
  SELECT RAISE(ABORT, 'insufficient credits');
END;

CREATE TRIGGER credit_ledger_updates_balance
AFTER INSERT ON credit_ledger
BEGIN
  UPDATE credit_account
  SET balance = balance + NEW.delta, updated_at = NEW.created_at
  WHERE user_id = NEW.user_id;
END;
