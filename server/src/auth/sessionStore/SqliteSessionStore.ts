import session from 'express-session';
import type { DbAdapter } from '../../db/adapter';

/**
 * SQLite-backed `express-session` store.
 *
 * Schema is defined in migration `010_user_sessions.sql`:
 *   user_sessions(sid TEXT PK, sess TEXT JSON, expire INTEGER epoch-ms)
 *
 * Design notes:
 *   - We deliberately store `expire` as integer epoch-ms (not a SQL
 *     timestamp) so the exact same row shape works on any kv store we
 *     might swap in later (Redis TTL, DynamoDB TTL attribute, etc.).
 *   - All express-session Store callbacks are node-style `(err, value?)`;
 *     we bridge from the async DbAdapter via .then/.catch.
 *   - A lightweight reaper runs on a timer to purge expired rows so the
 *     table doesn't grow unbounded on self-host installs.
 */
export interface SqliteSessionStoreOptions {
  db: DbAdapter;
  /** How often (ms) to sweep expired rows. Defaults to 15 minutes. */
  pruneIntervalMs?: number;
  /** Default TTL (ms) when a session has no cookie.maxAge. Defaults to 30 days. */
  defaultTtlMs?: number;
}

type Cb<T = void> = (err?: unknown, value?: T) => void;

export class SqliteSessionStore extends session.Store {
  private readonly db: DbAdapter;
  private readonly defaultTtlMs: number;
  private readonly pruneTimer: NodeJS.Timeout;

  constructor(opts: SqliteSessionStoreOptions) {
    super();
    this.db = opts.db;
    this.defaultTtlMs = opts.defaultTtlMs ?? 1000 * 60 * 60 * 24 * 30;
    const prune = opts.pruneIntervalMs ?? 1000 * 60 * 15;
    this.pruneTimer = setInterval(() => {
      this.reapExpired().catch((err) => {
        // Don't crash the process on a transient reap failure.
        // eslint-disable-next-line no-console
        console.warn('[session] sqlite reap failed:', err);
      });
    }, prune);
    // Don't hold the event loop open on shutdown.
    this.pruneTimer.unref?.();
  }

  private ttlFromSession(sess: session.SessionData): number {
    const maxAge = sess.cookie?.maxAge;
    return typeof maxAge === 'number' && maxAge > 0 ? maxAge : this.defaultTtlMs;
  }

  private async reapExpired(): Promise<void> {
    await this.db.run('DELETE FROM user_sessions WHERE expire < ?', [Date.now()]);
  }

  get = (sid: string, cb: Cb<session.SessionData | null>): void => {
    this.db
      .get<{ sess: string; expire: number }>(
        'SELECT sess, expire FROM user_sessions WHERE sid = ?',
        [sid],
      )
      .then((row) => {
        if (!row) return cb(null, null);
        if (row.expire < Date.now()) {
          // Lazy-delete on read.
          this.db.run('DELETE FROM user_sessions WHERE sid = ?', [sid]).catch(() => {});
          return cb(null, null);
        }
        try {
          cb(null, JSON.parse(row.sess) as session.SessionData);
        } catch (err) {
          cb(err);
        }
      })
      .catch(cb);
  };

  set = (sid: string, sess: session.SessionData, cb?: Cb): void => {
    const expire = Date.now() + this.ttlFromSession(sess);
    const json = JSON.stringify(sess);
    this.db
      .run(
        `INSERT INTO user_sessions (sid, sess, expire) VALUES (?, ?, ?)
         ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expire = excluded.expire`,
        [sid, json, expire],
      )
      .then(() => cb?.())
      .catch((err) => cb?.(err));
  };

  destroy = (sid: string, cb?: Cb): void => {
    this.db
      .run('DELETE FROM user_sessions WHERE sid = ?', [sid])
      .then(() => cb?.())
      .catch((err) => cb?.(err));
  };

  touch = (sid: string, sess: session.SessionData, cb?: Cb): void => {
    const expire = Date.now() + this.ttlFromSession(sess);
    this.db
      .run('UPDATE user_sessions SET expire = ? WHERE sid = ?', [expire, sid])
      .then(() => cb?.())
      .catch((err) => cb?.(err));
  };

  length = (cb: Cb<number>): void => {
    this.db
      .get<{ n: number }>('SELECT COUNT(*) AS n FROM user_sessions WHERE expire >= ?', [Date.now()])
      .then((row) => cb(null, Number(row?.n ?? 0)))
      .catch(cb);
  };

  clear = (cb?: Cb): void => {
    this.db
      .run('DELETE FROM user_sessions')
      .then(() => cb?.())
      .catch((err) => cb?.(err));
  };

  all = (cb: Cb<session.SessionData[]>): void => {
    this.db
      .all<{ sess: string; expire: number }>(
        'SELECT sess, expire FROM user_sessions WHERE expire >= ?',
        [Date.now()],
      )
      .then((rows) => {
        try {
          const out = rows.map((r) => JSON.parse(r.sess) as session.SessionData);
          cb(null, out);
        } catch (err) {
          cb(err);
        }
      })
      .catch(cb);
  };
}
