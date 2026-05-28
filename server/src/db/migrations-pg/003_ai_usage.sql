-- 003_ai_usage.sql (Postgres)
-- Per-user per-day counter for AI Assist requests. Mirrors sqlite migration 009.

CREATE TABLE IF NOT EXISTS ai_usage (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day     TEXT NOT NULL,                       -- YYYY-MM-DD (UTC)
  count   INT  NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_user_day ON ai_usage(user_id, day);
