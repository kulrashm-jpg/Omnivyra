/**
 * Closure-015D (Workstream D) — the route-policy gate's principal view never
 * treats an INVITED SUPER_ADMIN membership as platform super admin.
 *
 * lib/platform/policyGate.ts built `isPlatformSuperAdmin` from every active OR
 * invited membership, so a principal whose only SUPER_ADMIN row was invited
 * would be "platform_super_admin" for every super-admin and company-scoped
 * policy. The gate is observation-only today (Phase 1: it logs, never blocks),
 * so this was latent — it would have become a platform-wide grant the day
 * enforcement lands. It now requires an ACTIVE SUPER_ADMIN membership (the
 * canonical isPlatformSuperAdminPrincipal predicate).
 *
 * REAL: observePolicy → buildPrincipalView → evaluatePolicy. MOCKED: the
 * resolved principal (IdentityResolver), the content-architect check, the logger
 * (the observation sink this test reads).
 */
const mockResolvePrincipal = jest.fn();
jest.mock('../../../backend/security/IdentityResolver', () => ({ resolvePrincipal: (...a: unknown[]) => mockResolvePrincipal(...a) }));
jest.mock('../../../backend/services/contentArchitectService', () => ({ isContentArchitectSession: jest.fn().mockReturnValue(false) }));
jest.mock('../../../backend/services/logger', () => ({ logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

import type { NextApiRequest } from 'next';
import { observePolicy } from '../../../lib/platform/policyGate';
import type { RoutePolicy } from '../../../lib/platform/routePolicy';
import { logger } from '../../../backend/services/logger';

const GATE = 'ROLLOUT_ROUTE_POLICY_GATE_MODE';
const saved: Record<string, string | undefined> = {};
const SUPER_ADMIN_POLICY: RoutePolicy = { v: 1, category: 'super-admin', audit: true };
const COMPANY_POLICY: RoutePolicy = { v: 1, category: 'company-scoped', companyIdFrom: 'query.companyId' };

function principalWith(organizations: { organizationId: string; role: string; status: string }[]) {
  return {
    ok: true,
    principal: {
      userId: 'user-1', supabaseUid: 'uid-1', email: 'u@example.test', emailVerified: true,
      sessionId: null, sessionAgeSeconds: 0, sessionStaleSeconds: 0,
      organizations, activeOrgId: null, capabilities: [],
      mfa: { enrolled: false, factors: [], lastVerifiedAt: null, phishingResistant: false },
      device: { deviceId: null, trusted: false, fingerprint: 'f' },
      stepUp: { active: false, expiresAt: null, factor: null, sessionId: null },
      legacyCookieSuperAdmin: false,
    },
  };
}
const req = (companyId = 'company-b') =>
  ({ method: 'POST', url: '/api/probe', headers: {}, cookies: {}, query: { companyId }, body: {} }) as unknown as NextApiRequest;
function lastObservation(): Record<string, unknown> {
  const calls = (logger.info as jest.Mock).mock.calls.filter((c) => c[0] === 'route_policy_shadow_observation');
  return calls[calls.length - 1]?.[1] as Record<string, unknown>;
}

beforeEach(() => {
  saved[GATE] = process.env[GATE];
  process.env[GATE] = 'shadow';
  (logger.info as jest.Mock).mockClear();
  mockResolvePrincipal.mockReset();
});
afterEach(() => {
  if (saved[GATE] === undefined) delete process.env[GATE]; else process.env[GATE] = saved[GATE];
});

describe('policyGate principal view — platform super admin requires an ACTIVE SUPER_ADMIN row', () => {
  it('invited SUPER_ADMIN only → a super-admin policy would DENY (not_super_admin)', async () => {
    mockResolvePrincipal.mockResolvedValue(principalWith([{ organizationId: 'company-a', role: 'SUPER_ADMIN', status: 'invited' }]));
    await observePolicy(SUPER_ADMIN_POLICY, '/api/probe', req());
    expect(lastObservation()).toMatchObject({ wouldAllow: false, wouldDeny: true, reason: 'not_super_admin' });
  });

  it('invited SUPER_ADMIN of A → a company-scoped policy for B would DENY (no platform bypass)', async () => {
    mockResolvePrincipal.mockResolvedValue(principalWith([{ organizationId: 'company-a', role: 'SUPER_ADMIN', status: 'invited' }]));
    await observePolicy(COMPANY_POLICY, '/api/probe', req('company-b'));
    expect(lastObservation()).toMatchObject({ wouldAllow: false, wouldDeny: true, reason: 'not_a_member' });
  });

  it.each(['inactive', 'deactivated'])('%s SUPER_ADMIN row → not a platform super admin', async (status) => {
    mockResolvePrincipal.mockResolvedValue(principalWith([{ organizationId: 'company-a', role: 'SUPER_ADMIN', status }]));
    await observePolicy(SUPER_ADMIN_POLICY, '/api/probe', req());
    expect(lastObservation()).toMatchObject({ wouldAllow: false, reason: 'not_super_admin' });
  });

  it('ACTIVE SUPER_ADMIN row → platform super admin (unchanged): super-admin and cross-company policies would ALLOW', async () => {
    mockResolvePrincipal.mockResolvedValue(principalWith([{ organizationId: 'company-a', role: 'SUPER_ADMIN', status: 'active' }]));
    await observePolicy(SUPER_ADMIN_POLICY, '/api/probe', req());
    expect(lastObservation()).toMatchObject({ wouldAllow: true, reason: 'platform_super_admin' });
    await observePolicy(COMPANY_POLICY, '/api/probe', req('company-b'));
    expect(lastObservation()).toMatchObject({ wouldAllow: true, reason: 'platform_super_admin' });
  });
});
