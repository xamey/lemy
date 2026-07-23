DROP TRIGGER credit_ledger_has_funds;
DROP TRIGGER credit_ledger_updates_balance;

CREATE TABLE credit_account_next (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  balance INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

INSERT INTO credit_account_next (user_id, balance, updated_at)
SELECT user_id, balance * 1000000, updated_at FROM credit_account;

DROP TABLE credit_account;
ALTER TABLE credit_account_next RENAME TO credit_account;

UPDATE credit_ledger SET delta = delta * 1000000;

ALTER TABLE credit_ledger ADD COLUMN project_id TEXT;
ALTER TABLE credit_ledger ADD COLUMN provider TEXT;
ALTER TABLE credit_ledger ADD COLUMN model TEXT;
ALTER TABLE credit_ledger ADD COLUMN input_tokens INTEGER;
ALTER TABLE credit_ledger ADD COLUMN cached_input_tokens INTEGER;
ALTER TABLE credit_ledger ADD COLUMN output_tokens INTEGER;
ALTER TABLE credit_ledger ADD COLUMN provider_cost_nano_usd INTEGER;

CREATE TRIGGER credit_ledger_updates_balance
AFTER INSERT ON credit_ledger
BEGIN
  UPDATE credit_account
  SET balance = balance + NEW.delta, updated_at = NEW.created_at
  WHERE user_id = NEW.user_id;
END;

ALTER TABLE project ADD COLUMN llm_managed INTEGER NOT NULL DEFAULT 0;
