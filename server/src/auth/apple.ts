import passport from 'passport';
import AppleStrategy from 'passport-apple';
import type { DbAdapter } from '../db/adapter';
import { UserRepo } from '../repos/UserRepo';
import { logSecurityEvent } from './auditLog';
import { upsertUserFromProfile } from './passport';

export interface AppleConfig {
  clientId: string;
  teamId: string;
  keyId: string;
  /** Decoded P8 contents (PEM). */
  privateKeyString: string;
}

/**
 * Decode the `APPLE_OAUTH_PRIVATE_KEY_B64` env var and validate the four env
 * vars are present and the decoded value looks like a PEM. Fails soft — returns
 * undefined and logs a single-line warning if anything is wrong, so the server
 * boots and Apple simply isn't listed as a provider.
 */
export function loadAppleConfigFromEnv(): AppleConfig | undefined {
  const clientId = process.env.APPLE_OAUTH_CLIENT_ID;
  const teamId   = process.env.APPLE_OAUTH_TEAM_ID;
  const keyId    = process.env.APPLE_OAUTH_KEY_ID;
  const keyB64   = process.env.APPLE_OAUTH_PRIVATE_KEY_B64;
  if (!clientId || !teamId || !keyId || !keyB64) return undefined;

  let privateKeyString: string;
  try {
    privateKeyString = Buffer.from(keyB64, 'base64').toString('utf8');
  } catch {
    console.warn('[auth] APPLE_OAUTH_PRIVATE_KEY_B64 is not valid base64 — Apple strategy not registered');
    return undefined;
  }
  if (!privateKeyString.startsWith('-----BEGIN PRIVATE KEY-----')) {
    console.warn('[auth] APPLE_OAUTH_PRIVATE_KEY_B64 does not decode to a PEM-formatted PRIVATE KEY — Apple strategy not registered');
    return undefined;
  }

  return { clientId, teamId, keyId, privateKeyString };
}

/**
 * Decode the payload of a JWT WITHOUT verifying the signature.
 *
 * Safe here because the id_token reaches us via the back-channel token
 * exchange (TLS to https://appleid.apple.com/auth/token) authenticated by our
 * P8-signed client_secret. We never accept an id_token directly from the
 * browser.
 */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
    const obj = JSON.parse(payload);
    return obj && typeof obj === 'object' ? obj : null;
  } catch {
    return null;
  }
}

interface AppleUserField {
  name?: { firstName?: string; lastName?: string };
  email?: string;
}

/**
 * Register the passport-apple strategy.
 *
 * Notes on quirks:
 *   - Apple's callback is a cross-site POST. Our session cookie is
 *     SameSite=lax, so it isn't sent on that POST. passport-oauth2's default
 *     is `state` disabled (no session reads), which is what we rely on here.
 *     Apple's id_token signature + our P8-signed client_secret give us the
 *     integrity guarantees state would normally provide.
 *   - The verify callback's 5th argument is unused (passport-apple does not
 *     populate it — see its README). We decode the id_token ourselves to get
 *     `sub` and `email`.
 *   - Name is only available on the very first authorization, posted as a
 *     JSON string in `req.body.user`. We extract it once; on subsequent logins
 *     the upsert path simply matches the existing user_identities row.
 */
export function registerAppleStrategy(
  cfg: AppleConfig,
  baseUrl: string,
  userRepo: UserRepo,
  db?: DbAdapter,
): void {
  passport.use(new AppleStrategy(
    {
      clientID:         cfg.clientId,
      teamID:           cfg.teamId,
      keyID:            cfg.keyId,
      privateKeyString: cfg.privateKeyString,
      callbackURL:      `${baseUrl}/api/auth/apple/callback`,
      passReqToCallback: true,
    },
    (req, _accessToken, _refreshToken, idToken, _profile, done) => {
      void (async () => {
        try {
          const claims = decodeJwtPayload(idToken);
          const sub = typeof claims?.sub === 'string' ? claims.sub : null;
          if (!sub) {
            return done(new Error('Apple id_token missing sub claim'));
          }

          const tokenEmail = typeof claims?.email === 'string' ? claims.email : null;

          // First-authorization-only user info, posted as a JSON string.
          let userField: AppleUserField | null = null;
          const raw = (req.body as { user?: unknown } | undefined)?.user;
          if (typeof raw === 'string' && raw.trim()) {
            try {
              const parsed = JSON.parse(raw);
              if (parsed && typeof parsed === 'object') userField = parsed as AppleUserField;
            } catch { /* ignore — Apple omits this on later logins */ }
          }

          const displayName = userField?.name
            ? [userField.name.firstName, userField.name.lastName].filter(Boolean).join(' ').trim()
            : null;
          const email = tokenEmail ?? userField?.email ?? null;

          const user = await upsertUserFromProfile(userRepo, 'apple', {
            id: sub,
            emails: email ? [{ value: email }] : undefined,
            displayName: displayName && displayName.length > 0 ? displayName : undefined,
          });

          if (db) {
            logSecurityEvent(db, {
              userId: user.id,
              action: 'login_oauth_success',
              payload: { provider: 'apple' },
            });
          }
          done(null, user);
        } catch (err) {
          done(err as Error);
        }
      })();
    },
  ));
}
