-- Drop legacy plaintext columns now that all rows have been migrated to their
-- _enc equivalents. Run ONLY after encryptExistingRows.ts has completed
-- successfully on every environment this migration will reach.
--
-- PostgreSQL drops indexes defined on a dropped column automatically.

-- users: email and name replaced by email_enc, name_enc, email_hash
ALTER TABLE users DROP COLUMN IF EXISTS email;
ALTER TABLE users DROP COLUMN IF EXISTS name;

-- user_totp: secret replaced by secret_enc
ALTER TABLE user_totp DROP COLUMN IF EXISTS secret;

-- user_drive_tokens: tokens_json replaced by tokens_json_enc
ALTER TABLE user_drive_tokens DROP COLUMN IF EXISTS tokens_json;
