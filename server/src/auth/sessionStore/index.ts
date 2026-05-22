import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import type { Pool } from 'pg';
import type { DbAdapter } from '../../db/adapter';
import { SqliteSessionStore } from './SqliteSessionStore';

/**
 * Session-store factory.
 *
 * `express-session.Store` is itself the cross-driver abstraction we depend on;
 * this module is the single place where a concrete driver is chosen so
 * swapping in a Redis or DynamoDB-backed store later is a one-line change
 * here (add a case, install the adapter package) with no changes in
 * `index.ts` or routes.
 *
 * Driver selection:
 *   - `SESSION_STORE` env var (when set) wins: 'pg' | 'sqlite' | 'memory'
 *     (future: 'redis' | 'dynamodb').
 *   - Otherwise: pg if a pg pool is available, sqlite if a sqlite adapter
 *     is, else memory.
 *
 * SaaS deployments must always end up on a persistent driver; we log loudly
 * if we fall back to memory.
 */

export type SessionStoreDriver = 'pg' | 'sqlite' | 'memory';

export interface CreateSessionStoreOpts {
  db: DbAdapter;
  pgPool: Pool | null;
}

export interface CreatedSessionStore {
  store: session.Store | undefined; // undefined => express-session default MemoryStore
  driver: SessionStoreDriver;
}

function resolveDriver(opts: CreateSessionStoreOpts): SessionStoreDriver {
  const explicit = (process.env.SESSION_STORE ?? '').toLowerCase().trim();
  if (explicit === 'pg' || explicit === 'sqlite' || explicit === 'memory') {
    return explicit;
  }
  if (opts.pgPool) return 'pg';
  if (opts.db.backend === 'sqlite') return 'sqlite';
  return 'memory';
}

export function createSessionStore(opts: CreateSessionStoreOpts): CreatedSessionStore {
  const driver = resolveDriver(opts);

  switch (driver) {
    case 'pg': {
      if (!opts.pgPool) {
        throw new Error(
          'SESSION_STORE=pg requires a Postgres connection (set DATABASE_URL=postgres://…)',
        );
      }
      const PgStore = connectPgSimple(session);
      const store = new PgStore({
        pool: opts.pgPool,
        tableName: 'user_sessions',
        // Table is owned by migration 004_user_sessions.sql.
        createTableIfMissing: false,
      });
      return { store, driver };
    }
    case 'sqlite': {
      if (opts.db.backend !== 'sqlite') {
        throw new Error('SESSION_STORE=sqlite requires the sqlite db backend');
      }
      return { store: new SqliteSessionStore({ db: opts.db }), driver };
    }
    case 'memory':
    default:
      return { store: undefined, driver: 'memory' };
  }
}
