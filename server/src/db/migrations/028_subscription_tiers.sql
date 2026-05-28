-- 028_subscription_tiers.sql
-- Introduces tier/seats/admin-grant columns on subscriptions.
--
-- Tier model:
--   'free'     — trial users (default; all existing rows backfill to this)
--   'business' — single user/business, unlimited AI, paid
--   'org'      — multi-business + invites + seat-based, paid
--
-- granted_by_admin_id / granted_at: populated when an admin comps a user a
-- tier locally (no Stripe sub). Allows revocation + audit traceability.

ALTER TABLE subscriptions ADD COLUMN tier TEXT NOT NULL DEFAULT 'free'
  CHECK (tier IN ('free', 'business', 'org'));

ALTER TABLE subscriptions ADD COLUMN seats INTEGER NOT NULL DEFAULT 1;

ALTER TABLE subscriptions ADD COLUMN granted_by_admin_id TEXT
  REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE subscriptions ADD COLUMN granted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_subscriptions_tier ON subscriptions(tier);
