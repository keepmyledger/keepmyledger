-- 024_receipt_storage_pref.sql (Postgres)
-- Per-user choice between KML's S3-backed storage and the user's own Google
-- Drive. NULL = follow server default (kml when SaaS + S3 configured, else drive).

ALTER TABLE users ADD COLUMN IF NOT EXISTS receipt_storage_preference TEXT;
