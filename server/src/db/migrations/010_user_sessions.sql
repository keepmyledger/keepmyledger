-- 010_user_sessions.sql
-- Persistent session storage for express-session. Schema is intentionally
-- minimal and driver-agnostic (sid / serialized blob / expiry epoch) so the
-- same shape can be reproduced on top of Redis, DynamoDB, etc. in the future.
--
-- expire = unix epoch milliseconds (NOT a SQL timestamp) so the store
-- implementation can do plain integer comparisons across both backends.

CREATE TABLE IF NOT EXISTS user_sessions (
  sid    TEXT    PRIMARY KEY,
  sess   TEXT    NOT NULL,                       -- JSON-serialized session
  expire INTEGER NOT NULL                        -- unix epoch ms
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_expire ON user_sessions(expire);
