import { Pool, PoolClient } from 'pg';
import { DbAdapter } from '../adapter';

/** Rewrite ?, ?, ? placeholders to $1, $2, $3 for Postgres. */
function pgify(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

type Queryable = Pool | PoolClient;

class PgAdapterBase implements DbAdapter {
  readonly backend = 'pg' as const;

  constructor(protected client: Queryable, private isTx = false) {}

  async exec(sql: string): Promise<void> {
    // exec is used for multi-statement migration SQL; pg handles that fine
    // when no params are supplied. Do NOT pgify (no `?` should appear).
    await this.client.query(sql);
  }

  async all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const r = await this.client.query(pgify(sql), params as unknown[]);
    return r.rows as T[];
  }

  async get<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    const r = await this.client.query(pgify(sql), params as unknown[]);
    return r.rows[0] as T | undefined;
  }

  async run(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
    const r = await this.client.query(pgify(sql), params as unknown[]);
    return { changes: r.rowCount ?? 0 };
  }

  async transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
    if (this.isTx) return fn(this); // already inside a tx — just run inline
    if (!('connect' in this.client)) {
      throw new Error('PgAdapter.transaction can only start a new tx from a pool');
    }
    const pool = this.client as Pool;
    const c = await pool.connect();
    const tx = new PgAdapterBase(c, true);
    try {
      await c.query('BEGIN');
      const out = await fn(tx);
      await c.query('COMMIT');
      return out;
    } catch (err) {
      await c.query('ROLLBACK');
      throw err;
    } finally {
      c.release();
    }
  }

  async close(): Promise<void> {
    if ('end' in this.client) {
      await (this.client as Pool).end();
    }
  }
}

export class PgAdapter extends PgAdapterBase {
  constructor(pool: Pool) {
    super(pool, false);
  }
}
