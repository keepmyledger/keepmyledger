-- 010_trial_email_sent.sql (Postgres)
-- Tracks when the trial-ending reminder email was dispatched so the scheduler
-- never sends it twice.

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS trial_ending_email_sent_at TIMESTAMPTZ;
