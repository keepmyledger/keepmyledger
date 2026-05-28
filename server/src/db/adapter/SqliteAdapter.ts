import { DatabaseSync } from 'node:sqlite';
import { DbAdapter } from '../adapter';

/**
 * Wraps `node:sqlite`'s synchronous `DatabaseSync` in the async DbAdapter
 * interface. Calls remain synchronous under the hood; we just return
 * already-resolved promises so the rest of the code can be uniformly async.
 */
export class SqliteAdapter implements DbAdapter {
  readonly backend = 'sqlite' as const;

  constructor(private db: DatabaseSync) {}

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...(params as (string | number | null)[])) as T[];
  }

  async get<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return this.db.prepare(sql).get(...(params as (string | number | null)[])) as T | undefined;
  }

  async run(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
    const result = this.db.prepare(sql).run(...(params as (string | number | null)[]));
    return { changes: Number(result.changes) };
  }

  async transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
    this.db.exec('BEGIN');
    try {
      const out = await fn(this);
      this.db.exec('COMMIT');
      return out;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
