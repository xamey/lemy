CREATE TABLE usage_authorization (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_nano_usd_per_token INTEGER NOT NULL,
  cached_input_nano_usd_per_token INTEGER NOT NULL,
  output_nano_usd_per_token INTEGER NOT NULL,
  reserved_nano_usd INTEGER NOT NULL CHECK(reserved_nano_usd > 0),
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending', 'settled', 'cancelled')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  settled_at INTEGER,
  input_tokens INTEGER,
  cached_input_tokens INTEGER,
  output_tokens INTEGER,
  provider_cost_nano_usd INTEGER,
  charged_nano_usd INTEGER
);

CREATE INDEX usage_authorization_user_state_expires_idx
  ON usage_authorization(user_id, state, expires_at);

CREATE TRIGGER usage_authorization_reserves_credit
AFTER INSERT ON usage_authorization
BEGIN
  INSERT INTO credit_ledger (
    reference, user_id, delta, kind, created_at, project_id, provider, model
  ) VALUES (
    'reservation:' || NEW.id, NEW.user_id, -NEW.reserved_nano_usd, 'usage',
    NEW.created_at, NEW.project_id, NEW.provider, NEW.model
  );
END;

CREATE TRIGGER usage_authorization_settles_credit
AFTER UPDATE OF state ON usage_authorization
WHEN OLD.state = 'pending'
  AND NEW.state = 'settled'
  AND NEW.charged_nano_usd != OLD.reserved_nano_usd
BEGIN
  INSERT INTO credit_ledger (
    reference, user_id, delta, kind, created_at, project_id, provider, model,
    input_tokens, cached_input_tokens, output_tokens, provider_cost_nano_usd
  ) VALUES (
    'settlement:' || NEW.id, NEW.user_id,
    OLD.reserved_nano_usd - NEW.charged_nano_usd, 'usage', NEW.settled_at,
    NEW.project_id, NEW.provider, NEW.model, NEW.input_tokens,
    NEW.cached_input_tokens, NEW.output_tokens, NEW.provider_cost_nano_usd
  );
END;

CREATE TRIGGER usage_authorization_refunds_credit
AFTER UPDATE OF state ON usage_authorization
WHEN OLD.state = 'pending' AND NEW.state = 'cancelled'
BEGIN
  INSERT INTO credit_ledger (
    reference, user_id, delta, kind, created_at, project_id, provider, model
  ) VALUES (
    'refund:' || NEW.id, NEW.user_id, OLD.reserved_nano_usd, 'refund',
    NEW.settled_at, NEW.project_id, NEW.provider, NEW.model
  );
END;
