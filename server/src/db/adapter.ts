/**
 * Storage-engine-agnostic database adapter used by all repos.
 *
 * Both SQLite (`node:sqlite`) and Postgres (`pg`) have wrappers under
 * `./adapter/`. Repos depend only on this interface so a single
 * implementation works for both backends.
 *
 * SQL conventions:
 *   - Use `?` placeholders everywhere. The Postgres adapter rewrites them
 *     to `$1, $2, …` at execution time.
 *   - For inserts that need the new id back, use `RETURNING id` and call
 *     `get()`; do not rely on `lastInsertRowid`.
 *   - Booleans are stored as 0/1 in SQLite and as `boolean` in Postgres;
 *     repos should normalise on read.
 */
export interface DbAdapter {
  /** Run one or more statements with no parameters. Used for migrations. */
  exec(sql: string): Promise<void>;

  /** Return all rows. */
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;

  /** Return the first row, or undefined. */
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;

  /** Run a mutation. Returns the number of affected rows. */
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;

  /** Run a function inside a transaction. Rolls back on throw. */
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;

  /** Close any underlying connection / pool. */
  close(): Promise<void>;

  /** Which backend this adapter wraps; useful for the occasional dialect branch. */
  readonly backend: 'sqlite' | 'pg';
}
