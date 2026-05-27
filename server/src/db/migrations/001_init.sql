-- 001_init.sql — consolidated initial schema (SQLite).
--
-- Represents the complete end-state schema. Fresh installs apply this file
-- once; no incremental migration files are needed on this branch. Future
-- schema changes ship as 002_*.sql, 003_*.sql, etc.
--
-- Conventions:
--   - All integer surrogate PKs use INTEGER PRIMARY KEY AUTOINCREMENT.
--   - Date/time columns are TEXT stored as ISO-8601 (datetime('now')).
--   - Amount is REAL (signed: negative = expense, positive = income).
--   - Booleans are INTEGER 0/1.
--   - PII fields are encrypted at rest: columns named <field>_enc hold
--     AES-256-GCM ciphertext (see server/src/auth/crypto.ts).
--   - Email lookups use email_hash (HMAC-SHA256), not the ciphertext.

-- ── app_state ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_state (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- ── users + identities ───────────────────────────────────────────────────────
-- email and name are stored encrypted (email_enc, name_enc). Email lookups
-- use the HMAC hash (email_hash) — see server/src/auth/emailHash.ts.
CREATE TABLE IF NOT EXISTS users (
  id                          TEXT    PRIMARY KEY,   -- uuid
  email_enc                   TEXT,                  -- AES-256-GCM encrypted email
  name_enc                    TEXT,                  -- AES-256-GCM encrypted display name
  email_hash                  TEXT,                  -- HMAC-SHA256 of normalized email
  avatar_url                  TEXT,
  username                    TEXT,
  password_hash               TEXT,                  -- argon2id; NULL for OAuth-only users
  created_at                  TEXT    NOT NULL DEFAULT (datetime('now')),
  tos_accepted_at             TEXT,
  email_verified_at           TEXT,
  password_changed_at         TEXT,
  is_admin                    INTEGER NOT NULL DEFAULT 0,
  email_bounced_at            TEXT,
  email_complained_at         TEXT,
  receipt_storage_preference  TEXT    DEFAULT NULL   -- 'kml' | 'drive' | NULL (follow server default)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_hash
  ON users(email_hash) WHERE email_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username
  ON users(username) WHERE username IS NOT NULL;

CREATE TABLE IF NOT EXISTS user_identities (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider         TEXT NOT NULL,   -- google | local | apple | microsoft | owner
  provider_user_id TEXT NOT NULL,
  email            TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(provider, provider_user_id)
);
CREATE INDEX IF NOT EXISTS idx_user_identities_user ON user_identities(user_id);

-- Seed the implicit "owner" user (used in self-host mode).
INSERT OR IGNORE INTO users(id) VALUES ('00000000-0000-0000-0000-000000000001');
INSERT OR IGNORE INTO user_identities(user_id, provider, provider_user_id)
  VALUES ('00000000-0000-0000-0000-000000000001', 'owner', 'owner');

-- ── TOTP ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_totp (
  user_id    TEXT    PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_enc TEXT    NOT NULL,   -- encrypted base32 TOTP secret (RFC 6238)
  enabled    INTEGER NOT NULL DEFAULT 0,   -- 0 = pending setup, 1 = active
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ── password reset ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id         TEXT PRIMARY KEY,        -- random UUID
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,    -- SHA-256(raw_token)
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_prt_token_hash ON password_reset_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_prt_user_id    ON password_reset_tokens(user_id);

-- ── organizations + memberships + businesses + invites ────────────────────────
-- Multi-tenant model: each user gets a personal org (id == user_id);
-- org members share businesses and their data.
CREATE TABLE IF NOT EXISTS organizations (
  id         TEXT PRIMARY KEY,   -- uuid; personal org reuses the user's uuid
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS org_memberships (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id     TEXT    NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    TEXT    NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
  role       TEXT    NOT NULL DEFAULT 'member'
               CHECK (role IN ('owner', 'member')),
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(org_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_org_memberships_user ON org_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_org_memberships_org  ON org_memberships(org_id);

CREATE TABLE IF NOT EXISTS businesses (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id            TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  logo_storage_key  TEXT DEFAULT NULL,
  logo_content_type TEXT DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_businesses_org ON businesses(org_id);

CREATE TABLE IF NOT EXISTS org_invites (
  id         TEXT PRIMARY KEY,   -- uuid token
  org_id     TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invited_by TEXT NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
  email      TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'member'
               CHECK (role IN ('owner', 'member')),
  status     TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'accepted', 'expired')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_org_invites_org   ON org_invites(org_id);
CREATE INDEX IF NOT EXISTS idx_org_invites_email ON org_invites(email);

-- Seed the owner user's personal org and default business.
INSERT OR IGNORE INTO organizations(id, name)
  VALUES ('00000000-0000-0000-0000-000000000001', 'Personal');
INSERT OR IGNORE INTO org_memberships(org_id, user_id, role)
  VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'owner');
INSERT INTO businesses(org_id, name)
  SELECT '00000000-0000-0000-0000-000000000001', 'Personal'
  WHERE NOT EXISTS (
    SELECT 1 FROM businesses
    WHERE org_id = '00000000-0000-0000-0000-000000000001' AND name = 'Personal'
  );

-- ── accounts ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id               TEXT    NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
  business_id           INTEGER          REFERENCES businesses(id),
  name                  TEXT    NOT NULL,
  bank_type             TEXT    NOT NULL,   -- mt | amex | chase | unknown | ofx
  account_kind          TEXT    NOT NULL,   -- checking | savings | credit_card
  last_statement_period TEXT    DEFAULT NULL,   -- YYYY-MM
  csv_mapping           TEXT    DEFAULT NULL,   -- JSON column-mapping config
  created_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_accounts_user     ON accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_accounts_business ON accounts(business_id);

-- ── category templates + per-business categories ─────────────────────────────
-- is_business = 0 marks personal/non-deductible spending (e.g. "Personal").
CREATE TABLE IF NOT EXISTS category_templates (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL UNIQUE,
  kind            TEXT    NOT NULL,
  tax_export_code TEXT    DEFAULT NULL,
  is_business     INTEGER NOT NULL DEFAULT 1
);

INSERT OR IGNORE INTO category_templates(name, kind, tax_export_code, is_business) VALUES
  ('Advertising & Marketing', 'expense',  'ADV',     1),
  ('Bank Fees',               'expense',  'BANK',    1),
  ('Dues & Subscriptions',    'expense',  'SUBS',    1),
  ('Equipment',               'expense',  'EQUIP',   1),
  ('Insurance',               'expense',  'INS',     1),
  ('Meals & Entertainment',   'expense',  'MEALS',   1),
  ('Office Supplies',         'expense',  'OFFICE',  1),
  ('Professional Services',   'expense',  'PROF',    1),
  ('Rent & Utilities',        'expense',  'RENT',    1),
  ('Software',                'expense',  'SOFT',    1),
  ('Travel',                  'expense',  'TRAVEL',  1),
  ('Payroll',                 'expense',  'PAY',     1),
  ('Taxes & Licenses',        'expense',  'TAX',     1),
  ('Miscellaneous',           'expense',  NULL,      1),
  ('Personal',                'expense',  NULL,      0),
  ('Sales Revenue',           'income',   'REV',     1),
  ('Consulting Revenue',      'income',   'CONSULT', 1),
  ('Other Income',            'income',   NULL,      1),
  ('Credit Card Payment',     'transfer', NULL,      1),
  ('Account Transfer',        'transfer', NULL,      1),
  ('Cash Back Rebate',        'transfer', NULL,      1);

-- Categories are now scoped to a business, not a user.
-- UNIQUE(business_id, name) replaces the old UNIQUE(user_id, name).
CREATE TABLE IF NOT EXISTS categories (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         TEXT             REFERENCES users(id)      ON DELETE CASCADE,
  business_id     INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name            TEXT    NOT NULL,
  kind            TEXT    NOT NULL,
  tax_export_code TEXT    DEFAULT NULL,
  is_business     INTEGER NOT NULL DEFAULT 1,
  UNIQUE(business_id, name)
);
CREATE INDEX IF NOT EXISTS idx_categories_user     ON categories(user_id);
CREATE INDEX IF NOT EXISTS idx_categories_business ON categories(business_id);

-- Seed the owner user's categories from templates into their personal business.
INSERT OR IGNORE INTO categories(user_id, business_id, name, kind, tax_export_code, is_business)
  SELECT
    '00000000-0000-0000-0000-000000000001',
    b.id,
    ct.name, ct.kind, ct.tax_export_code, ct.is_business
  FROM category_templates ct
  JOIN businesses b
    ON b.org_id = '00000000-0000-0000-0000-000000000001' AND b.name = 'Personal';

-- ── statements ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS statements (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         TEXT    NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
  business_id     INTEGER          REFERENCES businesses(id),
  account_id      INTEGER NOT NULL REFERENCES accounts(id)   ON DELETE CASCADE,
  period          TEXT    NOT NULL,   -- YYYY-MM
  source_pdf_path TEXT    NOT NULL,
  parser_used     TEXT    NOT NULL,   -- template | llm | ofx | csv
  imported_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_id, period)
);
CREATE INDEX IF NOT EXISTS idx_statements_user           ON statements(user_id);
CREATE INDEX IF NOT EXISTS idx_statements_business       ON statements(business_id);
CREATE INDEX IF NOT EXISTS idx_statements_account_period ON statements(account_id, period);

-- ── rules ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rules (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id             TEXT    NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
  business_id         INTEGER          REFERENCES businesses(id),
  name                TEXT    NOT NULL,
  description_pattern TEXT    NOT NULL,
  pattern_kind        TEXT    NOT NULL DEFAULT 'substring',   -- substring | regex
  amount_min          REAL    DEFAULT NULL,
  amount_max          REAL    DEFAULT NULL,
  account_id          INTEGER DEFAULT NULL REFERENCES accounts(id)    ON DELETE SET NULL,
  category_id         INTEGER NOT NULL   REFERENCES categories(id)    ON DELETE CASCADE,
  priority            INTEGER NOT NULL DEFAULT 0,
  tax_description     TEXT    DEFAULT NULL,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rules_user     ON rules(user_id);
CREATE INDEX IF NOT EXISTS idx_rules_business ON rules(business_id);
CREATE INDEX IF NOT EXISTS idx_rules_priority ON rules(priority DESC);

-- Seed common transfer / cashback auto-rules for the owner user.
INSERT OR IGNORE INTO rules(user_id, business_id, name, description_pattern, pattern_kind, category_id, priority)
SELECT '00000000-0000-0000-0000-000000000001', b.id, 'Auto: Chase payment received', 'Payment Thank You', 'substring', c.id, 100
FROM categories c
JOIN businesses b ON b.org_id = '00000000-0000-0000-0000-000000000001' AND b.name = 'Personal'
WHERE c.name = 'Credit Card Payment' AND c.business_id = b.id;

INSERT OR IGNORE INTO rules(user_id, business_id, name, description_pattern, pattern_kind, category_id, priority)
SELECT '00000000-0000-0000-0000-000000000001', b.id, 'Auto: Amex autopay', 'AUTOPAY PAYMENT', 'substring', c.id, 100
FROM categories c
JOIN businesses b ON b.org_id = '00000000-0000-0000-0000-000000000001' AND b.name = 'Personal'
WHERE c.name = 'Credit Card Payment' AND c.business_id = b.id;

INSERT OR IGNORE INTO rules(user_id, business_id, name, description_pattern, pattern_kind, category_id, priority)
SELECT '00000000-0000-0000-0000-000000000001', b.id, 'Auto: Online payment', 'ONLINE PAYMENT', 'substring', c.id, 100
FROM categories c
JOIN businesses b ON b.org_id = '00000000-0000-0000-0000-000000000001' AND b.name = 'Personal'
WHERE c.name = 'Credit Card Payment' AND c.business_id = b.id;

INSERT OR IGNORE INTO rules(user_id, business_id, name, description_pattern, pattern_kind, category_id, priority)
SELECT '00000000-0000-0000-0000-000000000001', b.id, 'Auto: Cash rebate', 'CASH REBATE', 'substring', c.id, 100
FROM categories c
JOIN businesses b ON b.org_id = '00000000-0000-0000-0000-000000000001' AND b.name = 'Personal'
WHERE c.name = 'Cash Back Rebate' AND c.business_id = b.id;

INSERT OR IGNORE INTO rules(user_id, business_id, name, description_pattern, pattern_kind, category_id, priority)
SELECT '00000000-0000-0000-0000-000000000001', b.id, 'Auto: Cash reward', 'CASH REWARD', 'substring', c.id, 100
FROM categories c
JOIN businesses b ON b.org_id = '00000000-0000-0000-0000-000000000001' AND b.name = 'Personal'
WHERE c.name = 'Cash Back Rebate' AND c.business_id = b.id;

INSERT OR IGNORE INTO rules(user_id, business_id, name, description_pattern, pattern_kind, category_id, priority)
SELECT '00000000-0000-0000-0000-000000000001', b.id, 'Auto: Cashback bonus', 'CASHBACK BONUS', 'substring', c.id, 100
FROM categories c
JOIN businesses b ON b.org_id = '00000000-0000-0000-0000-000000000001' AND b.name = 'Personal'
WHERE c.name = 'Cash Back Rebate' AND c.business_id = b.id;

INSERT OR IGNORE INTO rules(user_id, business_id, name, description_pattern, pattern_kind, category_id, priority)
SELECT '00000000-0000-0000-0000-000000000001', b.id, 'Auto: Redemption credit', 'REDEMPTION CREDIT', 'substring', c.id, 100
FROM categories c
JOIN businesses b ON b.org_id = '00000000-0000-0000-0000-000000000001' AND b.name = 'Personal'
WHERE c.name = 'Cash Back Rebate' AND c.business_id = b.id;

-- ── transactions ─────────────────────────────────────────────────────────────
-- external_hash is NOT globally unique — the same hash can appear multiple
-- times across statements for the same account. Dedup is a SELECT-based
-- check on (account_id, external_hash) in the import service layer.
CREATE TABLE IF NOT EXISTS transactions (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id               TEXT    REFERENCES users(id)      ON DELETE CASCADE,
  business_id           INTEGER REFERENCES businesses(id),
  account_id            INTEGER NOT NULL REFERENCES accounts(id)    ON DELETE CASCADE,
  statement_id          INTEGER NOT NULL REFERENCES statements(id)  ON DELETE CASCADE,
  date                  TEXT    NOT NULL,   -- YYYY-MM-DD
  description           TEXT    NOT NULL,
  amount                REAL    NOT NULL,   -- signed: negative=expense, positive=income
  category_id           INTEGER DEFAULT NULL REFERENCES categories(id) ON DELETE SET NULL,
  category_source       TEXT    DEFAULT NULL,   -- rule | suggested | manual
  suggested_category_id INTEGER DEFAULT NULL REFERENCES categories(id) ON DELETE SET NULL,
  rule_id               INTEGER DEFAULT NULL REFERENCES rules(id)       ON DELETE SET NULL,
  notes                 TEXT    DEFAULT NULL,
  tax_description       TEXT    DEFAULT NULL,
  external_hash         TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transactions_user         ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_business     ON transactions(business_id);
CREATE INDEX IF NOT EXISTS idx_transactions_account_id   ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date         ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_category_id  ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_transactions_statement_id ON transactions(statement_id);
CREATE INDEX IF NOT EXISTS idx_transactions_account_hash ON transactions(account_id, external_hash);

-- ── transaction splits ───────────────────────────────────────────────────────
-- When a transaction spans multiple categories, splits override the parent's
-- category_id for reporting purposes.
CREATE TABLE IF NOT EXISTS transaction_splits (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  category_id    INTEGER NOT NULL REFERENCES categories(id)   ON DELETE RESTRICT,
  amount         REAL    NOT NULL,   -- same sign as parent transaction
  note           TEXT    DEFAULT NULL,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_transaction_splits_tx_id ON transaction_splits(transaction_id);

-- ── receipts ─────────────────────────────────────────────────────────────────
-- Supports two storage backends: Google Drive (drive_*) and S3-compatible
-- object storage (storage_key). storage_backend discriminates which side is
-- populated; the other columns are NULL.
CREATE TABLE IF NOT EXISTS receipts (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id              TEXT    REFERENCES users(id)      ON DELETE CASCADE,
  business_id          INTEGER REFERENCES businesses(id),
  drive_file_id        TEXT    DEFAULT NULL,
  drive_file_name      TEXT    DEFAULT NULL,
  drive_mime_type      TEXT    DEFAULT NULL,
  drive_web_view_link  TEXT    DEFAULT NULL,
  drive_thumbnail_link TEXT    DEFAULT NULL,
  storage_backend      TEXT    NOT NULL DEFAULT 'drive',   -- 'drive' | 's3'
  storage_key          TEXT    DEFAULT NULL,               -- S3 object key
  content_type         TEXT    DEFAULT NULL,
  size_bytes           INTEGER DEFAULT NULL,
  original_filename    TEXT    DEFAULT NULL,
  uploaded_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_receipts_drive_file_id
  ON receipts(drive_file_id) WHERE drive_file_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_receipts_storage_key
  ON receipts(storage_key) WHERE storage_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_receipts_user     ON receipts(user_id);
CREATE INDEX IF NOT EXISTS idx_receipts_business ON receipts(business_id);

CREATE TABLE IF NOT EXISTS transaction_receipts (
  transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  receipt_id     INTEGER NOT NULL REFERENCES receipts(id)     ON DELETE CASCADE,
  linked_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (transaction_id, receipt_id)
);
CREATE INDEX IF NOT EXISTS idx_transaction_receipts_transaction ON transaction_receipts(transaction_id);
CREATE INDEX IF NOT EXISTS idx_transaction_receipts_receipt     ON transaction_receipts(receipt_id);

-- ── user_drive_tokens ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_drive_tokens (
  user_id         TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tokens_json_enc TEXT NOT NULL,   -- encrypted OAuth token JSON
  folder_id       TEXT,
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
);

-- ── ai_usage ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_usage (
  user_id TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day     TEXT    NOT NULL,   -- YYYY-MM-DD (UTC)
  count   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user_day ON ai_usage(user_id, day);

-- ── user_sessions ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_sessions (
  sid    TEXT    PRIMARY KEY,
  sess   TEXT    NOT NULL,    -- JSON-serialized session
  expire INTEGER NOT NULL     -- unix epoch ms
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expire ON user_sessions(expire);

-- ── subscriptions ────────────────────────────────────────────────────────────
-- Used only when APP_MODE=saas. Self-host installs: no rows; middleware
-- short-circuits to allow all operations.
-- Keyed by org_id so multi-business orgs share a single subscription.
CREATE TABLE IF NOT EXISTS subscriptions (
  org_id                     TEXT    PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  status                     TEXT    NOT NULL DEFAULT 'trialing'
                               CHECK (status IN ('trialing','active','past_due','canceled','incomplete')),
  plan                       TEXT    NOT NULL DEFAULT 'beta',
  tier                       TEXT    NOT NULL DEFAULT 'free'
                               CHECK (tier IN ('free','business','org')),
  seats                      INTEGER NOT NULL DEFAULT 1,
  trial_ends_at              TEXT,   -- ISO datetime (UTC)
  current_period_end         TEXT,   -- ISO datetime (UTC)
  trial_ending_email_sent_at TEXT,
  stripe_customer_id         TEXT,
  stripe_subscription_id     TEXT,
  granted_by_admin_id        TEXT    REFERENCES users(id) ON DELETE SET NULL,
  granted_at                 TEXT,
  created_at                 TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at                 TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_tier   ON subscriptions(tier);

-- ── llm_bank_hints ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS llm_bank_hints (
  bank_name         TEXT    NOT NULL PRIMARY KEY,   -- normalised (lowercase, trimmed)
  llm_hit_count     INTEGER NOT NULL DEFAULT 0,
  column_hint       TEXT,   -- JSON description from second LLM call
  hint_generated_at TEXT    -- ISO-8601 timestamp
);

-- ── security_audit_log ───────────────────────────────────────────────────────
-- Per-user security event log (auth events, credential changes, OAuth links).
-- ON DELETE SET NULL preserves forensic rows after account deletion.
CREATE TABLE IF NOT EXISTS security_audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      TEXT    REFERENCES users(id) ON DELETE SET NULL,
  action       TEXT    NOT NULL,
  ip_address   TEXT    DEFAULT NULL,
  user_agent   TEXT    DEFAULT NULL,
  payload_json TEXT    DEFAULT NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sec_audit_user    ON security_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_sec_audit_action  ON security_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_sec_audit_created ON security_audit_log(created_at);

-- ── admin_audit_log ──────────────────────────────────────────────────────────
-- Records admin-on-user actions (grant tier, extend trial, etc.).
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id  TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action         TEXT    NOT NULL,
  target_type    TEXT    DEFAULT NULL,
  target_id      TEXT    DEFAULT NULL,
  payload_json   TEXT    DEFAULT NULL,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_actor   ON admin_audit_log(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created ON admin_audit_log(created_at);

-- ── unknown_format_samples ───────────────────────────────────────────────────
-- When the parser cannot identify a PDF format, redacted metadata is queued
-- here for admin review so new bank templates can be added over time.
CREATE TABLE IF NOT EXISTS unknown_format_samples (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id        TEXT    NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  account_id    INTEGER          REFERENCES accounts(id)      ON DELETE SET NULL,
  submitted_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  redacted_text TEXT    NOT NULL,
  bank_hint     TEXT,
  page_count    INTEGER,
  file_size_kb  INTEGER,
  preview_token TEXT    UNIQUE,
  status        TEXT    NOT NULL DEFAULT 'pending',
  admin_notes   TEXT
);
CREATE INDEX IF NOT EXISTS idx_unknown_format_samples_status ON unknown_format_samples(status);
CREATE INDEX IF NOT EXISTS idx_unknown_format_samples_org    ON unknown_format_samples(org_id);
