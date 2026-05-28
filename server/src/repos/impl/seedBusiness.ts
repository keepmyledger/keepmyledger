import { DbAdapter } from '../../db/adapter';

/**
 * Auto-categorization rules seeded into every new business. Mirrors the
 * owner-user seed in `db/migrations-pg/001_init.sql` and the SQLite
 * equivalents so manually-created businesses get the same out-of-the-box
 * behavior as the personal business provisioned at signup.
 */
const AUTO_RULE_TEMPLATES: ReadonlyArray<{ name: string; pattern: string; categoryName: string }> = [
  { name: 'Auto: Chase payment received',  pattern: 'Payment Thank You', categoryName: 'Credit Card Payment' },
  { name: 'Auto: Amex autopay',            pattern: 'AUTOPAY PAYMENT',   categoryName: 'Credit Card Payment' },
  { name: 'Auto: Amex online payment',     pattern: 'ONLINE PAYMENT',    categoryName: 'Credit Card Payment' },
  { name: 'Auto: M&T credit card payment', pattern: 'AMERICAN EXPRESS',  categoryName: 'Credit Card Payment' },
  { name: 'Auto: M&T Chase payment',       pattern: 'CHASE CREDIT CRD',  categoryName: 'Credit Card Payment' },
  { name: 'Auto: Amex cash rebate',        pattern: 'CASH REBATE',       categoryName: 'Cash Back Rebate' },
  { name: 'Auto: Amex cash reward',        pattern: 'CASH REWARD',       categoryName: 'Cash Back Rebate' },
  { name: 'Auto: Chase cashback bonus',    pattern: 'CASHBACK BONUS',    categoryName: 'Cash Back Rebate' },
  { name: 'Auto: Chase redemption credit', pattern: 'REDEMPTION CREDIT', categoryName: 'Cash Back Rebate' },
];

/**
 * Seed a freshly-created business with the standard category templates and
 * transfer/cashback auto-rules. Idempotent via UNIQUE(business_id, name).
 *
 * `userId` is recorded on each row's `user_id` column (the legacy ownership
 * column kept alongside `business_id` for forensic backfill).
 */
export async function seedBusinessDefaults(
  db: DbAdapter,
  businessId: number,
  userId: string,
): Promise<void> {
  await db.run(`
    INSERT INTO categories(business_id, user_id, name, kind, tax_export_code, is_business)
    SELECT ?, ?, name, kind, tax_export_code, is_business FROM category_templates WHERE true
    ON CONFLICT (business_id, name) DO NOTHING
  `, [businessId, userId]);

  for (const r of AUTO_RULE_TEMPLATES) {
    await db.run(`
      INSERT INTO rules(business_id, user_id, name, description_pattern, pattern_kind, category_id, priority)
      SELECT ?, ?, ?, ?, 'substring', c.id, 100
      FROM categories c
      WHERE c.business_id = ? AND c.name = ?
        AND NOT EXISTS (
          SELECT 1 FROM rules existing
          WHERE existing.business_id = ? AND existing.name = ?
        )
    `, [businessId, userId, r.name, r.pattern, businessId, r.categoryName, businessId, r.name]);
  }
}
