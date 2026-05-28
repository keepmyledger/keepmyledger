-- 013_local_auth.sql
-- Adds username/password local authentication and TOTP two-factor auth support.
--
-- * username — unique, lowercase, case-insensitive login handle (no email needed)
-- * password_hash — argon2id hash; NULL for OAuth-only users
-- * user_totp — stores per-user TOTP secret; enabled=0 until user confirms the code

ALTER TABLE users ADD COLUMN username TEXT;
ALTER TABLE users ADD COLUMN password_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username
  ON users(username) WHERE username IS NOT NULL;

CREATE TABLE IF NOT EXISTS user_totp (
  user_id    TEXT    PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret     TEXT    NOT NULL,          -- base32-encoded TOTP secret (RFC 6238)
  enabled    INTEGER NOT NULL DEFAULT 0, -- 0 = pending setup, 1 = active
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
