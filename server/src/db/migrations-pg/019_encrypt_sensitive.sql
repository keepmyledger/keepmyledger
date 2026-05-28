-- 019_encrypt_sensitive.sql (PG migration 019)
-- Adds encrypted sibling columns for the small set of fields that require
-- app-level at-rest encryption:
--
--   users.email_enc, users.name_enc
--   user_drive_tokens.tokens_json_enc
--   user_totp.secret_enc

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_enc TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS name_enc  TEXT;

ALTER TABLE user_drive_tokens ADD COLUMN IF NOT EXISTS tokens_json_enc TEXT;

ALTER TABLE user_totp ADD COLUMN IF NOT EXISTS secret_enc TEXT;
