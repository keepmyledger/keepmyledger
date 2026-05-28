-- 019_admin.sql
-- Adds is_admin flag to users and creates the admin_audit_log table.

ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id  TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action         TEXT    NOT NULL,
  target_type    TEXT    DEFAULT NULL,
  target_id      TEXT    DEFAULT NULL,
  payload_json   TEXT    DEFAULT NULL,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_actor ON admin_audit_log(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created ON admin_audit_log(created_at);
