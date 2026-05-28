/**
 * encryptExistingRows.ts
 * -----------------------
 * Backfill script that populates the `_enc` sibling columns introduced by
 * migration 025_encrypt_sensitive.sql for rows that predate that migration.
 *
 * Idempotent: rows where the target _enc column is already non-NULL are
 * skipped. Verifies round-trip decryption before writing.
 *
 * Usage:
 *   cd server
 *   npx ts-node src/scripts/encryptExistingRows.ts
 *
 * Run once after deploying migration 025. After verifying all rows are
 * encrypted, apply migration 026_drop_plaintext_sensitive.sql.
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
import { encrypt, decrypt } from '../auth/crypto';

// ─── helpers ────────────────────────────────────────────────────────────────

function encryptAndVerify(plaintext: string): string {
  const blob = encrypt(plaintext);
  const roundtripped = decrypt(blob);
  if (roundtripped !== plaintext) {
    throw new Error('[encryptExistingRows] round-trip mismatch — HALTING');
  }
  return blob;
}

// ─── tables ─────────────────────────────────────────────────────────────────

type Stats = { total: number; updated: number; skipped: number; errors: number };

async function backfillColumn(
  db: DbAdapter,
  table: string,
  idCol: string,
  plainCol: string,
  encCol: string,
): Promise<Stats> {
  const stats: Stats = { total: 0, updated: 0, skipped: 0, errors: 0 };

  const rows = await db.all<Record<string, string | null>>(
    `SELECT ${idCol}, ${plainCol} FROM ${table} WHERE ${encCol} IS NULL AND ${plainCol} IS NOT NULL`,
    [],
  );
  stats.total = rows.length;

  for (const row of rows) {
    const id = row[idCol];
    const plain = row[plainCol];
    if (!plain) { stats.skipped++; continue; }

    try {
      const blob = encryptAndVerify(plain);
      await db.run(
        `UPDATE ${table} SET ${encCol} = ? WHERE ${idCol} = ? AND ${encCol} IS NULL`,
        [blob, id],
      );
      stats.updated++;
    } catch (err) {
      console.error(`[encryptExistingRows] error on ${table}.${idCol}=${id}: ${(err as Error).message}`);
      stats.errors++;
    }
  }

  return stats;
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  const url = process.env.DATABASE_URL;
  let db: DbAdapter;
  let pool: Pool | null = null;

  if (url && url.startsWith('postgres')) {
    pool = await openPgDatabase(url);
    db = new PgAdapter(pool);
    console.log('[encryptExistingRows] backend=pg');
  } else {
    const dbPath = process.env.DB_PATH ?? path.join(process.cwd(), 'data', 'keepmyledger.db');
    db = new SqliteAdapter(openDatabase(dbPath));
    console.log(`[encryptExistingRows] backend=sqlite path=${dbPath}`);
  }

  // Guard: the plaintext columns were dropped by migration 026/020. Probe for
  // users.email so the script no-ops cleanly on any env past that migration.
  try {
    await db.get(`SELECT email FROM users LIMIT 1`, []);
  } catch {
    console.log('[encryptExistingRows] plaintext columns no longer exist — nothing to do (migration 026/020 already applied)');
    await db.close?.();
    return;
  }

  const jobs: Array<[string, string, string, string]> = [
    ['users',             'id',      'email',       'email_enc'],
    ['users',             'id',      'name',        'name_enc'],
    ['user_drive_tokens', 'user_id', 'tokens_json', 'tokens_json_enc'],
    ['user_totp',         'user_id', 'secret',      'secret_enc'],
  ];

  for (const [table, idCol, plainCol, encCol] of jobs) {
    const s = await backfillColumn(db, table, idCol, plainCol, encCol);
    console.log(
      `[encryptExistingRows] ${table}.${encCol}: ` +
      `${s.updated} updated, ${s.skipped} skipped, ${s.errors} errors (${s.total} total)`,
    );
    if (s.errors > 0) {
      console.error('[encryptExistingRows] ERRORS ENCOUNTERED — review output before proceeding');
      process.exitCode = 1;
    }
  }

  await db.close?.();
  console.log('[encryptExistingRows] done');
}

run().catch((err) => {
  console.error('[encryptExistingRows] FATAL:', err);
  process.exit(1);
});
