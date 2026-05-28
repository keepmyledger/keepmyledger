-- 021_security_audit_log.sql (PG migration 021)
-- Per-user security event log.

CREATE TABLE IF NOT EXISTS security_audit_log (
  id           BIGSERIAL PRIMARY KEY,
  user_id      TEXT    REFERENCES users(id) ON DELETE SET NULL,
  action       TEXT    NOT NULL,
  ip_address   TEXT    DEFAULT NULL,
  user_agent   TEXT    DEFAULT NULL,
  payload_json TEXT    DEFAULT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sec_audit_user    ON security_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_sec_audit_action  ON security_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_sec_audit_created ON security_audit_log(created_at);
