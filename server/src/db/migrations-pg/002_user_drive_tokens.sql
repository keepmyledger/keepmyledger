-- Per-user Google Drive OAuth tokens + each user's auto-created upload folder.
CREATE TABLE IF NOT EXISTS user_drive_tokens (
  user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tokens_json TEXT NOT NULL,
  folder_id   TEXT,
  updated_at  TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

-- Backfill: if a pre-existing single-tenant token lives in app_state, move it
-- to the owner user, then drop the global row.
INSERT INTO user_drive_tokens(user_id, tokens_json)
SELECT '00000000-0000-0000-0000-000000000001', value
FROM app_state
WHERE key = 'google_oauth_tokens'
ON CONFLICT (user_id) DO NOTHING;

DELETE FROM app_state WHERE key = 'google_oauth_tokens';
