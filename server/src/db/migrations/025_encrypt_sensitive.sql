-- 025_encrypt_sensitive.sql
-- Adds encrypted sibling columns for the small set of fields that require
-- app-level at-rest encryption:
--
--   users.email_enc, users.name_enc
--   user_drive_tokens.tokens_json_enc
--   user_totp.secret_enc
--
-- Columns are nullable during the migration window. The plaintext columns
-- are retained for backward compatibility until the backfill script
-- (server/src/scripts/encryptExistingRows.ts) has completed and
-- migration 026_drop_plaintext_sensitive.sql has been applied.
--
-- Repos read from the _enc column when present, falling back to the legacy
-- plaintext column, so no downtime is required.

ALTER TABLE users ADD COLUMN email_enc TEXT;
ALTER TABLE users ADD COLUMN name_enc  TEXT;

ALTER TABLE user_drive_tokens ADD COLUMN tokens_json_enc TEXT;

ALTER TABLE user_totp ADD COLUMN secret_enc TEXT;
