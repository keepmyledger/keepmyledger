-- 022_subscription_tiers.sql (Postgres)
-- Mirrors the SQLite migration: tier/seats/admin-grant columns on subscriptions.

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'free';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_tier_check'
  ) THEN
    ALTER TABLE subscriptions
      ADD CONSTRAINT subscriptions_tier_check
      CHECK (tier IN ('free', 'business', 'org'));
  END IF;
END $$;

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS seats INTEGER NOT NULL DEFAULT 1;

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS granted_by_admin_id TEXT
  REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS granted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_subscriptions_tier ON subscriptions(tier);
