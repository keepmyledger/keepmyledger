import { User, AuthProvider, ReceiptStoragePreference } from '@keepmyledger/shared';

export interface CreateUserPayload {
  id?: string;                      // omit to autogenerate uuid
  email: string | null;
  name: string | null;
  avatarUrl?: string | null;
}

export interface UpsertIdentityPayload {
  userId: string;
  provider: AuthProvider;
  providerUserId: string;
  email?: string | null;
}

export interface TotpRecord {
  secret: string;  // base32-encoded
  enabled: boolean;
}

/**
 * UserRepo is NOT user-scoped; it's the entrypoint that maps an OAuth
 * identity to a user record, and provisions new users on first login.
 */
export interface UserRepo {
  findById(id: string): Promise<User | undefined>;
  findByEmail(email: string): Promise<User | undefined>;
  findByIdentity(provider: string, providerUserId: string): Promise<User | undefined>;
  create(payload: CreateUserPayload): Promise<User>;
  upsertIdentity(payload: UpsertIdentityPayload): Promise<void>;
  /** Clone category templates + rules into the user's personal org/business (idempotent). */
  provisionDefaults(userId: string): Promise<{ trialEndsAt: string | null; orgId: string; businessId: number }>;
  /** Get (or create) the implicit owner user used in self-host mode. */
  getOwner(): Promise<User>;
  /** Promote/demote admin based on ADMIN_EMAILS env; idempotent, safe to call on login. */
  syncAdminStatus(userId: string, email: string | null): Promise<void>;

  // ── Local (username/password) auth ────────────────────────────────────────
  /** Returns true if the (case-normalised) username is already registered. */
  isUsernameTaken(username: string): Promise<boolean>;
  /** Returns userId + passwordHash for login; undefined if username not found or no password set. */
  findByUsernameForAuth(username: string): Promise<{ userId: string; passwordHash: string } | undefined>;
  /** Case-insensitive email lookup. Pass a pre-lowercased value for efficiency. */
  findByEmailCI(email: string): Promise<User | undefined>;
  /** Create a local-auth user with the given pre-hashed password, email, and ToS timestamp. */
  createLocal(username: string, passwordHash: string, email: string, tosAcceptedAt: string): Promise<User>;
  /** Update the email address for an existing user. */
  updateEmail(userId: string, email: string): Promise<void>;
  /** Set the user's receipt-storage preference (null = follow server default). */
  setReceiptStoragePreference(userId: string, pref: ReceiptStoragePreference | null): Promise<void>;

  // ── Account lifecycle ─────────────────────────────────────────────────────
  /** Hard-delete the user row (cascades to all child tables via FK). */
  delete(userId: string): Promise<void>;

  // ── Email suppression (bounce / complaint) ────────────────────────────────
  /** Record an SES bounce; no-op if already set. Keyed by email_hash. */
  markEmailBounced(emailHash: string, at: string): Promise<void>;
  /** Record an SES complaint; no-op if already set. Keyed by email_hash. */
  markEmailComplained(emailHash: string, at: string): Promise<void>;

  // ── TOTP / MFA ────────────────────────────────────────────────────────────
  getTotpRecord(userId: string): Promise<TotpRecord | null>;
  /** Upsert the TOTP secret (marks enabled=false until confirmed). */
  setTotpSecret(userId: string, secret: string): Promise<void>;
  enableTotp(userId: string): Promise<void>;
  disableTotp(userId: string): Promise<void>;
}
