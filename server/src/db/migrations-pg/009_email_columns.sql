-- 009_email_columns.sql (Postgres)
-- Adds columns for email capture at registration, Terms-of-Service acceptance
-- tracking, and password-reset session invalidation.
--
-- email is already present on `users` from migration 001; these columns extend
-- the row for SaaS-specific lifecycle tracking without breaking self-host.

ALTER TABLE users ADD COLUMN IF NOT EXISTS tos_accepted_at      TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at    TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at  TIMESTAMPTZ;
