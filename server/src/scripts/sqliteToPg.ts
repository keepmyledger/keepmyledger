/**
 * sqlite → Postgres data migration.
 *
 *   node --experimental-sqlite dist/scripts/sqliteToPg.js [--reset]
 *
 * Reads the sqlite DB at DB_PATH (defaults to data/keepmyledger.db) and
 * copies every row into the Postgres instance pointed at by DATABASE_URL,
 * preserving primary keys. Sequences are rewound so future inserts continue
 * from MAX(id) + 1.
 *
 *   --reset   TRUNCATE all destination tables (CASCADE) before copying.
 *             Without this flag the script will refuse to run if any
 *             destination table already has rows (other than seed data).
 *
 * Tables migrated, in FK-safe order:
 *   users → user_identities → accounts → categories → statements
 *   → rules → transactions → receipts → transaction_receipts
 *
 * category_templates is *not* touched; it is seeded by the PG schema and
 * never referenced by sqlite. The owner's per-user `categories` rows are
 * copied verbatim from sqlite, which means the seeded owner categories
 * created by 001_init.sql in PG will be replaced wholesale.
 */
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { Pool } from 'pg';

const TABLES_IN_ORDER = [
  'users',
  'user_identities',
  'accounts',
  'categories',
  'statements',
  'rules',
  'transactions',
  'receipts',
  'transaction_receipts',
  'user_drive_tokens',
] as const;

const SEQUENCE_TABLES = [
  'user_identities',
  'accounts',
  'categories',
  'statements',
  'rules',
  'transactions',
  'receipts',
] as const;

function dbPath(): string {
  if (process.env.DB_PATH) return process.env.DB_PATH;
  return path.join(process.cwd(), 'data', 'keepmyledger.db');
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required.');
    process.exit(2);
  }
  const reset = process.argv.includes('--reset');

  const sqlite = new DatabaseSync(dbPath());
  sqlite.exec('PRAGMA foreign_keys=ON');
  const pool = new Pool({ connectionString: url });
  const pg = await pool.connect();

  try {
    await pg.query('BEGIN');

    if (reset) {
      console.log('[reset] TRUNCATE users CASCADE (clears all per-user data)');
      await pg.query('TRUNCATE TABLE users RESTART IDENTITY CASCADE');
    } else {
      for (const t of TABLES_IN_ORDER) {
        if (t === 'categories') continue; // seeded by migration
        const { rows } = await pg.query(`SELECT COUNT(*)::int AS n FROM ${t}`);
        if (rows[0].n > 0) {
          throw new Error(
            `destination table "${t}" already has ${rows[0].n} rows. ` +
              `Re-run with --reset to wipe and re-import.`
          );
        }
      }
      // Categories may be pre-seeded for the owner; if any non-owner rows
      // exist we still refuse. Owner categories will be replaced regardless.
      const { rows: catRows } = await pg.query(
        `SELECT COUNT(*)::int AS n FROM categories WHERE user_id <> $1`,
        ['00000000-0000-0000-0000-000000000001']
      );
      if (catRows[0].n > 0) {
        throw new Error(`categories has ${catRows[0].n} non-owner rows; use --reset.`);
      }
      // Clear owner seed so sqlite ids transfer cleanly.
      console.log('[clean] removing seeded owner categories so sqlite ids transfer cleanly');
      await pg.query(`DELETE FROM rules WHERE user_id = $1`, ['00000000-0000-0000-0000-000000000001']);
      await pg.query(`DELETE FROM categories WHERE user_id = $1`, ['00000000-0000-0000-0000-000000000001']);
    }

    for (const table of TABLES_IN_ORDER) {
      const rows = sqlite.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[];
      if (rows.length === 0) {
        console.log(`[copy] ${table.padEnd(22)} 0 rows`);
        continue;
      }
      // For the owner user, ON CONFLICT (id) DO NOTHING: the truncate path
      // clears it but the non-reset path leaves the migration-seeded row.
      const cols = Object.keys(rows[0]);
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(',');
      const conflictTarget = table === 'transaction_receipts'
        ? '(transaction_id, receipt_id)'
        : '(id)';
      const sql = `
        INSERT INTO ${table} (${cols.join(',')})
        VALUES (${placeholders})
        ON CONFLICT ${conflictTarget} DO NOTHING
      `;
      let inserted = 0;
      let skipped = 0;
      for (const row of rows) {
        const values = cols.map((c) => row[c]);
        const r = await pg.query(sql, values);
        if (r.rowCount === 1) inserted++;
        else skipped++;
      }
      console.log(`[copy] ${table.padEnd(22)} inserted=${inserted} skipped=${skipped}`);
    }

    // Resync identity sequences so the next INSERT picks an unused id.
    for (const table of SEQUENCE_TABLES) {
      // pg_get_serial_sequence works for IDENTITY columns too.
      await pg.query(`
        SELECT setval(
          pg_get_serial_sequence('${table}', 'id'),
          COALESCE((SELECT MAX(id) FROM ${table}), 1),
          (SELECT MAX(id) FROM ${table}) IS NOT NULL
        )
      `);
    }
    console.log('[sequences] resynced');

    await pg.query('COMMIT');
    console.log('[done] migration complete');
  } catch (err) {
    await pg.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    pg.release();
    await pool.end();
    sqlite.close();
  }
}

main().catch((err) => {
  console.error('[sqlite→pg] FAILED:', err);
  process.exit(1);
});
