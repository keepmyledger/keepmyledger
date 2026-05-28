-- 002_receipts.sql
-- Replaces the has_receipt boolean with a proper receipts table (many-to-many).

CREATE TABLE IF NOT EXISTS receipts (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  drive_file_id       TEXT    NOT NULL UNIQUE,
  drive_file_name     TEXT    NOT NULL,
  drive_mime_type     TEXT    DEFAULT NULL,
  drive_web_view_link TEXT    DEFAULT NULL,
  drive_thumbnail_link TEXT   DEFAULT NULL,
  uploaded_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transaction_receipts (
  transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  receipt_id     INTEGER NOT NULL REFERENCES receipts(id)     ON DELETE CASCADE,
  linked_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (transaction_id, receipt_id)
);

CREATE INDEX IF NOT EXISTS idx_transaction_receipts_transaction ON transaction_receipts(transaction_id);
CREATE INDEX IF NOT EXISTS idx_transaction_receipts_receipt     ON transaction_receipts(receipt_id);

-- Drop the old boolean column (requires SQLite >= 3.35, bundled in Node 22+)
ALTER TABLE transactions DROP COLUMN has_receipt;
