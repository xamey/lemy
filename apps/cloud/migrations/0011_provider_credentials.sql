CREATE TABLE provider_credential (
  owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK(provider IN ('openai', 'anthropic')),
  api_key_ciphertext TEXT NOT NULL,
  api_key_iv TEXT NOT NULL,
  validation_status TEXT NOT NULL CHECK(validation_status IN ('validated', 'invalid')),
  validated_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, provider)
);
