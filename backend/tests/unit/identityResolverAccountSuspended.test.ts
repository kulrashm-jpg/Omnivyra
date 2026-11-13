/**
 * e9/05 (2026-11-14): a suspended user was already refused - authResolver returns ACCOUNT_SUSPENDED before any
 * principal is built - but IdentityResolver mapped that only through its INVALID_AUTH catch-all. It is now refused
 * BY INTENT with its own reason, so callers (which pass the reason through as the 401 code) say why.
 * Scaffold as identityResolverRequestMemo.test.ts (the real resolvePrincipal, authResolver mocked).
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
const bridge: { principal: unknown } = { principal: null };
jest.mock('../../security/legacyCookieSuperAdminBridge', () => ({ resolveLegacyCookieSuperAdminPrincipal: jest.fn(async () => bridge.principal) }));
const securityEvents: Array<Record<string, unknown>> = [];
jest.mock('../../security/audit/SecurityAuditService', () => ({ logSecurityEvent: jest.fn(async (e: Record<string, unknown>) => { securityEvents.push(e); }) }));
jest.mock('../../security/platformCapabilities', () => ({}));

import { resolvePrincipal } from '../../security/IdentityResolver';

let n = 0;
const freshReq = () => ({ headers: { 'x-id': `req-${n++}` }, query: {}, body: {} }) as any;

it('a suspended user is refused with ACCOUNT_SUSPENDED (by intent, not via the INVALID_AUTH catch-all)', async () => {
  resolveAuthenticatedUserMock.mockResolvedValue({ user: null, error: 'ACCOUNT_SUSPENDED' });
  expect(await resolvePrincipal(freshReq())).toEqual({ ok: false, reason: 'ACCOUNT_SUSPENDED' });
});

it.each([
  ['ACCOUNT_DELETED', 'ACCOUNT_DELETED'],
  ['USER_NOT_FOUND', 'USER_NOT_FOUND'],
  ['NO_TOKEN', 'NO_AUTH'],
  ['INVALID_TOKEN', 'INVALID_AUTH'],
])('controls: %s -> %s (unchanged)', async (authError, reason) => {
  resolveAuthenticatedUserMock.mockResolvedValue({ user: null, error: authError });
  expect(await resolvePrincipal(freshReq())).toEqual({ ok: false, reason });
});

describe('05: a refused lifecycle state is RECORDED before the bridge fallback', () => {
  beforeEach(() => { securityEvents.length = 0; bridge.principal = null; });

  it.each(['ACCOUNT_SUSPENDED', 'ACCOUNT_DELETED'])('%s: a security event is logged even though no bridge exists', async (code) => {
    resolveAuthenticatedUserMock.mockResolvedValue({ user: null, error: code });
    await resolvePrincipal(freshReq());
    expect(securityEvents).toContainEqual(expect.objectContaining({ decision: 'lifecycle_refused_identity_attempt', reason: expect.stringContaining(code) }));
  });

  it('with a bridge principal present the request still resolves to the bridge (authorization unchanged) - and the attempt is recorded', async () => {
    resolveAuthenticatedUserMock.mockResolvedValue({ user: null, error: 'ACCOUNT_SUSPENDED' });
    bridge.principal = { userId: 'env-super-admin', legacyCookieSuperAdmin: true };
    const r = await resolvePrincipal(freshReq());
    expect(r).toMatchObject({ ok: true, principal: { userId: 'env-super-admin' } });
    expect(securityEvents).toContainEqual(expect.objectContaining({ decision: 'lifecycle_refused_identity_attempt' }));
  });

  it('control: an ordinary invalid token is not recorded as a lifecycle refusal', async () => {
    resolveAuthenticatedUserMock.mockResolvedValue({ user: null, error: 'INVALID_TOKEN' });
    await resolvePrincipal(freshReq());
    expect(securityEvents.filter((e) => e.decision === 'lifecycle_refused_identity_attempt')).toEqual([]);
  });
});
