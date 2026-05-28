-- 006_subscriptions.sql
-- Per-user subscription state for SaaS gating. Mirrors the SQLite migration.

CREATE TABLE IF NOT EXISTS subscriptions (
  user_id                TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status                 TEXT NOT NULL DEFAULT 'trialing'
                           CHECK (status IN ('trialing','active','past_due','canceled','incomplete')),
  plan                   TEXT NOT NULL DEFAULT 'beta',
  trial_ends_at          TIMESTAMPTZ,
  current_period_end     TIMESTAMPTZ,
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
