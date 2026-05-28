-- 023_receipt_storage_backend.sql (Postgres)
-- Allow receipts to live in either Google Drive (existing) or S3-compatible
-- object storage (new). Old rows are all Drive-backed; new S3 rows leave the
-- drive_* columns NULL.

ALTER TABLE receipts ADD COLUMN IF NOT EXISTS storage_backend   TEXT;
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS storage_key       TEXT;
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS content_type      TEXT;
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS size_bytes        BIGINT;
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS original_filename TEXT;

UPDATE receipts SET storage_backend = 'drive' WHERE storage_backend IS NULL;

ALTER TABLE receipts ALTER COLUMN storage_backend SET NOT NULL;
ALTER TABLE receipts ALTER COLUMN storage_backend SET DEFAULT 'drive';

-- Drive file id was UNIQUE NOT NULL; relax both so S3 rows can leave it null,
-- and replace the strict unique with a partial index.
ALTER TABLE receipts ALTER COLUMN drive_file_id   DROP NOT NULL;
ALTER TABLE receipts ALTER COLUMN drive_file_name DROP NOT NULL;

DO $$
DECLARE
  ucon TEXT;
BEGIN
  SELECT conname INTO ucon
  FROM pg_constraint
  WHERE conrelid = 'receipts'::regclass
    AND contype = 'u'
    AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'receipts'::regclass AND attname = 'drive_file_id')];
  IF ucon IS NOT NULL THEN
    EXECUTE format('ALTER TABLE receipts DROP CONSTRAINT %I', ucon);
  END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_receipts_drive_file_id
  ON receipts(drive_file_id) WHERE drive_file_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_receipts_storage_key
  ON receipts(storage_key) WHERE storage_key IS NOT NULL;
