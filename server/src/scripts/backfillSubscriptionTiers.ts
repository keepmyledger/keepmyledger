/**
 * backfillSubscriptionTiers.ts
 * ----------------------------
 * One-shot script to derive the `tier` column on existing subscription rows
 * that were present before migration 028_subscription_tiers.sql (SQLite) /
 * 022_subscription_tiers.sql (Postgres) added the column.
 *
 * The migration sets `tier DEFAULT 'free'`, so all pre-existing rows land on
 * 'free'. Subscriptions that were previously on a paid plan need to be updated
 * to 'business' or 'org'.
 *
 * Plan mapping (case-insensitive, applied in order):
 *   plan containing 'org'               → tier = 'org',      seats = 3
 *   plan containing 'business'          → tier = 'business', seats = 1
 *   plan = 'monthly' | 'annual'         → tier = 'business', seats = 1
 *     (pre-PR code wrote plan='monthly'/'annual', and only 'business' existed
 *      at that time, so these are unambiguously business-tier rows)
 *   anything else                       → leave as 'free'   (no change)
 *
 * The SELECT also catches rows with stripe_subscription_id IS NOT NULL as a
 * secondary signal — a row that has a Stripe sub ID must have been paid at
 * some point, even if its plan string doesn't match any of the above patterns.
 *
 * Safe to re-run (idempotent: only updates rows where tier = 'free' and plan
 * implies a paid tier, so rows already corrected are skipped).
 *
 * Usage:
 *   cd server
 *   npx ts-node src/scripts/backfillSubscriptionTiers.ts
 *
 * For Postgres:
 *   DATABASE_URL=postgres://... npx ts-node src/scripts/backfillSubscriptionTiers.ts
 */

import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

import { Pool } from 'pg';
import { openDatabase } from '../db/migrate';
import { openPgDatabase } from '../db/migratePg';
import { SqliteAdapter } from '../db/adapter/SqliteAdapter';
import { PgAdapter } from '../db/adapter/PgAdapter';
import type { DbAdapter } from '../db/adapter';

/**
 * Core backfill logic — exported for unit testing.
 * Returns the number of rows updated.
 */
export async function backfillTiers(db: DbAdapter): Promise<number> {
  // Widen the candidate set: rows where tier is still 'free' AND either the
  // plan string suggests a paid tier OR a Stripe subscription ID exists
  // (meaning the user was billed at some point).
  const rows = await db.all<{ org_id: string; plan: string | null; stripe_subscription_id: string | null }>(
    `SELECT org_id, plan, stripe_subscription_id
     FROM subscriptions
     WHERE tier = 'free'
       AND (plan IS NOT NULL OR stripe_subscription_id IS NOT NULL)`,
    [],
  );

  let updated = 0;
  const now = new Date().toISOString();

  for (const row of rows) {
    const planLower = (row.plan ?? '').toLowerCase();
    let newTier: 'business' | 'org' | null = null;

    if (planLower.includes('org')) {
      // Check org first since 'org' is more specific.
      newTier = 'org';
    } else if (planLower.includes('business')) {
      newTier = 'business';
    } else if (planLower === 'monthly' || planLower === 'annual') {
      // Pre-PR code wrote plan='monthly' or plan='annual'.  Only the business
      // tier existed at that time, so these rows are unambiguously business.
      newTier = 'business';
    } else if (row.stripe_subscription_id) {
      // Has a Stripe sub but an unrecognised plan string — assume business
      // (the only paid tier before this PR) rather than leaving it as free.
      newTier = 'business';
    }

    if (!newTier) continue; // leave as 'free'

    const seats = newTier === 'org' ? 3 : 1; // org gets minimum included seats
    await db.run(
      `UPDATE subscriptions SET tier = ?, seats = ?, updated_at = ? WHERE org_id = ?`,
      [newTier, seats, now, row.org_id],
    );
    console.log(`[backfill-tiers] org_id=${row.org_id} plan=${row.plan} → tier=${newTier} seats=${seats}`);
    updated++;
  }

  return updated;
}

async function run(): Promise<void> {
  const url = process.env.DATABASE_URL;
  let db: DbAdapter;
  let pool: Pool | null = null;

  if (url && url.startsWith('postgres')) {
    pool = await openPgDatabase(url);
    db = new PgAdapter(pool);
    console.log('[backfill-tiers] backend=pg');
  } else {
    const dbPath = process.env.DB_PATH ?? path.join(process.cwd(), 'data', 'keepmyledger.db');
    const raw = openDatabase(dbPath);
    db = new SqliteAdapter(raw);
    console.log(`[backfill-tiers] backend=sqlite path=${dbPath}`);

    const updated = await backfillTiers(db);
    console.log(`[backfill-tiers] done. ${updated} row(s) updated.`);
    raw.close();
    return;
  }

  const updated = await backfillTiers(db);
  console.log(`[backfill-tiers] done. ${updated} row(s) updated.`);
  await pool!.end();
}

// Only invoke when executed directly (not when imported by tests or other modules).
if (require.main === module) {
  run().catch(err => {
    console.error('[backfill-tiers] fatal:', err);
    process.exit(1);
  });
}
