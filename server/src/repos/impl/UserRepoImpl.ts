import crypto from 'node:crypto';
import { User } from '@keepmyledger/shared';
import { UserRepo, TotpRecord, CreateUserPayload, UpsertIdentityPayload } from '../UserRepo';
import { DbAdapter } from '../../db/adapter';
import { SubscriptionRepoImpl } from './SubscriptionRepoImpl';

export const OWNER_USER_ID = '00000000-0000-0000-0000-000000000001';

/**
 * Auto-categorization rules seeded into every new user's namespace by
 * `provisionDefaults`. Mirrors the owner-user seed in
 * `db/migrations-pg/001_init.sql` and `db/migrations/003_transfers.sql` +
 * `005_cashback_rebate.sql` so that SaaS users get the same out-of-the-box
 * behavior as self-host installs.
 */
const AUTO_RULE_TEMPLATES: ReadonlyArray<{ name: string; pattern: string; categoryName: string }> = [
  { name: 'Auto: Chase payment received',  pattern: 'Payment Thank You', categoryName: 'Credit Card Payment' },
  { name: 'Auto: Amex autopay',            pattern: 'AUTOPAY PAYMENT',   categoryName: 'Credit Card Payment' },
  { name: 'Auto: Amex online payment',     pattern: 'ONLINE PAYMENT',    categoryName: 'Credit Card Payment' },
  { name: 'Auto: M&T credit card payment', pattern: 'AMERICAN EXPRESS',  categoryName: 'Credit Card Payment' },
  { name: 'Auto: M&T Chase payment',       pattern: 'CHASE CREDIT CRD',  categoryName: 'Credit Card Payment' },
  { name: 'Auto: Amex cash rebate',        pattern: 'CASH REBATE',       categoryName: 'Cash Back Rebate' },
  { name: 'Auto: Amex cash reward',        pattern: 'CASH REWARD',       categoryName: 'Cash Back Rebate' },
  { name: 'Auto: Chase cashback bonus',    pattern: 'CASHBACK BONUS',    categoryName: 'Cash Back Rebate' },
  { name: 'Auto: Chase redemption credit', pattern: 'REDEMPTION CREDIT', categoryName: 'Cash Back Rebate' },
];

function toUser(row: Record<string, unknown>): User {
  return {
    id: row.id as string,
    email: row.email as string | null,
    name: row.name as string | null,
    username: (row.username as string | null) ?? null,
    avatarUrl: row.avatar_url as string | null,
    createdAt: row.created_at as string,
  };
}

export class UserRepoImpl implements UserRepo {
  constructor(private db: DbAdapter) {}

  async findById(id: string): Promise<User | undefined> {
    const row = await this.db.get('SELECT * FROM users WHERE id = ?', [id]);
    return row ? toUser(row) : undefined;
  }

  async findByEmail(email: string): Promise<User | undefined> {
    const row = await this.db.get('SELECT * FROM users WHERE email = ?', [email]);
    return row ? toUser(row) : undefined;
  }

  async findByIdentity(provider: string, providerUserId: string): Promise<User | undefined> {
    const row = await this.db.get(`
      SELECT u.*
      FROM users u
      INNER JOIN user_identities i ON i.user_id = u.id
      WHERE i.provider = ? AND i.provider_user_id = ?
    `, [provider, providerUserId]);
    return row ? toUser(row) : undefined;
  }

  async create(payload: CreateUserPayload): Promise<User> {
    const id = payload.id ?? crypto.randomUUID();
    await this.db.run(
      'INSERT INTO users(id, email, name, avatar_url) VALUES (?, ?, ?, ?)',
      [id, payload.email, payload.name, payload.avatarUrl ?? null],
    );
    return (await this.findById(id))!;
  }

  async upsertIdentity(payload: UpsertIdentityPayload): Promise<void> {
    await this.db.run(`
      INSERT INTO user_identities(user_id, provider, provider_user_id, email)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(provider, provider_user_id)
      DO UPDATE SET email = excluded.email
    `, [payload.userId, payload.provider, payload.providerUserId, payload.email ?? null]);
  }

  async provisionDefaults(userId: string): Promise<void> {
    // Clone templates into the user's categories table; UNIQUE(user_id, name)
    // makes this safely idempotent.
    // `WHERE true` disambiguates the upsert from a join (sqlite parser rule).
    await this.db.run(`
      INSERT INTO categories(user_id, name, kind, tax_export_code)
      SELECT ?, name, kind, tax_export_code FROM category_templates WHERE true
      ON CONFLICT (user_id, name) DO NOTHING
    `, [userId]);

    // Seed auto-rules for transfer/cashback detection. Each rule references one
    // of the user's own category rows (looked up by name). Idempotent via
    // NOT EXISTS on (user_id, name); the rules table has no UNIQUE constraint
    // because users are free to create duplicates intentionally.
    for (const r of AUTO_RULE_TEMPLATES) {
      await this.db.run(`
        INSERT INTO rules(user_id, name, description_pattern, pattern_kind, category_id, priority)
        SELECT ?, ?, ?, 'substring', c.id, 100
        FROM categories c
        WHERE c.user_id = ? AND c.name = ?
          AND NOT EXISTS (
            SELECT 1 FROM rules existing
            WHERE existing.user_id = ? AND existing.name = ?
          )
      `, [userId, r.name, r.pattern, userId, r.categoryName, userId, r.name]);
    }

    // In SaaS mode, provision a 14-day trial subscription for new users.
    // Idempotent: ON CONFLICT DO NOTHING means repeat logins are no-ops.
    if (process.env.APP_MODE === 'saas') {
      const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
      const subRepo = new SubscriptionRepoImpl(this.db, userId);
      await subRepo.create({ status: 'trialing', plan: 'beta', trialEndsAt });
    }
  }


  async getOwner(): Promise<User> {
    const existing = await this.findById(OWNER_USER_ID);
    if (existing) return existing;
    // Should already exist from migration 007, but be defensive.
    await this.db.run(
      'INSERT INTO users(id, email, name) VALUES (?, NULL, ?) ON CONFLICT (id) DO NOTHING',
      [OWNER_USER_ID, 'Owner'],
    );
    return (await this.findById(OWNER_USER_ID))!;
  }

  // ── Local auth ─────────────────────────────────────────────────────────────

  async isUsernameTaken(username: string): Promise<boolean> {
    const row = await this.db.get('SELECT id FROM users WHERE username = ?', [username]);
    return !!row;
  }

  async findByUsernameForAuth(username: string): Promise<{ userId: string; passwordHash: string } | undefined> {
    const row = await this.db.get(
      'SELECT id, password_hash FROM users WHERE username = ?',
      [username],
    );
    if (!row || !row.password_hash) return undefined;
    return { userId: row.id as string, passwordHash: row.password_hash as string };
  }

  async createLocal(username: string, passwordHash: string): Promise<User> {
    const id = crypto.randomUUID();
    await this.db.run(
      'INSERT INTO users(id, email, name, username, password_hash) VALUES (?, ?, ?, ?, ?)',
      [id, null, username, username, passwordHash],
    );
    // Register a 'local' identity so findByIdentity('local', username) works.
    await this.upsertIdentity({ userId: id, provider: 'local', providerUserId: username });
    return (await this.findById(id))!;
  }

  // ── TOTP ───────────────────────────────────────────────────────────────────

  async getTotpRecord(userId: string): Promise<TotpRecord | null> {
    const row = await this.db.get(
      'SELECT secret, enabled FROM user_totp WHERE user_id = ?',
      [userId],
    );
    if (!row) return null;
    return { secret: row.secret as string, enabled: !!(row.enabled) };
  }

  async setTotpSecret(userId: string, secret: string): Promise<void> {
    await this.db.run(`
      INSERT INTO user_totp(user_id, secret, enabled)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET secret = excluded.secret, enabled = excluded.enabled
    `, [userId, secret, false]);
  }

  async enableTotp(userId: string): Promise<void> {
    await this.db.run('UPDATE user_totp SET enabled = ? WHERE user_id = ?', [true, userId]);
  }

  async disableTotp(userId: string): Promise<void> {
    await this.db.run('DELETE FROM user_totp WHERE user_id = ?', [userId]);
  }
}
