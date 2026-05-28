-- 015_transaction_splits.sql
-- Stores category/amount allocations when a single transaction spans multiple categories.
-- When splits exist the parent transaction's category_id is ignored for reporting.

CREATE TABLE IF NOT EXISTS transaction_splits (
  id             SERIAL  PRIMARY KEY,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  category_id    INTEGER NOT NULL REFERENCES categories(id)   ON DELETE RESTRICT,
  amount         NUMERIC(12,4) NOT NULL, -- same sign as parent transaction
  note           TEXT    DEFAULT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transaction_splits_tx_id ON transaction_splits(transaction_id);
