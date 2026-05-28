-- 023_business_id_columns.sql
-- Adds business_id to all tenant-scoped data tables, backfills from each
-- user's personal business (created in 022), and migrates the subscriptions
-- table from user_id PK to org_id PK.
--
-- Also rebuilds the categories table to change its UNIQUE constraint from
-- (user_id, name) → (business_id, name) since categories are now shared
-- within a business.

-- ── 1. Add business_id to accounts, rules, statements, transactions, receipts ──

ALTER TABLE accounts     ADD COLUMN business_id INTEGER REFERENCES businesses(id);
ALTER TABLE rules        ADD COLUMN business_id INTEGER REFERENCES businesses(id);
ALTER TABLE statements   ADD COLUMN business_id INTEGER REFERENCES businesses(id);
ALTER TABLE transactions ADD COLUMN business_id INTEGER REFERENCES businesses(id);
ALTER TABLE receipts     ADD COLUMN business_id INTEGER REFERENCES businesses(id);

-- ── 2. Rebuild categories to change UNIQUE(user_id, name) → UNIQUE(business_id, name) ──

CREATE TABLE categories_v2 (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         TEXT             REFERENCES users(id)     ON DELETE CASCADE,
  business_id     INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name            TEXT    NOT NULL,
  kind            TEXT    NOT NULL,
  tax_export_code TEXT    DEFAULT NULL,
  is_business     INTEGER NOT NULL DEFAULT 1,
  UNIQUE(business_id, name)
);

INSERT INTO categories_v2(id, user_id, business_id, name, kind, tax_export_code, is_business)
SELECT c.id, c.user_id,
       (SELECT b.id FROM businesses b WHERE b.org_id = c.user_id AND b.name = 'Personal' LIMIT 1),
       c.name, c.kind, c.tax_export_code, c.is_business
FROM categories c;

DROP TABLE categories;
ALTER TABLE categories_v2 RENAME TO categories;

CREATE INDEX IF NOT EXISTS idx_categories_user     ON categories(user_id);
CREATE INDEX IF NOT EXISTS idx_categories_business ON categories(business_id);

-- ── 3. Backfill business_id on remaining tables ───────────────────────────────
-- Convention: personal org_id == user_id (established in 022), so we can
-- find the personal business by joining businesses on org_id = user_id.

UPDATE accounts SET business_id = (
  SELECT b.id FROM businesses b WHERE b.org_id = accounts.user_id AND b.name = 'Personal' LIMIT 1
);

UPDATE rules SET business_id = (
  SELECT b.id FROM businesses b WHERE b.org_id = rules.user_id AND b.name = 'Personal' LIMIT 1
);

UPDATE statements SET business_id = (
  SELECT b.id FROM businesses b WHERE b.org_id = statements.user_id AND b.name = 'Personal' LIMIT 1
);

UPDATE transactions SET business_id = (
  SELECT b.id FROM businesses b WHERE b.org_id = transactions.user_id AND b.name = 'Personal' LIMIT 1
);

UPDATE receipts SET business_id = (
  SELECT b.id FROM businesses b WHERE b.org_id = receipts.user_id AND b.name = 'Personal' LIMIT 1
);

-- ── 4. Indexes ────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_accounts_business     ON accounts(business_id);
CREATE INDEX IF NOT EXISTS idx_rules_business        ON rules(business_id);
CREATE INDEX IF NOT EXISTS idx_statements_business   ON statements(business_id);
CREATE INDEX IF NOT EXISTS idx_transactions_business ON transactions(business_id);
CREATE INDEX IF NOT EXISTS idx_receipts_business     ON receipts(business_id);

-- ── 5. Migrate subscriptions: user_id PK → org_id PK ─────────────────────────
-- Personal org_id == user_id (migration 022), so the backfill is a direct copy.
-- SQLite requires table recreation to change the primary key.

CREATE TABLE subscriptions_v2 (
  org_id                 TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  status                 TEXT NOT NULL DEFAULT 'trialing'
                           CHECK (status IN ('trialing','active','past_due','canceled','incomplete')),
  plan                   TEXT NOT NULL DEFAULT 'beta',
  trial_ends_at          TEXT,
  current_period_end     TEXT,
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO subscriptions_v2(
  org_id, status, plan, trial_ends_at, current_period_end,
  stripe_customer_id, stripe_subscription_id, created_at, updated_at
)
SELECT
  user_id, status, plan, trial_ends_at, current_period_end,
  stripe_customer_id, stripe_subscription_id, created_at, updated_at
FROM subscriptions;

DROP TABLE subscriptions;
ALTER TABLE subscriptions_v2 RENAME TO subscriptions;

CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
