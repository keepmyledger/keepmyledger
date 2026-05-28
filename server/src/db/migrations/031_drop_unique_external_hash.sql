-- Drop the global UNIQUE constraint on transactions.external_hash so legit
-- in-file duplicates (e.g. two $5 coffees on the same day) can coexist.
-- Cross-import dedup moves to a SELECT-based check in the service layer.
--
-- SQLite doesn't support DROP CONSTRAINT, so this requires a full table
-- rebuild. The rebuild preserves all rows and recreates every index added
-- by prior migrations; the only structural change is the absence of the
-- UNIQUE(external_hash) clause and a new (account_id, external_hash)
-- lookup index for the new SELECT-based dedup path.

PRAGMA foreign_keys = OFF;

CREATE TABLE transactions_new (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id            INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  statement_id          INTEGER NOT NULL REFERENCES statements(id) ON DELETE CASCADE,
  date                  TEXT    NOT NULL,
  description           TEXT    NOT NULL,
  amount                REAL    NOT NULL,
  category_id           INTEGER DEFAULT NULL REFERENCES categories(id) ON DELETE SET NULL,
  category_source       TEXT    DEFAULT NULL,
  suggested_category_id INTEGER DEFAULT NULL REFERENCES categories(id) ON DELETE SET NULL,
  rule_id               INTEGER DEFAULT NULL REFERENCES rules(id) ON DELETE SET NULL,
  notes                 TEXT    DEFAULT NULL,
  external_hash         TEXT    NOT NULL,
  tax_description       TEXT    DEFAULT NULL,
  user_id               TEXT    REFERENCES users(id) ON DELETE CASCADE,
  business_id           INTEGER REFERENCES businesses(id)
);

INSERT INTO transactions_new (
  id, account_id, statement_id, date, description, amount,
  category_id, category_source, suggested_category_id, rule_id,
  notes, external_hash, tax_description, user_id, business_id
)
SELECT
  id, account_id, statement_id, date, description, amount,
  category_id, category_source, suggested_category_id, rule_id,
  notes, external_hash, tax_description, user_id, business_id
FROM transactions;

DROP TABLE transactions;
ALTER TABLE transactions_new RENAME TO transactions;

-- Recreate every index that existed on the old table (see migrations 001, 007, 023).
CREATE INDEX IF NOT EXISTS idx_transactions_account_id   ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date         ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_category_id  ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_transactions_statement_id ON transactions(statement_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user         ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_business     ON transactions(business_id);
-- New: fast lookup key for SELECT-based dedup in importService.persistParsed.
CREATE INDEX IF NOT EXISTS idx_transactions_account_hash ON transactions(account_id, external_hash);

PRAGMA foreign_keys = ON;
