import crypto from 'node:crypto';
import { User, ReceiptStoragePreference } from '@keepmyledger/shared';
import { UserRepo, TotpRecord, CreateUserPayload, UpsertIdentityPayload } from '../UserRepo';
import { DbAdapter } from '../../db/adapter';
import { SubscriptionRepoImpl } from './SubscriptionRepoImpl';
import { seedBusinessDefaults } from './seedBusiness';
import { hashEmail } from '../../auth/emailHash';
import { encrypt, decrypt, encryptNullable, decryptNullable } from '../../auth/crypto';

export const OWNER_USER_ID = '00000000-0000-0000-0000-000000000001';

/** Emails (lowercased) granted admin access via ADMIN_EMAILS env var. */
function adminEmailSet(): Set<string> {
  const raw = process.env.ADMIN_EMAILS ?? '';
  return new Set(raw.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean));
}

function toUser(row: Record<string, unknown>): User {
  const pref = row.receipt_storage_preference as string | null | undefined;
  return {
    id: row.id as string,
    email: decryptNullable(row.email_enc as string | null),
    name: decryptNullable(row.name_enc as string | null),
    username: (row.username as string | null) ?? null,
    avatarUrl: row.avatar_url as string | null,
    isAdmin: !!(row.is_admin),
    createdAt: row.created_at as string,
    receiptStoragePreference: pref === 'kml' || pref === 'drive' ? pref : null,
  };
}

export class UserRepoImpl implements UserRepo {
  constructor(private db: DbAdapter) {}

  async findById(id: string): Promise<User | undefined> {
    const row = await this.db.get('SELECT * FROM users WHERE id = ?', [id]);
    return row ? toUser(row) : undefined;
  }

  async findByEmail(email: string): Promise<User | undefined> {
    // Delegate to hash-based lookup so this works both before and after
    // email column encryption is fully applied.
    return this.findByEmailCI(email);
  }

  async findByEmailCI(email: string): Promise<User | undefined> {
    const row = await this.db.get(
      'SELECT * FROM users WHERE email_hash = ?',
      [hashEmail(email.toLowerCase())],
    );
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
    const emailHash = payload.email ? hashEmail(payload.email.toLowerCase()) : null;
    const emailEnc = encryptNullable(payload.email ?? null);
    const nameEnc  = encryptNullable(payload.name  ?? null);
    await this.db.run(
      'INSERT INTO users(id, email_hash, email_enc, name_enc, avatar_url) VALUES (?, ?, ?, ?, ?)',
      [id, emailHash, emailEnc, nameEnc, payload.avatarUrl ?? null],
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

  async provisionDefaults(
    userId: string,
    businessName?: string,
  ): Promise<{ trialEndsAt: string | null; orgId: string; businessId: number }> {
    // Local registration supplies a real business name; OAuth + scripts/tests
    // omit it and accept the historical placeholder. The web app forces a
    // rename via BusinessSetupModal whenever a business is named 'Personal'.
    const resolvedName = (businessName?.trim() || 'Personal');

    // ── 1. Ensure personal org exists (id = userId by convention) ────────────
    // `created_at` is omitted so each backend uses its own DEFAULT
    // (SQLite: datetime('now'); PG: to_char(now() AT TIME ZONE 'UTC', …)).
    const orgId = userId;
    await this.db.run(`
      INSERT INTO organizations(id, name)
      VALUES (?, ?)
      ON CONFLICT (id) DO NOTHING
    `, [orgId, resolvedName]);

    // ── 2. Ensure owner membership exists ───────────────────────────────────
    await this.db.run(`
      INSERT INTO org_memberships(org_id, user_id, role)
      VALUES (?, ?, 'owner')
      ON CONFLICT (org_id, user_id) DO NOTHING
    `, [orgId, userId]);

    // ── 3. Ensure a business exists for this org and capture its id ─────────
    // Idempotent: if any business already exists for the org (e.g. provisionDefaults
    // is re-run on a returning user, or the org-seed migration already created one),
    // reuse it rather than inserting a duplicate. The picked row is deterministic
    // (lowest id) so repeated calls land on the same business.
    const existingBiz = await this.db.get<{ id: number }>(
      'SELECT id FROM businesses WHERE org_id = ? ORDER BY id ASC LIMIT 1',
      [orgId],
    );
    let businessId: number;
    if (existingBiz) {
      businessId = Number(existingBiz.id);
    } else {
      const inserted = await this.db.get<{ id: number }>(
        'INSERT INTO businesses(org_id, name) VALUES (?, ?) RETURNING id',
        [orgId, resolvedName],
      );
      businessId = Number(inserted!.id);
    }

    // ── 4. Seed categories + auto-rules into the business ──────────────────
    await seedBusinessDefaults(this.db, businessId, userId);

    // ── 5. Provision trial subscription for SaaS mode ───────────────────────
    let trialEndsAt: string | null = null;
    if (process.env.APP_MODE === 'saas') {
      const fourteenDays = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
      const promoEnd = new Date('2026-06-30T23:59:59Z');
      trialEndsAt = (fourteenDays > promoEnd ? fourteenDays : promoEnd).toISOString();
      const subRepo = new SubscriptionRepoImpl(this.db, orgId);
      await subRepo.create({ status: 'trialing', plan: 'beta', trialEndsAt });
    }
    return { trialEndsAt, orgId, businessId };
  }


  /**
   * Promotes/demotes admin status for a user based on the ADMIN_EMAILS env var.
   * Idempotent; safe to call on every login.
   */
  async syncAdminStatus(userId: string, email: string | null): Promise<void> {
    const shouldBeAdmin = email !== null && adminEmailSet().has(email.toLowerCase());
    await this.db.run(
      'UPDATE users SET is_admin = ? WHERE id = ?',
      [shouldBeAdmin ? 1 : 0, userId],
    );
  }

  async getOwner(): Promise<User> {
    const existing = await this.findById(OWNER_USER_ID);
    if (existing) return existing;
    // Should already exist from migration 007, but be defensive.
    await this.db.run(
      'INSERT INTO users(id, name_enc) VALUES (?, ?) ON CONFLICT (id) DO NOTHING',
      [OWNER_USER_ID, encrypt('Owner')],
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

  async createLocal(username: string, passwordHash: string, email: string, tosAcceptedAt: string): Promise<User> {
    const id = crypto.randomUUID();
    const emailHash = hashEmail(email.toLowerCase());
    const emailEnc  = encrypt(email);
    const nameEnc   = encrypt(username);
    await this.db.run(
      'INSERT INTO users(id, email_hash, email_enc, name_enc, username, password_hash, tos_accepted_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, emailHash, emailEnc, nameEnc, username, passwordHash, tosAcceptedAt],
    );
    // Register a 'local' identity so findByIdentity('local', username) works.
    await this.upsertIdentity({ userId: id, provider: 'local', providerUserId: username });
    return (await this.findById(id))!;
  }

  async updateEmail(userId: string, email: string): Promise<void> {
    const emailHash = hashEmail(email.toLowerCase());
    const emailEnc  = encrypt(email);
    await this.db.run(
      'UPDATE users SET email_hash = ?, email_enc = ? WHERE id = ?',
      [emailHash, emailEnc, userId],
    );
  }

  async setReceiptStoragePreference(userId: string, pref: ReceiptStoragePreference | null): Promise<void> {
    await this.db.run(
      'UPDATE users SET receipt_storage_preference = ? WHERE id = ?',
      [pref, userId],
    );
  }

  // ── TOTP ───────────────────────────────────────────────────────────────────

  async getTotpRecord(userId: string): Promise<TotpRecord | null> {
    const row = await this.db.get(
      'SELECT secret_enc, enabled FROM user_totp WHERE user_id = ?',
      [userId],
    );
    if (!row) return null;
    return { secret: decrypt(row.secret_enc as string), enabled: !!(row.enabled) };
  }

  async setTotpSecret(userId: string, secret: string): Promise<void> {
    const secretEnc = encrypt(secret);
    await this.db.run(`
      INSERT INTO user_totp(user_id, secret_enc, enabled)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE
        SET secret_enc = excluded.secret_enc, enabled = excluded.enabled
    `, [userId, secretEnc, false]);
  }

  async enableTotp(userId: string): Promise<void> {
    await this.db.run('UPDATE user_totp SET enabled = ? WHERE user_id = ?', [true, userId]);
  }

  async disableTotp(userId: string): Promise<void> {
    await this.db.run('DELETE FROM user_totp WHERE user_id = ?', [userId]);
  }

  async delete(userId: string): Promise<void> {
    await this.db.run('DELETE FROM users WHERE id = ?', [userId]);
  }

  async markEmailBounced(emailHash: string, at: string): Promise<void> {
    await this.db.run(
      'UPDATE users SET email_bounced_at = ? WHERE email_hash = ? AND email_bounced_at IS NULL',
      [at, emailHash],
    );
  }

  async markEmailComplained(emailHash: string, at: string): Promise<void> {
    await this.db.run(
      'UPDATE users SET email_complained_at = ? WHERE email_hash = ? AND email_complained_at IS NULL',
      [at, emailHash],
    );
  }
}
