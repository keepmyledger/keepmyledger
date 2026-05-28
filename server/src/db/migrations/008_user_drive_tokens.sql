-- Per-user Google Drive OAuth tokens + each user's auto-created upload folder.
-- Replaces the single global token previously stored in
-- app_state.google_oauth_tokens. The global row is migrated to the owner
-- user so existing selfhost installs don't need to reconnect Drive.

CREATE TABLE IF NOT EXISTS user_drive_tokens (
  user_id        TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tokens_json    TEXT NOT NULL,
  folder_id      TEXT,
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
);

-- Backfill: copy any pre-existing global token onto the owner user, then
-- delete the global row.
INSERT OR IGNORE INTO user_drive_tokens(user_id, tokens_json, updated_at)
SELECT
  '00000000-0000-0000-0000-000000000001',
  value,
  strftime('%Y-%m-%d %H:%M:%S','now')
FROM app_state
WHERE key = 'google_oauth_tokens';

DELETE FROM app_state WHERE key = 'google_oauth_tokens';
