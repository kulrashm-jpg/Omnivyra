/**
 * Owner principle 2026-11-12 - the helper's own guarantees (05 / e9):
 *  - the PLATFORM step-up policy is applied EXPLICITLY: registering a (weaker)
 *    policy for ORGANIZATION_MANAGE later must not change what a cross-tenant
 *    Super Admin write needs; a missing platform policy refuses;
 *  - membership is decided from the rows inside the helper, never by the caller;
 *  - reads never step up.
 */
const PLATFORM = { capability: 'platform.controls.manage', maxAgeSeconds: 600, phishingResistantOnly: true, trustedDeviceRequired: true };
let mockPolicies: Record<string, unknown> = {};
let mockRoles: Record<string, string> = {};
let mockPrincipal: Record<string, unknown> | null = null;
const roleLookups: Array<[string, string]> = [];

jest.mock('../../security/stepup/StepUpPolicyRegistry', () => ({
  getStepUpPolicy: (cap: string) => (mockPolicies[cap] as unknown) ?? null,
}));
jest.mock('../../services/rbacService', () => ({
  getUserRole: async (u: string, c: string) => { roleLookups.push([u, c]); return { role: mockRoles[u] ?? null, error: null }; },
}));
jest.mock('../../security/IdentityResolver', () => ({
  resolvePrincipal: async () => (mockPrincipal ? { ok: true, principal: mockPrincipal } : { ok: false, reason: 'NO_AUTH' }),
}));
jest.mock('../../security/audit/SecurityAuditService', () => ({ logSecurityEvent: jest.fn(async () => undefined) }));

import { requireSuperAdminCrossTenantStepUp } from '../../security/superAdminCrossTenantStepUp';

const FUTURE = () => new Date(Date.now() + 5 * 60_000);
const principal = (factor: 'webauthn' | 'totp' | null, trusted = true) => ({
  userId: 'sa', supabaseUid: 'sa', sessionId: 's1', legacyCookieSuperAdmin: false,
  stepUp: factor ? { active: true, expiresAt: FUTURE(), factor, sessionId: 'su' } : { active: false, expiresAt: null, factor: null, sessionId: null },
  device: { deviceId: trusted ? 'd' : null, trusted, fingerprint: 'f' },
  mfa: { enrolled: true, factors: ['webauthn'], lastVerifiedAt: null, phishingResistant: true },
});
async function run(method: string, companyId: string | null = 'co-b') {
  const out = { code: 0, body: {} as Record<string, unknown> };
  const res = { status: (c: number) => { out.code = c; return res; }, json: (b: Record<string, unknown>) => { out.body = b; return res; }, setHeader: () => res };
  const ok = await requireSuperAdminCrossTenantStepUp({ method, headers: {} } as never, res as never, { companyId });
  return { ok, ...out };
}

beforeEach(() => {
  mockPolicies = { 'platform.controls.manage': PLATFORM };
  mockRoles = {}; mockPrincipal = principal(null); roleLookups.length = 0;
});

it('reads never step up (no membership lookup either)', async () => {
  expect((await run('GET')).ok).toBe(true);
  expect(roleLookups).toEqual([]);
});

it('membership is decided from the rows for the AUTHENTICATED actor: an active role -> no step-up', async () => {
  mockRoles = { sa: 'COMPANY_ADMIN' };
  expect((await run('POST')).ok).toBe(true);
  expect(roleLookups).toEqual([['sa', 'co-b']]);
});

it("another user's membership never counts: only the authenticated actor is judged (05)", async () => {
  mockRoles = { 'some-target-user': 'COMPANY_ADMIN' };   // e.g. the invitee of a write
  const r = await run('POST');
  expect(r.ok).toBe(false);
  expect(r.code).toBe(401);
  expect(roleLookups).toEqual([['sa', 'co-b']]);
});

it('cross-tenant write without step-up -> 401 STEP_UP_REQUIRED', async () => {
  const r = await run('POST');
  expect(r.ok).toBe(false);
  expect(r.code).toBe(401);
  expect(r.body).toMatchObject({ code: 'STEP_UP_REQUIRED' });
});

it('cross-tenant write with a passkey step-up on a trusted device -> allowed', async () => {
  mockPrincipal = principal('webauthn');
  expect((await run('PATCH')).ok).toBe(true);
});

it('EXPLICIT policy: registering a weaker ORGANIZATION_MANAGE policy does NOT relax it (TOTP still refused)', async () => {
  mockPolicies['organization.manage'] = { capability: 'organization.manage', maxAgeSeconds: 3600, phishingResistantOnly: false, trustedDeviceRequired: false };
  mockPrincipal = principal('totp', false);
  const r = await run('POST');
  expect(r.ok).toBe(false);
  expect(r.code).toBe(401);
});

it('the platform policy cannot be resolved -> refused (never a fallback policy)', async () => {
  mockPolicies = { 'organization.manage': { capability: 'organization.manage', maxAgeSeconds: 3600 } };
  mockPrincipal = principal('webauthn');
  const r = await run('POST');
  expect(r.ok).toBe(false);
  expect(r.body).toMatchObject({ code: 'STEP_UP_REQUIRED' });
});

it('no principal -> 401, never allowed', async () => {
  mockPrincipal = null;
  expect((await run('POST')).code).toBe(401);
});

it('a principal missing its step-up state is refused cleanly, not a crash', async () => {
  mockPrincipal = { userId: 'sa', legacyCookieSuperAdmin: false };
  expect((await run('POST')).code).toBe(401);
});
