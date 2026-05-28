-- 012_password_reset_tokens.sql (Postgres)
-- One-time tokens for the "forgot password" flow.
-- Tokens are stored hashed (SHA-256 hex) so the raw token only lives in the
-- email link, never at rest.

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,     -- SHA-256(raw_token)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  used_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_prt_token_hash ON password_reset_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_prt_user_id    ON password_reset_tokens(user_id);
