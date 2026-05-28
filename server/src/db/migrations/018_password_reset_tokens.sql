-- 018_password_reset_tokens.sql
-- One-time tokens for the "forgot password" flow.
-- Tokens are stored hashed (SHA-256 hex) so the raw token only lives in the
-- email link, never at rest.

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id           TEXT PRIMARY KEY,         -- random UUID
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,     -- SHA-256(raw_token)
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  used_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_prt_token_hash ON password_reset_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_prt_user_id    ON password_reset_tokens(user_id);
