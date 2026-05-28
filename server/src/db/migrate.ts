import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';

/**
 * Runs all migration files in order. Safe to run multiple times; each
 * migration is wrapped in a transaction and skipped if already applied
 * (tracked in the `app_state` table under key `migration:<name>`).
 */
export function runMigrations(db: DatabaseSync): void {
  // Ensure app_state table exists first so we can track migrations
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_state (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const key = `migration:${file}`;
    const already = db.prepare('SELECT value FROM app_state WHERE key = ?').get(key);
    if (already) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    // FK enforcement must be off when migrations rebuild tables that have
    // inbound FKs (SQLite recipe for ALTER TABLE). PRAGMA toggles don't work
    // inside a transaction, so toggle around BEGIN/COMMIT.
    db.exec('PRAGMA foreign_keys=OFF');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT OR REPLACE INTO app_state(key, value) VALUES (?, ?)').run(key, new Date().toISOString());
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      db.exec('PRAGMA foreign_keys=ON');
      throw err;
    }
    // Verify referential integrity post-migration, then re-enable enforcement.
    const violations = db.prepare('PRAGMA foreign_key_check').all() as unknown[];
    if (violations.length > 0) {
      db.exec('PRAGMA foreign_keys=ON');
      throw new Error(`[db] Migration ${file} left FK violations: ${JSON.stringify(violations)}`);
    }
    db.exec('PRAGMA foreign_keys=ON');

    if (process.env.NODE_ENV !== 'test') {
      console.log(`[db] Applied migration: ${file}`);
    }
  }
}

/**
 * Opens (or creates) the SQLite database and applies migrations.
 */
export function openDatabase(dbPath: string): DatabaseSync {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode=WAL');
  db.exec('PRAGMA foreign_keys=ON');

  runMigrations(db);
  return db;
}
