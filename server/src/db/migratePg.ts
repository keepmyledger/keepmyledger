import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';

/**
 * Postgres migration runner. Mirrors the sqlite runner in `./migrate.ts`:
 *   - Ensures `app_state(key, value)` exists
 *   - Walks files under ./migrations-pg in sorted order
 *   - Skips any already recorded under `migration:<filename>`
 *   - Runs each file in a single transaction
 */
export async function runPgMigrations(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  const dir = path.join(__dirname, 'migrations-pg');
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const key = `migration:${file}`;
    const existing = await pool.query('SELECT value FROM app_state WHERE key = $1', [key]);
    if (existing.rows.length > 0) continue;

    const sql = fs.readFileSync(path.join(dir, file), 'utf-8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO app_state(key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
        [key, new Date().toISOString()]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    if (process.env.NODE_ENV !== 'test') {
      console.log(`[db:pg] Applied migration: ${file}`);
    }
  }
}

/**
 * Open a Postgres pool from `DATABASE_URL` and run migrations.
 */
export async function openPgDatabase(connectionString: string): Promise<Pool> {
  const pool = new Pool({ connectionString });
  await runPgMigrations(pool);
  return pool;
}
