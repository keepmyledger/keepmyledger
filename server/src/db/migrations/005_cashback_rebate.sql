-- Cash-back rebates from credit cards are treated as a purchase-price
-- adjustment, not income (IRS Rev. Rul. 76-96). Categorize as a transfer
-- so they appear in the ledger but are excluded from P&L / tax reports.
INSERT OR IGNORE INTO categories (name, kind) VALUES ('Cash Back Rebate', 'transfer');

INSERT OR IGNORE INTO rules (name, description_pattern, pattern_kind, category_id, priority)
SELECT 'Auto: Amex cash rebate', 'CASH REBATE', 'substring', c.id, 100
FROM categories c WHERE c.name = 'Cash Back Rebate' AND c.kind = 'transfer';

INSERT OR IGNORE INTO rules (name, description_pattern, pattern_kind, category_id, priority)
SELECT 'Auto: Amex cash reward', 'CASH REWARD', 'substring', c.id, 100
FROM categories c WHERE c.name = 'Cash Back Rebate' AND c.kind = 'transfer';

INSERT OR IGNORE INTO rules (name, description_pattern, pattern_kind, category_id, priority)
SELECT 'Auto: Chase cashback bonus', 'CASHBACK BONUS', 'substring', c.id, 100
FROM categories c WHERE c.name = 'Cash Back Rebate' AND c.kind = 'transfer';

INSERT OR IGNORE INTO rules (name, description_pattern, pattern_kind, category_id, priority)
SELECT 'Auto: Chase redemption credit', 'REDEMPTION CREDIT', 'substring', c.id, 100
FROM categories c WHERE c.name = 'Cash Back Rebate' AND c.kind = 'transfer';
