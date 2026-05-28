-- Per-account CSV column mapping (JSON). When set, the import preview will
-- pre-apply this mapping so repeat imports from the same bank skip the
-- column-mapping UI step.
ALTER TABLE accounts ADD COLUMN csv_mapping JSONB;
