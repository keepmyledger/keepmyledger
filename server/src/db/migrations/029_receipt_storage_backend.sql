-- 029_receipt_storage_backend.sql (SQLite)
-- Allow receipts to live in either Google Drive (existing) or S3-compatible
-- object storage (new). Old rows are all Drive-backed; new S3 rows leave the
-- drive_* columns NULL.
--
-- SQLite can't drop NOT NULL or UNIQUE in place, so rebuild the table.

PRAGMA foreign_keys=OFF;

CREATE TABLE receipts__new (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id              TEXT    REFERENCES users(id) ON DELETE CASCADE,
  business_id          INTEGER REFERENCES businesses(id),
  drive_file_id        TEXT    DEFAULT NULL,
  drive_file_name      TEXT    DEFAULT NULL,
  drive_mime_type      TEXT    DEFAULT NULL,
  drive_web_view_link  TEXT    DEFAULT NULL,
  drive_thumbnail_link TEXT    DEFAULT NULL,
  storage_backend      TEXT    NOT NULL DEFAULT 'drive',
  storage_key          TEXT    DEFAULT NULL,
  content_type         TEXT    DEFAULT NULL,
  size_bytes           INTEGER DEFAULT NULL,
  original_filename    TEXT    DEFAULT NULL,
  uploaded_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO receipts__new (
  id, user_id, business_id,
  drive_file_id, drive_file_name, drive_mime_type, drive_web_view_link, drive_thumbnail_link,
  storage_backend, uploaded_at
)
SELECT
  id, user_id, business_id,
  drive_file_id, drive_file_name, drive_mime_type, drive_web_view_link, drive_thumbnail_link,
  'drive', uploaded_at
FROM receipts;

DROP TABLE receipts;
ALTER TABLE receipts__new RENAME TO receipts;

-- Drive file ids stay unique when present; NULL allowed for S3 rows.
CREATE UNIQUE INDEX idx_receipts_drive_file_id
  ON receipts(drive_file_id) WHERE drive_file_id IS NOT NULL;
CREATE UNIQUE INDEX idx_receipts_storage_key
  ON receipts(storage_key) WHERE storage_key IS NOT NULL;
CREATE INDEX idx_receipts_user     ON receipts(user_id);
CREATE INDEX idx_receipts_business ON receipts(business_id);

PRAGMA foreign_keys=ON;
