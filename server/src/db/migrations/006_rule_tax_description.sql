-- Add optional tax_description column to rules.
-- When a rule matches, the value is copied to transactions.tax_description
-- (only if the transaction doesn't already have one).
ALTER TABLE rules ADD COLUMN tax_description TEXT DEFAULT NULL;
