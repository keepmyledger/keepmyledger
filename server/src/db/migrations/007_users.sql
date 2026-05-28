-- 007_users.sql
-- Adds users + user_identities and threads user_id through every tenant-scoped
-- table. For self-host / pre-existing installs, a deterministic "owner" user is
-- created and existing rows are backfilled to that user.
--
-- The migration runner toggles PRAGMA foreign_keys OFF for the duration of each
-- migration and verifies referential integrity via PRAGMA foreign_key_check on
-- success, so the categories table rebuild below is safe.

-- 1. New auth tables ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,             -- uuid
  email      TEXT,
  name       TEXT,
  avatar_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS user_identities (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider         TEXT NOT NULL,          -- google | facebook | apple | owner
  provider_user_id TEXT NOT NULL,
  email            TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(provider, provider_user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_identities_user ON user_identities(user_id);

-- 2. Seed the implicit "owner" user (used in self-host mode) -----------------
INSERT OR IGNORE INTO users(id, email, name) VALUES
  ('00000000-0000-0000-0000-000000000001', NULL, 'Owner');

INSERT OR IGNORE INTO user_identities(user_id, provider, provider_user_id)
  VALUES ('00000000-0000-0000-0000-000000000001', 'owner', 'owner');

-- 3. Add user_id to tenant-scoped tables (nullable; backfilled below) --------
ALTER TABLE accounts     ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE statements   ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE rules        ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE transactions ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE receipts     ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE;

UPDATE accounts     SET user_id = '00000000-0000-0000-0000-000000000001' WHERE user_id IS NULL;
UPDATE statements   SET user_id = '00000000-0000-0000-0000-000000000001' WHERE user_id IS NULL;
UPDATE rules        SET user_id = '00000000-0000-0000-0000-000000000001' WHERE user_id IS NULL;
UPDATE transactions SET user_id = '00000000-0000-0000-0000-000000000001' WHERE user_id IS NULL;
UPDATE receipts     SET user_id = '00000000-0000-0000-0000-000000000001' WHERE user_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_accounts_user     ON accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_statements_user   ON statements(user_id);
CREATE INDEX IF NOT EXISTS idx_rules_user        ON rules(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_receipts_user     ON receipts(user_id);

-- 4. Category templates (cloned per user on signup) --------------------------
CREATE TABLE IF NOT EXISTS category_templates (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL UNIQUE,
  kind            TEXT NOT NULL,
  tax_export_code TEXT DEFAULT NULL
);

INSERT OR IGNORE INTO category_templates(name, kind, tax_export_code)
  SELECT name, kind, tax_export_code FROM categories;

-- 5. Rebuild `categories` with (user_id, name) uniqueness --------------------
CREATE TABLE categories_new (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  kind            TEXT NOT NULL,
  tax_export_code TEXT DEFAULT NULL,
  UNIQUE(user_id, name)
);

INSERT INTO categories_new(id, user_id, name, kind, tax_export_code)
  SELECT id, '00000000-0000-0000-0000-000000000001', name, kind, tax_export_code
  FROM categories;

DROP TABLE categories;
ALTER TABLE categories_new RENAME TO categories;

CREATE INDEX IF NOT EXISTS idx_categories_user ON categories(user_id);
