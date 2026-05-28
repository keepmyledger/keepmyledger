-- 027_security_audit_log.sql
-- Per-user security event log. Tracks authentication, credential changes,
-- account lifecycle, and OAuth connection events.
--
-- Distinct from admin_audit_log (which is for admin-on-user actions) — this
-- table records what users do for/to their own accounts.

CREATE TABLE IF NOT EXISTS security_audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      TEXT    REFERENCES users(id) ON DELETE SET NULL,
  action       TEXT    NOT NULL,
  ip_address   TEXT    DEFAULT NULL,
  user_agent   TEXT    DEFAULT NULL,
  payload_json TEXT    DEFAULT NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sec_audit_user     ON security_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_sec_audit_action   ON security_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_sec_audit_created  ON security_audit_log(created_at);
