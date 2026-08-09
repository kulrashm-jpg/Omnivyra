/**
 * Phase 1 — Direct-Cookie Route Audit Guardrails regression tests.
 *
 * Asserts that `getLegacySuperAdminSession`:
 *   - returns the synthetic session when the cookie is present (default state)
 *   - returns null AND increments the dry-run counter when LEGACY_BRIDGE_DRY_RUN=1
 *   - returns null AND increments the hard-expired counter past LEGACY_BRIDGE_HARD_EXPIRY_AT
 *   - tracks per-route attribution
 *
 * If a future change reverts the helper to a bare cookie read (which is
 * what most other admin routes still do), these tests fail and force a
 * re-add of the guardrails.
 *
 * Audit-log inserts are mocked because the helper fires them as
 * fire-and-forget; we don't want test runs to require a live DB.
 */

jest.mock('../../security/audit/SecurityAuditService', () => ({
  logSecurityEvent: jest.fn().mockResolvedValue(undefined),
  logCookieSuperAdminUsage: jest.fn().mockResolvedValue(undefined),
  snapshotFromPrincipal: jest.fn().mockReturnValue({}),
}));

import type { NextApiRequest } from 'next';
import {
  getLegacySuperAdminSession,
  getBridgeBypassMetrics,
  resetBridgeBypassMetrics,
  LEGACY_SUPER_ADMIN_USER_ID,
} from '../../services/superAdminSession';
import { LEGACY_BRIDGE_HARD_EXPIRY_AT } from '../../security/legacyCookieSuperAdminBridge';
import { mintSignedBridgeCookieValue } from '../../security/bridgeCookie';

// Phase 2: bridge cookie is now HMAC-signed. Tests must mint a real
// signed value rather than the Phase-1 static "1".
process.env.BRIDGE_COOKIE_SECRET = process.env.BRIDGE_COOKIE_SECRET
  || 'test-bridge-secret-must-be-at-least-32-characters-long-yes';

function signedCookie(): string {
  return mintSignedBridgeCookieValue();
}

function fakeReq(opts: { cookie?: string | true; url?: string } = {}): NextApiRequest {
  let cookies: Record<string, string> = {};
  if (opts.cookie === true) cookies = { super_admin_session: signedCookie() };
  else if (typeof opts.cookie === 'string') cookies = { super_admin_session: opts.cookie };
  return {
    cookies,
    url: opts.url ?? '/api/test/route',
    headers: { 'user-agent': 'jest' },
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as NextApiRequest;
}

beforeEach(() => {
  resetBridgeBypassMetrics();
  delete process.env.LEGACY_BRIDGE_DRY_RUN;
});

afterEach(() => {
  jest.useRealTimers();
});

describe('getLegacySuperAdminSession — bridge-cookie guardrails', () => {
  it('returns null when no cookie present, no counter movement', () => {
    const out = getLegacySuperAdminSession(fakeReq({}));
    expect(out).toBeNull();
    const m = getBridgeBypassMetrics();
    expect(m.totalReads).toBe(0);
    expect(m.granted).toBe(0);
  });

  // Time is PINNED, not assumed. This assertion covers the grant path, which
  // production permits only before LEGACY_BRIDGE_HARD_EXPIRY_AT
  // (legacyCookieSuperAdminBridge.ts:94 returns `hard_expired` from `Date.now()`
  // onward). The constant is 2026-08-05T00:00:00Z, so on real time this test
  // silently became a wall-clock failure the moment that date passed — it was
  // asserting a live contract against an unpinned clock.
  //
  // The instant is derived FROM the production constant rather than hard-coded, so
  // the expiry is neither moved nor disabled and the test cannot rot again. The
  // post-expiry contract is deliberately NOT re-asserted here: the sibling
  // "increments hard-expired counter" test below already owns it, and duplicating
  // it here would delete the only coverage of the grant path and the `granted`
  // counter. Clock is restored by the existing afterEach `useRealTimers`.
  it('returns synthetic session when cookie present (pinned before hard expiry)', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(LEGACY_BRIDGE_HARD_EXPIRY_AT.getTime() - 1));
    // Minted AFTER pinning so the signed cookie and the read share one clock.
    const out = getLegacySuperAdminSession(fakeReq({ cookie: true, url: '/api/super-admin/foo' }));
    expect(out).toEqual({ userId: LEGACY_SUPER_ADMIN_USER_ID, role: 'SUPER_ADMIN' });
    const m = getBridgeBypassMetrics();
    expect(m.totalReads).toBe(1);
    expect(m.granted).toBe(1);
    expect(m.rejectedHardExpired).toBe(0);
    expect(m.byRoute['/api/super-admin/foo']).toBe(1);
  });

  it('returns null AND increments dry-run counter when LEGACY_BRIDGE_DRY_RUN=1', () => {
    process.env.LEGACY_BRIDGE_DRY_RUN = '1';
    const out = getLegacySuperAdminSession(fakeReq({ cookie: true, url: '/api/admin/dryrun' }));
    expect(out).toBeNull();
    const m = getBridgeBypassMetrics();
    expect(m.totalReads).toBe(1);
    expect(m.granted).toBe(0);
    expect(m.rejectedDryRun).toBe(1);
  });

  it('returns null AND increments hard-expired counter past LEGACY_BRIDGE_HARD_EXPIRY_AT', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(LEGACY_BRIDGE_HARD_EXPIRY_AT.getTime() + 1));
    const out = getLegacySuperAdminSession(fakeReq({ cookie: true, url: '/api/admin/expired' }));
    expect(out).toBeNull();
    const m = getBridgeBypassMetrics();
    expect(m.rejectedHardExpired).toBe(1);
    expect(m.granted).toBe(0);
  });

  it('tracks per-route attribution across multiple calls', () => {
    getLegacySuperAdminSession(fakeReq({ cookie: true, url: '/api/route-a' }));
    getLegacySuperAdminSession(fakeReq({ cookie: true, url: '/api/route-a' }));
    getLegacySuperAdminSession(fakeReq({ cookie: true, url: '/api/route-b' }));
    const m = getBridgeBypassMetrics();
    expect(m.byRoute['/api/route-a']).toBe(2);
    expect(m.byRoute['/api/route-b']).toBe(1);
    expect(m.totalReads).toBe(3);
  });

  it('strips query string from per-route key so metrics aggregate cleanly', () => {
    getLegacySuperAdminSession(fakeReq({ cookie: true, url: '/api/x?platform=linkedin' }));
    getLegacySuperAdminSession(fakeReq({ cookie: true, url: '/api/x?platform=facebook' }));
    const m = getBridgeBypassMetrics();
    expect(m.byRoute['/api/x']).toBe(2);
  });

  // Phase 2 — bridge cookie hardening regressions
  it('rejects Phase-1 static "1" cookie with legacy_format reason', () => {
    const out = getLegacySuperAdminSession(fakeReq({ cookie: '1', url: '/api/x' }));
    expect(out).toBeNull();
    const m = getBridgeBypassMetrics();
    expect(m.granted).toBe(0);
    expect(m.totalReads).toBe(1);
  });

  it('rejects forged signature with bad_signature reason', () => {
    const valid = signedCookie();
    // Truncate the signature so HMAC verify fails.
    const forged = valid.slice(0, valid.length - 4) + 'XXXX';
    const out = getLegacySuperAdminSession(fakeReq({ cookie: forged, url: '/api/x' }));
    expect(out).toBeNull();
    const m = getBridgeBypassMetrics();
    expect(m.granted).toBe(0);
  });

  it('rejects malformed (no dot) cookie value', () => {
    const out = getLegacySuperAdminSession(fakeReq({ cookie: 'not-a-signed-cookie', url: '/api/x' }));
    expect(out).toBeNull();
  });
});
