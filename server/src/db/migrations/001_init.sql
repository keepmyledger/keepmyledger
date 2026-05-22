-- 001_init.sql — consolidated initial schema for KeepMyLedger (SQLite).
--
-- This single file represents the complete schema. Fresh installs apply
-- this file once; no incremental migration files are needed.
--
-- Conventions:
--   - All primary keys are INTEGER AUTOINCREMENT (surrogate).
--   - Date/time columns are TEXT stored as ISO-8601 (datetime('now')).
--   - Amount is REAL (signed: negative = expense, positive = income).
--   - Booleans are INTEGER 0/1.

-- ── app_state ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_state (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- ── users + identities ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,   -- uuid
  email         TEXT,
  name          TEXT,
  avatar_url    TEXT,
  username      TEXT,
  password_hash TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email
  ON users(email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username
  ON users(username) WHERE username IS NOT NULL;

CREATE TABLE IF NOT EXISTS user_identities (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider         TEXT NOT NULL,   -- google | local | owner
  provider_user_id TEXT NOT NULL,
  email            TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(provider, provider_user_id)
);
CREATE INDEX IF NOT EXISTS idx_user_identities_user ON user_identities(user_id);

-- Seed the implicit "owner" user (used in self-host mode).
INSERT OR IGNORE INTO users(id, email, name)
  VALUES ('00000000-0000-0000-0000-000000000001', NULL, 'Owner');
INSERT OR IGNORE INTO user_identities(user_id, provider, provider_user_id)
  VALUES ('00000000-0000-0000-0000-000000000001', 'owner', 'owner');

-- ── TOTP ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_totp (
  user_id    TEXT    PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret     TEXT    NOT NULL,   -- base32-encoded TOTP secret (RFC 6238)
  enabled    INTEGER NOT NULL DEFAULT 0,   -- 0 = pending setup, 1 = active
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ── accounts ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  bank_type             TEXT NOT NULL,   -- mt | amex | chase | unknown
  account_kind          TEXT NOT NULL,   -- checking | savings | credit_card
  last_statement_period TEXT DEFAULT NULL,   -- YYYY-MM
  csv_mapping           TEXT DEFAULT NULL,   -- JSON column-mapping config
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id);

-- ── category templates + per-user categories ─────────────────────────────────
CREATE TABLE IF NOT EXISTS category_templates (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL UNIQUE,
  kind            TEXT NOT NULL,
  tax_export_code TEXT DEFAULT NULL
);

INSERT OR IGNORE INTO category_templates(name, kind, tax_export_code) VALUES
  ('Advertising & Marketing', 'expense',  'ADV'),
  ('Bank Fees',               'expense',  'BANK'),
  ('Dues & Subscriptions',    'expense',  'SUBS'),
  ('Equipment',               'expense',  'EQUIP'),
  ('Insurance',               'expense',  'INS'),
  ('Meals & Entertainment',   'expense',  'MEALS'),
  ('Office Supplies',         'expense',  'OFFICE'),
  ('Professional Services',   'expense',  'PROF'),
  ('Rent & Utilities',        'expense',  'RENT'),
  ('Software',                'expense',  'SOFT'),
  ('Travel',                  'expense',  'TRAVEL'),
  ('Payroll',                 'expense',  'PAY'),
  ('Taxes & Licenses',        'expense',  'TAX'),
  ('Miscellaneous',           'expense',  NULL),
  ('Sales Revenue',           'income',   'REV'),
  ('Consulting Revenue',      'income',   'CONSULT'),
  ('Other Income',            'income',   NULL),
  ('Credit Card Payment',     'transfer', NULL),
  ('Account Transfer',        'transfer', NULL),
  ('Cash Back Rebate',        'transfer', NULL);

CREATE TABLE IF NOT EXISTS categories (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  kind            TEXT NOT NULL,
  tax_export_code TEXT DEFAULT NULL,
  UNIQUE(user_id, name)
);
CREATE INDEX IF NOT EXISTS idx_categories_user ON categories(user_id);

-- Seed the owner user's categories from the templates.
INSERT OR IGNORE INTO categories(user_id, name, kind, tax_export_code)
  SELECT '00000000-0000-0000-0000-000000000001', name, kind, tax_export_code
  FROM category_templates;

-- ── statements ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS statements (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id      INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  period          TEXT NOT NULL,   -- YYYY-MM
  source_pdf_path TEXT NOT NULL,
  parser_used     TEXT NOT NULL,   -- template | llm
  imported_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_id, period)
);
CREATE INDEX IF NOT EXISTS idx_statements_user           ON statements(user_id);
CREATE INDEX IF NOT EXISTS idx_statements_account_period ON statements(account_id, period);

-- ── rules ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rules (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  description_pattern TEXT NOT NULL,
  pattern_kind        TEXT NOT NULL DEFAULT 'substring',   -- substring | regex
  amount_min          REAL    DEFAULT NULL,
  amount_max          REAL    DEFAULT NULL,
  account_id          INTEGER DEFAULT NULL REFERENCES accounts(id) ON DELETE SET NULL,
  category_id         INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  priority            INTEGER NOT NULL DEFAULT 0,
  tax_description     TEXT    DEFAULT NULL,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rules_user     ON rules(user_id);
CREATE INDEX IF NOT EXISTS idx_rules_priority ON rules(priority DESC);

-- Seed transfer / cashback auto-rules for the owner user.
INSERT OR IGNORE INTO rules(user_id, name, description_pattern, pattern_kind, category_id, priority)
SELECT '00000000-0000-0000-0000-000000000001', 'Auto: Chase payment received', 'Payment Thank You', 'substring', c.id, 100
FROM categories c WHERE c.name = 'Credit Card Payment' AND c.user_id = '00000000-0000-0000-0000-000000000001';

INSERT OR IGNORE INTO rules(user_id, name, description_pattern, pattern_kind, category_id, priority)
SELECT '00000000-0000-0000-0000-000000000001', 'Auto: Amex autopay', 'AUTOPAY PAYMENT', 'substring', c.id, 100
FROM categories c WHERE c.name = 'Credit Card Payment' AND c.user_id = '00000000-0000-0000-0000-000000000001';

INSERT OR IGNORE INTO rules(user_id, name, description_pattern, pattern_kind, category_id, priority)
SELECT '00000000-0000-0000-0000-000000000001', 'Auto: Amex online payment', 'ONLINE PAYMENT', 'substring', c.id, 100
FROM categories c WHERE c.name = 'Credit Card Payment' AND c.user_id = '00000000-0000-0000-0000-000000000001';

INSERT OR IGNORE INTO rules(user_id, name, description_pattern, pattern_kind, category_id, priority)
SELECT '00000000-0000-0000-0000-000000000001', 'Auto: M&T credit card payment', 'AMERICAN EXPRESS', 'substring', c.id, 100
FROM categories c WHERE c.name = 'Credit Card Payment' AND c.user_id = '00000000-0000-0000-0000-000000000001';

INSERT OR IGNORE INTO rules(user_id, name, description_pattern, pattern_kind, category_id, priority)
SELECT '00000000-0000-0000-0000-000000000001', 'Auto: M&T Chase payment', 'CHASE CREDIT CRD', 'substring', c.id, 100
FROM categories c WHERE c.name = 'Credit Card Payment' AND c.user_id = '00000000-0000-0000-0000-000000000001';

INSERT OR IGNORE INTO rules(user_id, name, description_pattern, pattern_kind, category_id, priority)
SELECT '00000000-0000-0000-0000-000000000001', 'Auto: Amex cash rebate', 'CASH REBATE', 'substring', c.id, 100
FROM categories c WHERE c.name = 'Cash Back Rebate' AND c.user_id = '00000000-0000-0000-0000-000000000001';

INSERT OR IGNORE INTO rules(user_id, name, description_pattern, pattern_kind, category_id, priority)
SELECT '00000000-0000-0000-0000-000000000001', 'Auto: Amex cash reward', 'CASH REWARD', 'substring', c.id, 100
FROM categories c WHERE c.name = 'Cash Back Rebate' AND c.user_id = '00000000-0000-0000-0000-000000000001';

INSERT OR IGNORE INTO rules(user_id, name, description_pattern, pattern_kind, category_id, priority)
SELECT '00000000-0000-0000-0000-000000000001', 'Auto: Chase cashback bonus', 'CASHBACK BONUS', 'substring', c.id, 100
FROM categories c WHERE c.name = 'Cash Back Rebate' AND c.user_id = '00000000-0000-0000-0000-000000000001';

INSERT OR IGNORE INTO rules(user_id, name, description_pattern, pattern_kind, category_id, priority)
SELECT '00000000-0000-0000-0000-000000000001', 'Auto: Chase redemption credit', 'REDEMPTION CREDIT', 'substring', c.id, 100
FROM categories c WHERE c.name = 'Cash Back Rebate' AND c.user_id = '00000000-0000-0000-0000-000000000001';

-- ── transactions ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transactions (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id               TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id            INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  statement_id          INTEGER NOT NULL REFERENCES statements(id) ON DELETE CASCADE,
  date                  TEXT    NOT NULL,   -- YYYY-MM-DD
  description           TEXT    NOT NULL,
  amount                REAL    NOT NULL,   -- signed: negative=expense, positive=income
  category_id           INTEGER DEFAULT NULL REFERENCES categories(id) ON DELETE SET NULL,
  category_source       TEXT    DEFAULT NULL,   -- rule | suggested | manual
  suggested_category_id INTEGER DEFAULT NULL REFERENCES categories(id) ON DELETE SET NULL,
  rule_id               INTEGER DEFAULT NULL REFERENCES rules(id) ON DELETE SET NULL,
  notes                 TEXT    DEFAULT NULL,
  tax_description       TEXT    DEFAULT NULL,
  external_hash         TEXT    NOT NULL,
  UNIQUE(external_hash)
);
CREATE INDEX IF NOT EXISTS idx_transactions_user         ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_account_id   ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date         ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_category_id  ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_transactions_statement_id ON transactions(statement_id);

-- ── receipts ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS receipts (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  drive_file_id        TEXT NOT NULL UNIQUE,
  drive_file_name      TEXT NOT NULL,
  drive_mime_type      TEXT DEFAULT NULL,
  drive_web_view_link  TEXT DEFAULT NULL,
  drive_thumbnail_link TEXT DEFAULT NULL,
  uploaded_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_receipts_user ON receipts(user_id);

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
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tokens_json TEXT NOT NULL,
  folder_id  TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
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
CREATE TABLE IF NOT EXISTS subscriptions (
  user_id                TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status                 TEXT NOT NULL DEFAULT 'trialing'
                           CHECK (status IN ('trialing','active','past_due','canceled','incomplete')),
  plan                   TEXT NOT NULL DEFAULT 'beta',
  trial_ends_at          TEXT,   -- ISO datetime (UTC)
  current_period_end     TEXT,   -- ISO datetime (UTC)
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

-- ── llm_bank_hints ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS llm_bank_hints (
  bank_name         TEXT NOT NULL PRIMARY KEY,   -- normalised (lowercase, trimmed)
  llm_hit_count     INTEGER NOT NULL DEFAULT 0,
  column_hint       TEXT,   -- JSON description from second LLM call
  hint_generated_at TEXT    -- ISO-8601 timestamp
);
