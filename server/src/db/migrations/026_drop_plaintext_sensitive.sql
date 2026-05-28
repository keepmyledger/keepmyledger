-- Drop legacy plaintext columns now that all rows have been migrated to their
-- _enc equivalents. Run ONLY after encryptExistingRows.ts has completed
-- successfully on every environment this migration will reach.
--
-- SQLite requires explicitly dropping a partial index before dropping its column.

-- users: email and name replaced by email_enc, name_enc, email_hash
DROP INDEX IF EXISTS idx_users_email;
ALTER TABLE users DROP COLUMN email;
ALTER TABLE users DROP COLUMN name;

-- user_totp: secret replaced by secret_enc
ALTER TABLE user_totp DROP COLUMN secret;

-- user_drive_tokens: tokens_json replaced by tokens_json_enc
ALTER TABLE user_drive_tokens DROP COLUMN tokens_json;
