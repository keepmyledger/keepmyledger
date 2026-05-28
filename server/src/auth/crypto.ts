/**
 * crypto.ts — App-level field encryption
 * ----------------------------------------
 * Provides encrypt/decrypt for columns that must be protected at rest
 * (user PII, OAuth tokens, TOTP secrets) independently of database-level
 * encryption.
 *
 * Algorithm: AES-256-GCM
 *  - 256-bit key derived from ENCRYPTION_KEY_V<n> environment variables
 *  - 12-byte random IV per encryption
 *  - 16-byte authentication tag (GCM integrity guarantee)
 *
 * Wire format (base64url string):
 *   [1 byte version][12 bytes IV][N bytes ciphertext][16 bytes tag]
 *
 * Rotation:
 *   1. Generate a new key:  openssl rand -base64 32
 *   2. Add ENCRYPTION_KEY_V2=<new-key> to env alongside ENCRYPTION_KEY.
 *   3. Deploy. New writes use V2; existing V1 ciphertext still decrypts.
 *   4. Run encryptExistingRows.ts (optional, re-encrypts old rows to V2).
 *   5. Once no V1-tagged rows remain, remove ENCRYPTION_KEY from env.
 *
 * Self-host fallback:
 *   If no ENCRYPTION_KEY is set, a warning is printed and a key is
 *   derived from SESSION_SECRET. This keeps existing self-host installs
 *   working without new config but should be replaced with a real key.
 */

import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm' as const;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

// ── Key management ─────────────────────────────────────────────────────────────

export interface KeyProvider {
  /** The version number to use for new encryptions. */
  activeVersion: number;
  /** Return the 32-byte key for the given version, or null if unknown. */
  getKey(version: number): Buffer | null;
}

/**
 * Reads ENCRYPTION_KEY_V1, ENCRYPTION_KEY_V2, … from the environment.
 * The highest version present is used for new encryptions.
 * Old versions are kept for decryption during key rotation.
 */
export class EnvKeyProvider implements KeyProvider {
  private keys = new Map<number, Buffer>();
  activeVersion = 0;

  constructor() {
    // Primary key: ENCRYPTION_KEY (version 1). Simple single-var setup for most installs.
    const primary = process.env.ENCRYPTION_KEY;
    if (primary) {
      const key = Buffer.from(primary, 'base64');
      if (key.length !== KEY_BYTES) {
        throw new Error(
          `ENCRYPTION_KEY must be a base64-encoded 32-byte key ` +
          `(got ${key.length} bytes). Generate one with: openssl rand -base64 32`,
        );
      }
      this.keys.set(1, key);
      this.activeVersion = 1;
    }

    // Additional versions for explicit key rotation: ENCRYPTION_KEY_V2, V3, …
    // Only needed when rotating away from the primary ENCRYPTION_KEY.
    for (let v = 2; v <= 99; v++) {
      const raw = process.env[`ENCRYPTION_KEY_V${v}`];
      if (!raw) break;
      const key = Buffer.from(raw, 'base64');
      if (key.length !== KEY_BYTES) {
        throw new Error(
          `ENCRYPTION_KEY_V${v} must be a base64-encoded 32-byte key ` +
          `(got ${key.length} bytes). Generate one with: openssl rand -base64 32`,
        );
      }
      this.keys.set(v, key);
      if (v > this.activeVersion) this.activeVersion = v;
    }

    if (this.keys.size === 0) {
      // Self-host fallback: derive a stable key from SESSION_SECRET.
      // Not recommended for production — set ENCRYPTION_KEY.
      const secret = process.env.SESSION_SECRET ?? 'dev-only-insecure-secret-change-me';
      const derived = crypto
        .createHash('sha256')
        .update('encryption-key:' + secret)
        .digest();
      this.keys.set(1, derived);
      this.activeVersion = 1;
      console.warn(
        '[security] No ENCRYPTION_KEY env var found. Deriving encryption key from ' +
        'SESSION_SECRET. Set ENCRYPTION_KEY to a 32-byte random base64 string ' +
        'for proper hardening (run: openssl rand -base64 32).',
      );
    }
  }

  getKey(version: number): Buffer | null {
    return this.keys.get(version) ?? null;
  }
}

// Module-level singleton — initialised lazily on first use.
let _provider: KeyProvider | null = null;

function getProvider(): KeyProvider {
  if (!_provider) _provider = new EnvKeyProvider();
  return _provider;
}

/** Override the key provider (for testing). */
export function setKeyProvider(p: KeyProvider): void {
  _provider = p;
}

// ── Encrypt / Decrypt ──────────────────────────────────────────────────────────

/**
 * Encrypt `plaintext` and return a base64url-encoded blob that includes the
 * version byte, IV, ciphertext, and authentication tag.
 */
export function encrypt(plaintext: string): string {
  const provider = getProvider();
  const version = provider.activeVersion;
  const key = provider.getKey(version);
  if (!key) throw new Error(`[crypto] No key for version ${version}`);

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Wire format: [1B version][12B iv][N ciphertext][16B tag]
  const blob = Buffer.allocUnsafe(1 + IV_BYTES + ct.length + TAG_BYTES);
  blob.writeUInt8(version, 0);
  iv.copy(blob, 1);
  ct.copy(blob, 1 + IV_BYTES);
  tag.copy(blob, 1 + IV_BYTES + ct.length);

  return blob.toString('base64url');
}

/**
 * Decrypt a blob produced by `encrypt`. Throws if the blob is malformed,
 * the version is unknown, or the authentication tag does not match (tampered).
 */
export function decrypt(blob: string): string {
  const provider = getProvider();
  const buf = Buffer.from(blob, 'base64url');

  if (buf.length < 1 + IV_BYTES + TAG_BYTES) {
    throw new Error('[crypto] Ciphertext blob is too short');
  }

  const version = buf.readUInt8(0);
  const key = provider.getKey(version);
  if (!key) throw new Error(`[crypto] Unknown key version ${version}`);

  const iv  = buf.subarray(1, 1 + IV_BYTES);
  const tag = buf.subarray(buf.length - TAG_BYTES);
  const ct  = buf.subarray(1 + IV_BYTES, buf.length - TAG_BYTES);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  try {
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('[crypto] Decryption failed: authentication tag mismatch (data may be tampered)');
  }
}

/**
 * Encrypt a nullable string. Returns null unchanged.
 * Convenience wrapper for nullable DB columns.
 */
export function encryptNullable(value: string | null): string | null {
  return value === null ? null : encrypt(value);
}

/**
 * Decrypt a nullable string. Returns null unchanged.
 */
export function decryptNullable(blob: string | null): string | null {
  return blob === null ? null : decrypt(blob);
}
