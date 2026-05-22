import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import { User } from '@keepmyledger/shared';
import { UserRepo, TotpRecord, CreateUserPayload, UpsertIdentityPayload } from '../UserRepo';

export const OWNER_USER_ID = '00000000-0000-0000-0000-000000000001';

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

export class SqliteUserRepo implements UserRepo {
  constructor(private db: DatabaseSync) {}

  async findById(id: string): Promise<User | undefined> {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? toUser(row) : undefined;
  }

  async findByEmail(email: string): Promise<User | undefined> {
    const row = this.db.prepare('SELECT * FROM users WHERE email = ?').get(email) as Record<string, unknown> | undefined;
    return row ? toUser(row) : undefined;
  }

  async findByIdentity(provider: string, providerUserId: string): Promise<User | undefined> {
    const row = this.db.prepare(`
      SELECT u.*
      FROM users u
      INNER JOIN user_identities i ON i.user_id = u.id
      WHERE i.provider = ? AND i.provider_user_id = ?
    `).get(provider, providerUserId) as Record<string, unknown> | undefined;
    return row ? toUser(row) : undefined;
  }

  async create(payload: CreateUserPayload): Promise<User> {
    const id = payload.id ?? crypto.randomUUID();
    this.db
      .prepare('INSERT INTO users(id, email, name, avatar_url) VALUES (?, ?, ?, ?)')
      .run(id, payload.email, payload.name, payload.avatarUrl ?? null);
    return (await this.findById(id))!;
  }

  async upsertIdentity(payload: UpsertIdentityPayload): Promise<void> {
    this.db
      .prepare(`
        INSERT INTO user_identities(user_id, provider, provider_user_id, email)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(provider, provider_user_id)
        DO UPDATE SET email = excluded.email
      `)
      .run(payload.userId, payload.provider, payload.providerUserId, payload.email ?? null);
  }

  async provisionDefaults(userId: string): Promise<void> {
    // Clone templates into the user's categories table; UNIQUE(user_id, name)
    // makes this safely idempotent.
    this.db.prepare(`
      INSERT OR IGNORE INTO categories(user_id, name, kind, tax_export_code)
      SELECT ?, name, kind, tax_export_code FROM category_templates
    `).run(userId);
  }

  async getOwner(): Promise<User> {
    const existing = await this.findById(OWNER_USER_ID);
    if (existing) return existing;
    // Should already exist from migration 007, but be defensive.
    this.db
      .prepare('INSERT OR IGNORE INTO users(id, email, name) VALUES (?, NULL, ?)')
      .run(OWNER_USER_ID, 'Owner');
    return (await this.findById(OWNER_USER_ID))!;
  }

  async isUsernameTaken(username: string): Promise<boolean> {
    const row = this.db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    return !!row;
  }

  async findByUsernameForAuth(username: string): Promise<{ userId: string; passwordHash: string } | undefined> {
    const row = this.db
      .prepare('SELECT id, password_hash FROM users WHERE username = ?')
      .get(username) as Record<string, unknown> | undefined;
    if (!row || !row.password_hash) return undefined;
    return { userId: row.id as string, passwordHash: row.password_hash as string };
  }

  async createLocal(username: string, passwordHash: string): Promise<User> {
    const id = crypto.randomUUID();
    this.db
      .prepare('INSERT INTO users(id, email, name, username, password_hash) VALUES (?, ?, ?, ?, ?)')
      .run(id, null, username, username, passwordHash);
    await this.upsertIdentity({ userId: id, provider: 'local', providerUserId: username });
    return (await this.findById(id))!;
  }

  async getTotpRecord(userId: string): Promise<TotpRecord | null> {
    const row = this.db
      .prepare('SELECT secret, enabled FROM user_totp WHERE user_id = ?')
      .get(userId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return { secret: row.secret as string, enabled: !!(row.enabled) };
  }

  async setTotpSecret(userId: string, secret: string): Promise<void> {
    this.db.prepare(`
      INSERT INTO user_totp(user_id, secret, enabled)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET secret = excluded.secret, enabled = excluded.enabled
    `).run(userId, secret, 0);
  }

  async enableTotp(userId: string): Promise<void> {
    this.db.prepare('UPDATE user_totp SET enabled = ? WHERE user_id = ?').run(1, userId);
  }

  async disableTotp(userId: string): Promise<void> {
    this.db.prepare('DELETE FROM user_totp WHERE user_id = ?').run(userId);
  }
}
