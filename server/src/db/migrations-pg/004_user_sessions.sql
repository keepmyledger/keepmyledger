-- 004_user_sessions.sql
-- Postgres session table for connect-pg-simple. Schema matches that library's
-- default (sid PK, sess JSON, expire TIMESTAMP) so it can read/write rows
-- directly. We own the DDL via migrations rather than letting the library
-- auto-create the table, so future driver swaps (Redis, DynamoDB) start from
-- an explicit baseline.

CREATE TABLE IF NOT EXISTS user_sessions (
  sid    VARCHAR      NOT NULL PRIMARY KEY,
  sess   JSON         NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_expire ON user_sessions(expire);
