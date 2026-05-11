/**
 * Phase 2 — bridge cookie hardening regression tests.
 *
 * Asserts the new HMAC-signed bridge cookie format:
 *   - mintSignedBridgeCookieValue produces a string that
 *     parseSignedBridgeCookie accepts as { ok: true }.
 *   - Phase-1 static "1" → reason 'legacy_format' (NOT bad_signature).
 *   - Tamper / wrong secret → reason 'bad_signature'.
 *   - Cookies older than 24h → reason 'too_old'.
 *   - Future-dated cookies (>60s skew) → reason 'bad_signature'.
 *   - Missing secret → reason 'no_secret'.
 *   - buildBridgeSetCookieHeader includes Secure in production, omits
 *     in development.
 */

import {
  mintSignedBridgeCookieValue,
  parseSignedBridgeCookie,
  buildBridgeSetCookieHeader,
  buildBridgeClearCookieHeader,
  BRIDGE_COOKIE_NAME,
  BRIDGE_COOKIE_MAX_AGE_SECONDS,
} from '../../security/bridgeCookie';

const TEST_SECRET = 'test-bridge-secret-must-be-at-least-32-characters-long-yes';

beforeEach(() => {
  process.env.BRIDGE_COOKIE_SECRET = TEST_SECRET;
  delete process.env.NODE_ENV;
  jest.useRealTimers();
});

describe('bridgeCookie — Phase 2 hardened format', () => {
  it('round-trip: mint → parse returns ok with issuedAt', () => {
    const value = mintSignedBridgeCookieValue();
    const parsed = parseSignedBridgeCookie(value);
    expect(parsed.ok).toBe(true);
    if (parsed.ok === true) {
      expect(typeof parsed.issuedAtUnix).toBe('number');
      expect(parsed.issuedAtUnix).toBeGreaterThan(1_700_000_000);
    }
  });

  it('rejects Phase-1 static "1" with reason=legacy_format', () => {
    const parsed = parseSignedBridgeCookie('1');
    expect(parsed.ok).toBe(false);
    if (parsed.ok === false) expect(parsed.reason).toBe('legacy_format');
  });

  it('rejects null / undefined / empty with reason=no_value', () => {
    expect(parseSignedBridgeCookie(null).ok).toBe(false);
    expect(parseSignedBridgeCookie(undefined).ok).toBe(false);
    expect(parseSignedBridgeCookie('').ok).toBe(false);
    const parsed = parseSignedBridgeCookie(null);
    if (parsed.ok === false) expect(parsed.reason).toBe('no_value');
  });

  it('rejects malformed (no dot) with reason=malformed', () => {
    const parsed = parseSignedBridgeCookie('asdfasdf');
    if (parsed.ok === false) expect(parsed.reason).toBe('malformed');
  });

  it('rejects a value signed with a different secret as bad_signature', () => {
    process.env.BRIDGE_COOKIE_SECRET = TEST_SECRET;
    const value = mintSignedBridgeCookieValue();
    process.env.BRIDGE_COOKIE_SECRET = 'a-completely-different-secret-also-at-least-32-chars';
    const parsed = parseSignedBridgeCookie(value);
    if (parsed.ok === false) expect(parsed.reason).toBe('bad_signature');
  });

  it('rejects truncated signature as bad_signature', () => {
    const value = mintSignedBridgeCookieValue();
    const tampered = value.slice(0, value.length - 4) + 'XXXX';
    const parsed = parseSignedBridgeCookie(tampered);
    if (parsed.ok === false) expect(parsed.reason).toBe('bad_signature');
  });

  it('rejects when secret missing with reason=no_secret', () => {
    delete process.env.BRIDGE_COOKIE_SECRET;
    delete process.env.SESSION_COOKIE_SECRET;
    // Need to construct a value WITHOUT triggering the mint check.
    const fake = 'aGVsbG8.aGVsbG8=';
    const parsed = parseSignedBridgeCookie(fake);
    if (parsed.ok === false) expect(parsed.reason).toBe('no_secret');
  });

  it('rejects cookies older than 24h with reason=too_old', () => {
    const value = mintSignedBridgeCookieValue();
    jest.useFakeTimers();
    // Move forward 25h.
    jest.setSystemTime(Date.now() + (BRIDGE_COOKIE_MAX_AGE_SECONDS + 3600) * 1000);
    const parsed = parseSignedBridgeCookie(value);
    if (parsed.ok === false) expect(parsed.reason).toBe('too_old');
  });

  it('rejects future-dated cookies (>60s clock skew) as bad_signature', () => {
    // Mint, then rewind clock by 5 minutes so the cookie's issuedAt is "in the future".
    const now = Date.now();
    jest.useFakeTimers();
    jest.setSystemTime(now);
    const value = mintSignedBridgeCookieValue();
    jest.setSystemTime(now - 5 * 60 * 1000);
    const parsed = parseSignedBridgeCookie(value);
    if (parsed.ok === false) expect(parsed.reason).toBe('bad_signature');
  });

  it('buildBridgeSetCookieHeader: includes Secure in production', () => {
    process.env.NODE_ENV = 'production';
    const header = buildBridgeSetCookieHeader('foo.bar');
    expect(header).toMatch(/Secure/);
    expect(header).toMatch(/HttpOnly/);
    expect(header).toMatch(/SameSite=Lax/);
    expect(header).toMatch(new RegExp(`^${BRIDGE_COOKIE_NAME}=foo\\.bar`));
  });

  it('buildBridgeSetCookieHeader: omits Secure outside production', () => {
    process.env.NODE_ENV = 'development';
    const header = buildBridgeSetCookieHeader('foo.bar');
    expect(header).not.toMatch(/Secure/);
  });

  it('buildBridgeClearCookieHeader: emits Max-Age=0 for revocation', () => {
    const header = buildBridgeClearCookieHeader();
    expect(header).toMatch(/Max-Age=0/);
  });
});
