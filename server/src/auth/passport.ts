import passport from 'passport';
import { Strategy as GoogleStrategy, Profile as GoogleProfile } from 'passport-google-oauth20';
import type { DbAdapter } from '../db/adapter';
import { UserRepo } from '../repos/UserRepo';
import { AuthProvider } from '@keepmyledger/shared';

export interface PassportConfig {
  baseUrl: string;
  google?: { clientId: string; clientSecret: string };
}

export interface AvailableProvider {
  id: AuthProvider;
  label: string;
}

/**
 * Configure passport with whatever OAuth providers have env-var credentials.
 * Serializes only the user id into the session; on each request we re-load
 * minimal user info from the DB via UserRepo.
 */
export function configurePassport(userRepo: UserRepo, cfg: PassportConfig): AvailableProvider[] {
  const enabled: AvailableProvider[] = [];

  passport.serializeUser((user: Express.User, done) => {
    done(null, (user as { id: string }).id);
  });

  passport.deserializeUser((id: string, done) => {
    void (async () => {
      try {
        const user = await userRepo.findById(id);
        done(null, user ?? false);
      } catch (err) {
        done(err as Error);
      }
    })();
  });

  if (cfg.google) {
    passport.use(new GoogleStrategy(
      {
        clientID: cfg.google.clientId,
        clientSecret: cfg.google.clientSecret,
        callbackURL: `${cfg.baseUrl}/api/auth/google/callback`,
      },
      (_accessToken: string, _refreshToken: string, profile: GoogleProfile, done) => {
        void (async () => {
          try {
            const user = await upsertUserFromProfile(userRepo, 'google', profile);
            done(null, user);
          } catch (err) {
            done(err as Error);
          }
        })();
      },
    ));
    enabled.push({ id: 'google', label: 'Google' });
  }

  return enabled;
}

/**
 * Look up or create a user from an OAuth profile. Idempotent: existing identity
 * → existing user; new identity with known email → link to that user; otherwise
 * create. Always provisions default categories (no-op if already done).
 */
async function upsertUserFromProfile(
  userRepo: UserRepo,
  provider: AuthProvider,
  profile: { id: string; emails?: Array<{ value: string }>; displayName?: string; photos?: Array<{ value: string }> },
) {
  const email = profile.emails?.[0]?.value ?? null;
  const name = profile.displayName ?? null;
  const avatarUrl = profile.photos?.[0]?.value ?? null;

  // 1) existing identity?
  let user = await userRepo.findByIdentity(provider, profile.id);

  // 2) existing user with same verified email — link this identity
  if (!user && email) user = await userRepo.findByEmail(email);

  // 3) brand new user
  if (!user) user = await userRepo.create({ email, name, avatarUrl });

  await userRepo.upsertIdentity({ userId: user.id, provider, providerUserId: profile.id, email });
  await userRepo.provisionDefaults(user.id);

  return user;
}

/** Read provider config from env. */
export function loadPassportConfig(): PassportConfig {
  return {
    baseUrl: process.env.APP_BASE_URL ?? 'http://127.0.0.1:3001',
    google: process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET
      ? {
          clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
          clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
        }
      : undefined,
  };
}

// Used by routes/index.ts wiring — kept here so we don't import `db` directly
// in route modules.
export function initPassport(_db: DbAdapter, userRepo: UserRepo): AvailableProvider[] {
  const cfg = loadPassportConfig();
  const providers = configurePassport(userRepo, cfg);
  // Local (username/password) auth is always available — no env vars required.
  providers.push({ id: 'local', label: 'Username & password' });
  return providers;
}
