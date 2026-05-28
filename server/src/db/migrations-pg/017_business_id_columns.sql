-- 017_business_id_columns.sql (Postgres)
-- Adds business_id to all tenant-scoped data tables, backfills from each
-- user's personal business (created in 016), and migrates the subscriptions
-- table from user_id PK to org_id PK.
--
-- Unlike SQLite, Postgres supports ALTER TABLE for PK changes and can add
-- NOT NULL constraints after backfill. The categories UNIQUE constraint is
-- changed from (user_id, name) → (business_id, name) by dropping and
-- re-adding it.

-- ── 1. Add business_id columns ────────────────────────────────────────────────

ALTER TABLE accounts     ADD COLUMN IF NOT EXISTS business_id INTEGER REFERENCES businesses(id);
ALTER TABLE rules        ADD COLUMN IF NOT EXISTS business_id INTEGER REFERENCES businesses(id);
ALTER TABLE statements   ADD COLUMN IF NOT EXISTS business_id INTEGER REFERENCES businesses(id);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS business_id INTEGER REFERENCES businesses(id);
ALTER TABLE receipts     ADD COLUMN IF NOT EXISTS business_id INTEGER REFERENCES businesses(id);

-- ── 2. Update categories UNIQUE constraint ────────────────────────────────────
-- Drop the old (user_id, name) unique index and add a business_id column.

ALTER TABLE categories ADD COLUMN IF NOT EXISTS business_id INTEGER REFERENCES businesses(id);

-- Postgres allows dropping a named constraint:
ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_user_id_name_key;

ALTER TABLE categories ADD CONSTRAINT categories_business_id_name_key UNIQUE (business_id, name);

-- ── 3. Backfill business_id on all tables ─────────────────────────────────────

UPDATE categories SET business_id = (
  SELECT b.id FROM businesses b WHERE b.org_id = categories.user_id AND b.name = 'Personal' LIMIT 1
);

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

CREATE INDEX IF NOT EXISTS idx_categories_business   ON categories(business_id);
CREATE INDEX IF NOT EXISTS idx_accounts_business     ON accounts(business_id);
CREATE INDEX IF NOT EXISTS idx_rules_business        ON rules(business_id);
CREATE INDEX IF NOT EXISTS idx_statements_business   ON statements(business_id);
CREATE INDEX IF NOT EXISTS idx_transactions_business ON transactions(business_id);
CREATE INDEX IF NOT EXISTS idx_receipts_business     ON receipts(business_id);

-- ── 5. Migrate subscriptions: user_id PK → org_id PK ─────────────────────────
-- Personal org_id == user_id (migration 016), so the backfill is a direct copy.

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS org_id TEXT;

UPDATE subscriptions SET org_id = user_id;

ALTER TABLE subscriptions ALTER COLUMN org_id SET NOT NULL;

ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_org_id_fkey
  FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_pkey;
ALTER TABLE subscriptions ADD PRIMARY KEY (org_id);

ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_user_id_fkey;
ALTER TABLE subscriptions DROP COLUMN IF EXISTS user_id;
