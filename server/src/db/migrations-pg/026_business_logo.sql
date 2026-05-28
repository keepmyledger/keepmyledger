-- Per-business logo, stored in the same object backend as receipts.
-- The columns are nullable; a NULL logo_storage_key means "no logo set"
-- and the UI shows initials as a fallback.

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS logo_storage_key TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS logo_content_type TEXT;
