-- 024_email_hash.sql
-- Adds email_hash (HMAC-SHA256 with server pepper) to users for indexed
-- lookups. Allows the email column to be encrypted at rest in a future
-- migration without breaking login / password-reset flows.
--
-- The column is nullable during the migration window. After running the
-- backfill script (server/src/scripts/backfillEmailHash.ts) a follow-up
-- migration can tighten the index to enforce NOT NULL.

ALTER TABLE users ADD COLUMN email_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_hash
  ON users(email_hash) WHERE email_hash IS NOT NULL;
