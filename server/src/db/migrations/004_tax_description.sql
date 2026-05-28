-- Tax-audit justification description for each transaction.
-- Separate from `notes` and from the original bank `description`,
-- this field is intended to record the business purpose of an expense
-- so it can be defended in an audit.
ALTER TABLE transactions ADD COLUMN tax_description TEXT DEFAULT NULL;
