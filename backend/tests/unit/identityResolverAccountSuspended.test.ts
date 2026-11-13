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
jest.mock('../../security/legacyCookieSuperAdminBridge', () => ({ resolveLegacyCookieSuperAdminPrincipal: jest.fn(async () => null) }));
jest.mock('../../security/audit/SecurityAuditService', () => ({ logSecurityEvent: jest.fn(async () => undefined) }));
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
