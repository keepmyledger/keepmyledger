/**
 * security/crypto.test.ts
 *
 * Unit tests for the AES-256-GCM field encryption module.
 */
import { encrypt, decrypt, encryptNullable, decryptNullable, setKeyProvider } from '../../auth/crypto';
import type { KeyProvider } from '../../auth/crypto';
import crypto from 'node:crypto';

// ─── test key provider ───────────────────────────────────────────────────────

function makeProvider(versions: Record<number, Buffer>, active: number): KeyProvider {
  return {
    activeVersion: active,
    getKey: (v) => versions[v] ?? null,
  };
}

function randomKey(): Buffer {
  return crypto.randomBytes(32);
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('encrypt / decrypt', () => {
  beforeEach(() => {
    // Use a deterministic test key so tests don't depend on env vars.
    setKeyProvider(makeProvider({ 1: randomKey() }, 1));
  });

  it('round-trips a plain string', () => {
    const plaintext = 'alice@example.com';
    expect(decrypt(encrypt(plaintext))).toBe(plaintext);
  });

  it('round-trips empty string', () => {
    expect(decrypt(encrypt(''))).toBe('');
  });

  it('produces different ciphertexts on each call (unique IV)', () => {
    const a = encrypt('same');
    const b = encrypt('same');
    expect(a).not.toBe(b);
  });

  it('includes the version byte in the blob', () => {
    const blob = encrypt('test');
    const buf = Buffer.from(blob, 'base64url');
    expect(buf.readUInt8(0)).toBe(1);
  });

  it('throws on a tampered ciphertext', () => {
    const blob = encrypt('sensitive data');
    const buf = Buffer.from(blob, 'base64url');
    // Flip a byte in the ciphertext section
    buf[15] ^= 0xff;
    expect(() => decrypt(buf.toString('base64url'))).toThrow();
  });

  it('throws when the blob is too short', () => {
    expect(() => decrypt(Buffer.from([1, 2, 3]).toString('base64url'))).toThrow(/too short/i);
  });
});

describe('key rotation', () => {
  it('decrypts V1 ciphertext after V2 key is added', () => {
    const keyV1 = randomKey();
    const keyV2 = randomKey();

    // Write with V1 active.
    setKeyProvider(makeProvider({ 1: keyV1 }, 1));
    const blob = encrypt('payload');

    // Upgrade: V2 is now active but V1 is still known.
    setKeyProvider(makeProvider({ 1: keyV1, 2: keyV2 }, 2));
    expect(decrypt(blob)).toBe('payload');

    // New writes use V2.
    const blobV2 = encrypt('new payload');
    const bufV2 = Buffer.from(blobV2, 'base64url');
    expect(bufV2.readUInt8(0)).toBe(2);
    expect(decrypt(blobV2)).toBe('new payload');
  });

  it('throws when version key is no longer present', () => {
    const keyV1 = randomKey();
    setKeyProvider(makeProvider({ 1: keyV1 }, 1));
    const blob = encrypt('old data');

    // V1 has been rotated out.
    setKeyProvider(makeProvider({ 2: randomKey() }, 2));
    expect(() => decrypt(blob)).toThrow(/unknown key version/i);
  });
});

describe('nullable helpers', () => {
  beforeEach(() => {
    setKeyProvider(makeProvider({ 1: randomKey() }, 1));
  });

  it('encryptNullable passes null through', () => {
    expect(encryptNullable(null)).toBeNull();
  });

  it('decryptNullable passes null through', () => {
    expect(decryptNullable(null)).toBeNull();
  });

  it('encryptNullable encrypts non-null values', () => {
    const enc = encryptNullable('hello');
    expect(enc).not.toBeNull();
    expect(decryptNullable(enc)).toBe('hello');
  });
});
