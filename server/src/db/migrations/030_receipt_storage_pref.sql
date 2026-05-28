-- 030_receipt_storage_pref.sql (SQLite)
-- Per-user choice between KML's S3-backed storage and the user's own Google
-- Drive. NULL = follow server default (kml when SaaS + S3 configured, else drive).

ALTER TABLE users ADD COLUMN receipt_storage_preference TEXT DEFAULT NULL;
