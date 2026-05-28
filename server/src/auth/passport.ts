import passport from 'passport';
import { Strategy as GoogleStrategy, Profile as GoogleProfile } from 'passport-google-oauth20';
import { Strategy as MicrosoftStrategy } from 'passport-microsoft';
import type { DbAdapter } from '../db/adapter';
import { UserRepo } from '../repos/UserRepo';
import { AuthProvider } from '@keepmyledger/shared';
import { welcomeEmail, newUserSignupNotification } from '../services/emailService';
import { logSecurityEvent } from './auditLog';
import { registerAppleStrategy, loadAppleConfigFromEnv, AppleConfig } from './apple';

export interface PassportConfig {
  baseUrl: string;
  google?: { clientId: string; clientSecret: string };
  microsoft?: { clientId: string; clientSecret: string };
  apple?: AppleConfig;
}

/**
 * Shape of the profile object passport-microsoft synthesises from Graph /me.
 * The library types it as `any` (it extends passport-oauth2), so we narrow.
 * `mail` is null for personal Microsoft accounts — fall back to userPrincipalName.
 */
interface MicrosoftProfile {
  id: string;
  displayName?: string;
  emails?: Array<{ value: string; type?: string }>;
  userPrincipalName?: string;
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
export function configurePassport(userRepo: UserRepo, cfg: PassportConfig, db?: DbAdapter): AvailableProvider[] {
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
            if (db) logSecurityEvent(db, { userId: user.id, action: 'login_oauth_success', payload: { provider: 'google' } });
            done(null, user);
          } catch (err) {
            done(err as Error);
          }
        })();
      },
    ));
    enabled.push({ id: 'google', label: 'Google' });
  }

  if (cfg.microsoft) {
    // tenant=common accepts both personal MS accounts and Azure AD work/school.
    // Personal accounts often return mail=null from Graph; fall back to UPN
    // inside the verify callback so upsertUserFromProfile always sees an email.
    passport.use(new MicrosoftStrategy(
      {
        clientID: cfg.microsoft.clientId,
        clientSecret: cfg.microsoft.clientSecret,
        callbackURL: `${cfg.baseUrl}/api/auth/microsoft/callback`,
        scope: ['openid', 'profile', 'email', 'User.Read'],
        tenant: 'common',
      },
      (_accessToken: string, _refreshToken: string, profile: MicrosoftProfile, done: (err: Error | null, user?: Express.User | false) => void) => {
        void (async () => {
          try {
            const emails = profile.emails && profile.emails.length > 0
              ? profile.emails
              : (profile.userPrincipalName ? [{ value: profile.userPrincipalName }] : undefined);
            const user = await upsertUserFromProfile(userRepo, 'microsoft', {
              id: profile.id,
              displayName: profile.displayName,
              emails,
            });
            if (db) logSecurityEvent(db, { userId: user.id, action: 'login_oauth_success', payload: { provider: 'microsoft' } });
            done(null, user);
          } catch (err) {
            done(err as Error);
          }
        })();
      },
    ));
    enabled.push({ id: 'microsoft', label: 'Microsoft' });
  }

  if (cfg.apple) {
    registerAppleStrategy(cfg.apple, cfg.baseUrl, userRepo, db);
    enabled.push({ id: 'apple', label: 'Apple' });
  }

  return enabled;
}

/**
 * Look up or create a user from an OAuth profile. Idempotent: existing identity
 * → existing user; new identity with known email → link to that user; otherwise
 * create. Always provisions default categories (no-op if already done).
 *
 * Exported so provider-specific strategies (apple, future) can reuse the upsert.
 */
export async function upsertUserFromProfile(
  userRepo: UserRepo,
  provider: AuthProvider,
  profile: { id: string; emails?: Array<{ value: string }>; displayName?: string; photos?: Array<{ value: string }> },
) {
  const email = profile.emails?.[0]?.value ?? null;
  const name = profile.displayName ?? null;
  const avatarUrl = profile.photos?.[0]?.value ?? null;

  // 1) existing identity?
  let user = await userRepo.findByIdentity(provider, profile.id);
  const isNewUser = !user;

  // 2) existing user with same verified email; link this identity
  if (!user && email) user = await userRepo.findByEmail(email);

  // 3) brand new user
  if (!user) user = await userRepo.create({ email, name, avatarUrl });

  await userRepo.upsertIdentity({ userId: user.id, provider, providerUserId: profile.id, email });
  const { trialEndsAt } = await userRepo.provisionDefaults(user.id);

  // Send welcome email and internal signup notification on first-ever login (non-blocking).
  if (isNewUser && user.email) {
    welcomeEmail(user.name ?? 'there', user.email, trialEndsAt);
    newUserSignupNotification(user.name ?? 'there', user.email, provider);
  }

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
    microsoft: process.env.MICROSOFT_OAUTH_CLIENT_ID && process.env.MICROSOFT_OAUTH_CLIENT_SECRET
      ? {
          clientId: process.env.MICROSOFT_OAUTH_CLIENT_ID,
          clientSecret: process.env.MICROSOFT_OAUTH_CLIENT_SECRET,
        }
      : undefined,
    apple: loadAppleConfigFromEnv(),
  };
}

// Used by routes/index.ts wiring; kept here so we don't import `db` directly
// in route modules.
export function initPassport(db: DbAdapter, userRepo: UserRepo): AvailableProvider[] {
  const cfg = loadPassportConfig();
  const providers = configurePassport(userRepo, cfg, db);
  // Local (username/password) auth is always available; no env vars required.
  providers.push({ id: 'local', label: 'Username & password' });
  return providers;
}
