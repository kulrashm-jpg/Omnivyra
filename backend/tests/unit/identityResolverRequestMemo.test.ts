/**
 * OR-09 post-audit — request-local reuse of resolvePrincipal (behavioural).
 *
 * The audit measured resolution at one Supabase auth round-trip (5 s timeout)
 * plus ~10 database reads, executed TWICE per request on any route that both
 * adopts withIdempotency and authorizes in its handler.
 *
 * These tests drive the REAL resolvePrincipal and count how often the
 * underlying authentication work runs. They also pin the safety properties the
 * memo must never violate: it is per-request, never shared across requests, and
 * never shared across users.
 */
const resolveAuthenticatedUserMock = jest.fn();

jest.mock('../../services/authResolver', () => ({
  resolveAuthenticatedUser: (...a: unknown[]) => resolveAuthenticatedUserMock(...a),
  extractAccessToken: jest.fn(() => 'tok'),
}));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn() } }));
jest.mock('../../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../../services/userColumnProjection', () => ({ tolerantUserSelect: jest.fn() }));
jest.mock('../../security/SessionAuthorityService', () => ({ resolveSessionFromRequest: jest.fn(async () => ({ ok: false })), touchSession: jest.fn() }));
jest.mock('../../security/CapabilityService', () => ({ resolveUserCapabilities: jest.fn(async () => []) }));
jest.mock('../../security/legacyCookieSuperAdminBridge', () => ({ resolveLegacyCookieSuperAdminPrincipal: jest.fn(async () => null) }));
jest.mock('../../security/audit/SecurityAuditService', () => ({ logSecurityEvent: jest.fn(async () => undefined) }));
jest.mock('../../security/platformCapabilities', () => ({}));

import { resolvePrincipal } from '../../security/IdentityResolver';

const req = (id: string) => ({ headers: { 'x-id': id }, query: {}, body: {} }) as any;

beforeEach(() => {
  jest.clearAllMocks();
  resolveAuthenticatedUserMock.mockResolvedValue({ user: null, error: 'NO_TOKEN' });
});

describe('request-local reuse', () => {
  it('resolves the underlying identity at most once per request', async () => {
    const r = req('req-1');
    await resolvePrincipal(r);
    await resolvePrincipal(r);
    await resolvePrincipal(r);

    // Three calls — the audit's double-resolution case and then some.
    expect(resolveAuthenticatedUserMock).toHaveBeenCalledTimes(1);
  });

  it('returns an identical result on every call for the same request', async () => {
    const r = req('req-1');
    const a = await resolvePrincipal(r);
    const b = await resolvePrincipal(r);
    expect(b).toEqual(a);
  });

  it('deduplicates CONCURRENT callers on one request into a single resolution', async () => {
    const r = req('req-1');
    const [a, b] = await Promise.all([resolvePrincipal(r), resolvePrincipal(r)]);
    expect(resolveAuthenticatedUserMock).toHaveBeenCalledTimes(1);
    expect(b).toEqual(a);
  });
});

describe('memo safety', () => {
  it('NEVER reuses across requests', async () => {
    await resolvePrincipal(req('req-1'));
    await resolvePrincipal(req('req-2'));
    // A distinct request object must trigger its own resolution.
    expect(resolveAuthenticatedUserMock).toHaveBeenCalledTimes(2);
  });

  it('NEVER reuses across users', async () => {
    resolveAuthenticatedUserMock.mockResolvedValueOnce({ user: null, error: 'NO_TOKEN' });
    const first = await resolvePrincipal(req('user-A-request'));

    resolveAuthenticatedUserMock.mockResolvedValueOnce({ user: null, error: 'INVALID_TOKEN' });
    const second = await resolvePrincipal(req('user-B-request'));

    expect(resolveAuthenticatedUserMock).toHaveBeenCalledTimes(2);
    void first; void second;
  });

  it('stores the memo non-enumerably so it cannot leak into serialization', async () => {
    const r = req('req-1');
    await resolvePrincipal(r);
    // Request hashing, logging and JSON serialization must not see the memo.
    expect(Object.keys(r)).not.toContain('principalMemo');
    expect(JSON.stringify(r)).not.toContain('principalMemo');
    expect(Object.getOwnPropertyNames(r)).toEqual(expect.not.arrayContaining(['principalMemo']));
  });

  it('degrades safely when the request cannot carry a memo', async () => {
    const frozen = Object.freeze(req('frozen'));
    // Must not throw; simply resolves without memoizing.
    await expect(resolvePrincipal(frozen)).resolves.toBeDefined();
    await expect(resolvePrincipal(frozen)).resolves.toBeDefined();
  });
});
