-- 015_email_columns.sql
-- Adds columns for email capture at registration, Terms-of-Service acceptance
-- tracking, and password-reset session invalidation.
--
-- email is already present on `users` from migration 007; these columns extend
-- the row for SaaS-specific lifecycle tracking without breaking self-host.

ALTER TABLE users ADD COLUMN tos_accepted_at      TEXT;
ALTER TABLE users ADD COLUMN email_verified_at    TEXT;
ALTER TABLE users ADD COLUMN password_changed_at  TEXT;
