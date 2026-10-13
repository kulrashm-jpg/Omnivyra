/**
 * Closure-014 (B) — the pure pre-reservation predicates. They never write a
 * response or audit; they only answer "could this caller possibly be
 * authorized?" with the guard's own predicates, so they can never authorize.
 */
const mockResolve = jest.fn();
jest.mock('../../security/IdentityResolver', () => ({ resolvePrincipal: (...a: unknown[]) => mockResolve(...a) }));

import { mayAttemptCapability, mayAttemptInvite } from '../../security/preAuthorization';
import { BILLING_GRANT_FREE_CREDITS, CAMPAIGN_VIEW, IDENTITY_ADMIN_ASSIGN, IDENTITY_ADMIN_DELETE } from '../../../shared/contracts/security';

const P = (over: Record<string, unknown>) => ({ ok: true, principal: { userId: 'u', organizations: [], capabilities: [], legacyCookieSuperAdmin: false, ...over } });
const SA_ORG = [{ organizationId: 'p', role: 'SUPER_ADMIN', status: 'active' }];
const req = (method = 'POST') => ({ method, headers: {} }) as never;

beforeEach(() => mockResolve.mockReset());

describe('mayAttemptCapability', () => {
  it('an active SUPER_ADMIN holding the platform write capability may attempt', async () => {
    mockResolve.mockResolvedValue(P({ organizations: SA_ORG, capabilities: [BILLING_GRANT_FREE_CREDITS] }));
    expect(await mayAttemptCapability(BILLING_GRANT_FREE_CREDITS)(req())).toBe(true);
  });
  it('a direct-grant holder without platform authority may NOT (no reservation)', async () => {
    mockResolve.mockResolvedValue(P({ organizations: [{ organizationId: 'a', role: 'VIEW_ONLY', status: 'active' }], capabilities: [BILLING_GRANT_FREE_CREDITS] }));
    expect(await mayAttemptCapability(BILLING_GRANT_FREE_CREDITS)(req())).toBe(false);
  });
  it('a principal that does not hold the capability may NOT', async () => {
    mockResolve.mockResolvedValue(P({ organizations: SA_ORG, capabilities: [] }));
    expect(await mayAttemptCapability(BILLING_GRANT_FREE_CREDITS)(req())).toBe(false);
  });
  it('a bridge principal claiming everything may NOT attempt a platform write', async () => {
    mockResolve.mockResolvedValue(P({ organizations: SA_ORG, capabilities: [BILLING_GRANT_FREE_CREDITS], legacyCookieSuperAdmin: true }));
    expect(await mayAttemptCapability(BILLING_GRANT_FREE_CREDITS)(req())).toBe(false);
  });
  it('an unauthenticated request may NOT', async () => {
    mockResolve.mockResolvedValue({ ok: false, reason: 'NO_TOKEN' });
    expect(await mayAttemptCapability(BILLING_GRANT_FREE_CREDITS)(req())).toBe(false);
  });
  it('a non-platform capability needs only to be held', async () => {
    mockResolve.mockResolvedValue(P({ capabilities: [CAMPAIGN_VIEW] }));
    expect(await mayAttemptCapability(CAMPAIGN_VIEW)(req())).toBe(true);
  });
  it('per-method capability selection (users dispatch): DELETE needs .delete, POST needs .assign; no capability → handler decides', async () => {
    const pick = (r: { method?: string }) => (r.method === 'DELETE' ? IDENTITY_ADMIN_DELETE : r.method === 'POST' ? IDENTITY_ADMIN_ASSIGN : null);
    mockResolve.mockResolvedValue(P({ organizations: SA_ORG, capabilities: [IDENTITY_ADMIN_ASSIGN] }));
    expect(await mayAttemptCapability(pick as never)(req('POST'))).toBe(true);
    expect(await mayAttemptCapability(pick as never)(req('DELETE'))).toBe(false);
    expect(await mayAttemptCapability(pick as never)(req('GET'))).toBe(true);
  });
});

describe('mayAttemptInvite', () => {
  it.each([
    ['active SUPER_ADMIN', SA_ORG, false, true],
    ['active COMPANY_ADMIN', [{ organizationId: 'a', role: 'COMPANY_ADMIN', status: 'active' }], false, true],
    ['VIEW_ONLY', [{ organizationId: 'a', role: 'VIEW_ONLY', status: 'active' }], false, false],
    ['inactive COMPANY_ADMIN', [{ organizationId: 'a', role: 'COMPANY_ADMIN', status: 'inactive' }], false, false],
    ['lowercase company_admin (exact-match, as the route itself)', [{ organizationId: 'a', role: 'company_admin', status: 'active' }], false, false],
    ['bridge', SA_ORG, true, false],
  ])('%s → %s', async (_n, orgs, bridge, expected) => {
    mockResolve.mockResolvedValue(P({ organizations: orgs, legacyCookieSuperAdmin: bridge }));
    expect(await mayAttemptInvite(req())).toBe(expected);
  });
});
