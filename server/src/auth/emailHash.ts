import crypto from 'node:crypto';

/**
 * HMAC-SHA256 of a lower-cased email, keyed by EMAIL_PEPPER.
 *
 * Used as the WHERE-clause predicate for email lookups so that the cleartext
 * email column can be encrypted at rest (Phase 3) without breaking login /
 * password-reset flows.
 *
 * Configuration:
 *  - Set EMAIL_PEPPER to a ≥32-byte random base64 string (e.g. the output of
 *    `openssl rand -base64 32`).
 *  - In SaaS mode this is strongly recommended. In self-host mode the server
 *    falls back to a value derived from SESSION_SECRET so existing installs
 *    work without new config, but a warning is printed at startup.
 */

let _pepper: string | null = null;

function getPepper(): string {
  if (_pepper !== null) return _pepper;

  const env = process.env.EMAIL_PEPPER;
  if (env && env.length >= 32) {
    _pepper = env;
    return _pepper;
  }

  // Self-host fallback: derive a stable pepper from SESSION_SECRET so the
  // hash is consistent across restarts without requiring new configuration.
  const secret = process.env.SESSION_SECRET ?? 'dev-only-insecure-secret-change-me';
  if (!env) {
    console.warn(
      '[security] EMAIL_PEPPER is not set. Deriving email hash pepper from ' +
      'SESSION_SECRET. Set EMAIL_PEPPER to a 32-byte random base64 string for ' +
      'proper hardening (run: openssl rand -base64 32).',
    );
  }
  _pepper = crypto.createHash('sha256').update('email-pepper:' + secret).digest('base64');
  return _pepper;
}

/**
 * Compute the lookup hash for an email address.
 * Normalises to lowercase before hashing so callers cannot accidentally
 * produce different hashes for the same address.
 */
export function hashEmail(email: string): string {
  return crypto
    .createHmac('sha256', getPepper())
    .update(email.toLowerCase().trim())
    .digest('base64url');
}
