/**
 * backfillEmailHash.ts
 * --------------------
 * One-shot script to populate users.email_hash for rows that existed before
 * migration 024_email_hash.sql was applied.
 *
 * Safe to re-run (idempotent: skips rows where email_hash IS NOT NULL).
 *
 * Usage:
 *   cd server
 *   npx ts-node src/scripts/backfillEmailHash.ts
 *
 * Requires the same environment variables as the main server (DB_PATH or
 * DATABASE_URL, SESSION_SECRET / EMAIL_PEPPER).
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
import { hashEmail } from '../auth/emailHash';

async function run(): Promise<void> {
  const url = process.env.DATABASE_URL;
  let db: DbAdapter;
  let pool: Pool | null = null;

  if (url && url.startsWith('postgres')) {
    pool = await openPgDatabase(url);
    db = new PgAdapter(pool);
    console.log('[backfill] backend=pg');
  } else {
    const dbPath = process.env.DB_PATH ?? path.join(process.cwd(), 'data', 'keepmyledger.db');
    db = new SqliteAdapter(openDatabase(dbPath));
    console.log(`[backfill] backend=sqlite path=${dbPath}`);
  }

  // Guard: the plaintext email column was dropped by migration 026. Probe for
  // it so the script no-ops cleanly on any env that has already applied the drop.
  try {
    await db.get(`SELECT email FROM users LIMIT 1`, []);
  } catch {
    console.log('[backfill] users.email column no longer exists — nothing to do (migration 026 already applied)');
    await db.close?.();
    return;
  }

  const rows = await db.all<{ id: string; email: string }>(
    `SELECT id, email FROM users WHERE email_hash IS NULL AND email IS NOT NULL`,
    [],
  );

  console.log(`[backfill] ${rows.length} user(s) need email_hash populated`);

  let updated = 0;
  for (const row of rows) {
    const hash = hashEmail(row.email.toLowerCase());
    try {
      await db.run(
        'UPDATE users SET email_hash = ? WHERE id = ? AND email_hash IS NULL',
        [hash, row.id],
      );
      updated++;
    } catch (err) {
      // UNIQUE constraint violation means another row already has this hash
      // (duplicate email from a data-quality issue). Log and continue.
      console.warn(`[backfill] skipped user ${row.id}: ${(err as Error).message}`);
    }
  }

  console.log(`[backfill] done — ${updated} row(s) updated`);
  await db.close?.();
}

run().catch((err) => {
  console.error('[backfill] FAILED:', err);
  process.exit(1);
});
