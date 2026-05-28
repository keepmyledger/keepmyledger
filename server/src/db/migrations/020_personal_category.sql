-- Migration 020: add is_business flag to categories and seed Personal category
-- is_business = 1 means the category counts as a business expense (default).
-- is_business = 0 marks personal/non-deductible spending.

-- 1. Add is_business column to category_templates -------------------------
ALTER TABLE category_templates ADD COLUMN is_business INTEGER NOT NULL DEFAULT 1;

-- 2. Add is_business column to categories ---------------------------------
ALTER TABLE categories ADD COLUMN is_business INTEGER NOT NULL DEFAULT 1;

-- 3. Add Personal template (is_business = 0) -------------------------------
INSERT OR IGNORE INTO category_templates(name, kind, tax_export_code, is_business)
VALUES ('Personal', 'expense', NULL, 0);

-- 4. Backfill Personal category for all existing users who don't have it ---
INSERT OR IGNORE INTO categories(user_id, name, kind, tax_export_code, is_business)
SELECT u.id, 'Personal', 'expense', NULL, 0
FROM users u
WHERE NOT EXISTS (
  SELECT 1 FROM categories c WHERE c.user_id = u.id AND c.name = 'Personal'
);
