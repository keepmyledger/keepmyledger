import { User } from '@keepmyledger/shared';

export interface CreateUserPayload {
  id?: string;                      // omit to autogenerate uuid
  email: string | null;
  name: string | null;
  avatarUrl?: string | null;
}

export interface UpsertIdentityPayload {
  userId: string;
  provider: 'google' | 'facebook' | 'apple' | 'owner' | 'local';
  providerUserId: string;
  email?: string | null;
}

export interface TotpRecord {
  secret: string;  // base32-encoded
  enabled: boolean;
}

/**
 * UserRepo is NOT user-scoped — it's the entrypoint that maps an OAuth
 * identity to a user record, and provisions new users on first login.
 */
export interface UserRepo {
  findById(id: string): Promise<User | undefined>;
  findByEmail(email: string): Promise<User | undefined>;
  findByIdentity(provider: string, providerUserId: string): Promise<User | undefined>;
  create(payload: CreateUserPayload): Promise<User>;
  upsertIdentity(payload: UpsertIdentityPayload): Promise<void>;
  /** Clone category templates into the user's category table (idempotent). */
  provisionDefaults(userId: string): Promise<void>;
  /** Get (or create) the implicit owner user used in self-host mode. */
  getOwner(): Promise<User>;

  // ── Local (username/password) auth ────────────────────────────────────────
  /** Returns true if the (case-normalised) username is already registered. */
  isUsernameTaken(username: string): Promise<boolean>;
  /** Returns userId + passwordHash for login — undefined if username not found or no password set. */
  findByUsernameForAuth(username: string): Promise<{ userId: string; passwordHash: string } | undefined>;
  /** Create a local-auth user with the given pre-hashed password. */
  createLocal(username: string, passwordHash: string): Promise<User>;

  // ── TOTP / MFA ────────────────────────────────────────────────────────────
  getTotpRecord(userId: string): Promise<TotpRecord | null>;
  /** Upsert the TOTP secret (marks enabled=false until confirmed). */
  setTotpSecret(userId: string, secret: string): Promise<void>;
  enableTotp(userId: string): Promise<void>;
  disableTotp(userId: string): Promise<void>;
}
