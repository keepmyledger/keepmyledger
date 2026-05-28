/**
 * security/emailHash.test.ts
 *
 * Unit tests for the HMAC-SHA256 email hashing helper.
 */
import { hashEmail } from '../../auth/emailHash';

// Silence the self-host pepper warning (expected in test env without EMAIL_PEPPER).
beforeAll(() => { jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterAll(() => { jest.restoreAllMocks(); });

describe('hashEmail', () => {
  it('produces a deterministic hash for the same input', () => {
    expect(hashEmail('alice@example.com')).toBe(hashEmail('alice@example.com'));
  });

  it('normalises casing — uppercase and lowercase produce the same hash', () => {
    expect(hashEmail('Alice@Example.com')).toBe(hashEmail('alice@example.com'));
  });

  it('produces different hashes for different emails', () => {
    expect(hashEmail('alice@example.com')).not.toBe(hashEmail('bob@example.com'));
  });

  it('returns a non-empty base64url string', () => {
    const h = hashEmail('test@example.com');
    expect(typeof h).toBe('string');
    expect(h.length).toBeGreaterThan(0);
    // base64url characters only
    expect(h).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
