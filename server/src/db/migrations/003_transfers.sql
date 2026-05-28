-- 003_transfers.sql
-- Add a "transfer" category for inter-account moves (e.g., credit-card payments
-- that appear on both the bank statement and the credit card statement). These
-- categories are excluded from expense/income reports.

INSERT OR IGNORE INTO categories(name, kind, tax_export_code) VALUES
  ('Credit Card Payment', 'transfer', NULL),
  ('Account Transfer',    'transfer', NULL);

-- Seed rules for common credit-card payment descriptions. Pattern is matched
-- case-insensitively as a substring of the transaction description. Rules are
-- only created here for the seed transfer category; if the user renames or
-- deletes the category later, these rules can be edited/removed normally.
INSERT OR IGNORE INTO rules(name, description_pattern, pattern_kind, category_id, priority, created_at)
SELECT 'Auto: Chase payment received',     'Payment Thank You',       'substring', c.id, 100, datetime('now') FROM categories c WHERE c.name = 'Credit Card Payment' AND c.kind = 'transfer';
INSERT OR IGNORE INTO rules(name, description_pattern, pattern_kind, category_id, priority, created_at)
SELECT 'Auto: Amex autopay',               'AUTOPAY PAYMENT',         'substring', c.id, 100, datetime('now') FROM categories c WHERE c.name = 'Credit Card Payment' AND c.kind = 'transfer';
INSERT OR IGNORE INTO rules(name, description_pattern, pattern_kind, category_id, priority, created_at)
SELECT 'Auto: Amex online payment',        'ONLINE PAYMENT',          'substring', c.id, 100, datetime('now') FROM categories c WHERE c.name = 'Credit Card Payment' AND c.kind = 'transfer';
INSERT OR IGNORE INTO rules(name, description_pattern, pattern_kind, category_id, priority, created_at)
SELECT 'Auto: M&T credit card payment',    'AMERICAN EXPRESS',        'substring', c.id, 100, datetime('now') FROM categories c WHERE c.name = 'Credit Card Payment' AND c.kind = 'transfer';
INSERT OR IGNORE INTO rules(name, description_pattern, pattern_kind, category_id, priority, created_at)
SELECT 'Auto: M&T Chase payment',          'CHASE CREDIT CRD',        'substring', c.id, 100, datetime('now') FROM categories c WHERE c.name = 'Credit Card Payment' AND c.kind = 'transfer';
