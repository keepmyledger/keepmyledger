-- 009_ai_usage.sql
-- Per-user per-day counter for AI Assist requests. Used to enforce a daily
-- quota (e.g. 100/day on SaaS; unlimited on self-host when AI_DAILY_LIMIT=0).

CREATE TABLE IF NOT EXISTS ai_usage (
  user_id TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day     TEXT    NOT NULL,                       -- YYYY-MM-DD (UTC)
  count   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_user_day ON ai_usage(user_id, day);
