CREATE TABLE stripe_purchase (
  checkout_session_id TEXT PRIMARY KEY NOT NULL,
  payment_intent_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  purchased_nano_usd INTEGER NOT NULL CHECK(purchased_nano_usd > 0),
  reversed_nano_usd INTEGER NOT NULL DEFAULT 0 CHECK(reversed_nano_usd >= 0),
  created_at INTEGER NOT NULL
);

CREATE TABLE stripe_reversal_event (
  id TEXT PRIMARY KEY NOT NULL,
  payment_intent_id TEXT NOT NULL,
  target_reversed_nano_usd INTEGER NOT NULL CHECK(target_reversed_nano_usd > 0),
  created_at INTEGER NOT NULL
);

CREATE INDEX stripe_reversal_payment_intent_idx
  ON stripe_reversal_event(payment_intent_id);

CREATE TRIGGER stripe_reversal_applies_credit
AFTER INSERT ON stripe_reversal_event
WHEN EXISTS (
  SELECT 1 FROM stripe_purchase
  WHERE payment_intent_id = NEW.payment_intent_id
    AND reversed_nano_usd < MIN(NEW.target_reversed_nano_usd, purchased_nano_usd)
)
BEGIN
  INSERT INTO credit_ledger (reference, user_id, delta, kind, created_at)
  SELECT
    'stripe-reversal:' || NEW.id,
    user_id,
    -(MIN(NEW.target_reversed_nano_usd, purchased_nano_usd) - reversed_nano_usd),
    'refund',
    NEW.created_at
  FROM stripe_purchase
  WHERE payment_intent_id = NEW.payment_intent_id;

  UPDATE stripe_purchase
  SET reversed_nano_usd = MIN(NEW.target_reversed_nano_usd, purchased_nano_usd)
  WHERE payment_intent_id = NEW.payment_intent_id;
END;

CREATE TRIGGER stripe_purchase_applies_pending_reversal
AFTER INSERT ON stripe_purchase
WHEN EXISTS (
  SELECT 1 FROM stripe_reversal_event WHERE payment_intent_id = NEW.payment_intent_id
)
BEGIN
  INSERT INTO credit_ledger (reference, user_id, delta, kind, created_at)
  SELECT
    'stripe-reversal:pending:' || NEW.checkout_session_id,
    NEW.user_id,
    -MIN(MAX(target_reversed_nano_usd), NEW.purchased_nano_usd),
    'refund',
    NEW.created_at
  FROM stripe_reversal_event
  WHERE payment_intent_id = NEW.payment_intent_id;

  UPDATE stripe_purchase
  SET reversed_nano_usd = MIN(
    (SELECT MAX(target_reversed_nano_usd) FROM stripe_reversal_event
      WHERE payment_intent_id = NEW.payment_intent_id),
    NEW.purchased_nano_usd
  )
  WHERE checkout_session_id = NEW.checkout_session_id;
END;
