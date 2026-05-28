-- 017_email_suppression.sql
-- Tracks SES bounce / complaint events so we can suppress future sends.

ALTER TABLE users ADD COLUMN email_bounced_at   TEXT;
ALTER TABLE users ADD COLUMN email_complained_at TEXT;
