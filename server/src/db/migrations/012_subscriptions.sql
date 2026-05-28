-- 012_subscriptions.sql
-- Per-user subscription state for SaaS gating. Stripe columns are nullable
-- until Phase 4b wires in payment processing.
--
-- Self-host: no rows inserted; requireActiveSubscription middleware short-circuits
-- to allow when APP_MODE != 'saas'.
-- SaaS: rows are inserted by UserRepoImpl.provisionDefaults on first login.

CREATE TABLE IF NOT EXISTS subscriptions (
  user_id                TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status                 TEXT NOT NULL DEFAULT 'trialing'
                           CHECK (status IN ('trialing','active','past_due','canceled','incomplete')),
  plan                   TEXT NOT NULL DEFAULT 'beta',
  trial_ends_at          TEXT,                          -- ISO datetime (UTC)
  current_period_end     TEXT,                          -- ISO datetime (UTC); set by Stripe in 4b
  stripe_customer_id     TEXT,                          -- nullable until 4b
  stripe_subscription_id TEXT,                          -- nullable until 4b
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
