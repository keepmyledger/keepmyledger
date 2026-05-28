-- Drop the global UNIQUE constraint on transactions.external_hash so legit
-- in-file duplicates can coexist. Cross-import dedup moves to a SELECT-based
-- check in the service layer.
--
-- Postgres named the implicit unique constraint `transactions_external_hash_key`
-- (the default for `column TYPE UNIQUE` syntax). DROP CONSTRAINT IF EXISTS is
-- a no-op when the constraint was already removed by an out-of-band script.

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_external_hash_key;

-- New: fast lookup key for SELECT-based dedup in importService.persistParsed.
CREATE INDEX IF NOT EXISTS idx_transactions_account_hash ON transactions(account_id, external_hash);
