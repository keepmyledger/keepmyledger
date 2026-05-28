-- 007_local_auth.sql (Postgres)
-- Adds username/password local authentication and TOTP two-factor auth support.

ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username
  ON users(username) WHERE username IS NOT NULL;

CREATE TABLE IF NOT EXISTS user_totp (
  user_id    TEXT    PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret     TEXT    NOT NULL,
  enabled    BOOLEAN NOT NULL DEFAULT false,
  created_at TEXT    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);
