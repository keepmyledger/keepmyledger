-- 011_email_suppression.sql (Postgres)
-- Tracks SES bounce / complaint events so we can suppress future sends.

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_bounced_at    TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_complained_at TIMESTAMPTZ;
