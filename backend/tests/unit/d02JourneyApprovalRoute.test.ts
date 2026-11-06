/**
 * D-02 — who may approve a journey step: authorised TENANT approvers only.
 *
 * The route's authorization runs for real — `requireCapability`, `decideCapability`, the
 * per-organisation capability check and the capability registry — against principals
 * built from real role mappings. Only the principal source, the audit sink and the
 * approval service (whose own rules are proved in d02ApprovalBinding.test.ts) are
 * replaced.
 */

type Membership = { organizationId: string; role: string; status: 'active' };

const mockPrincipals: Record<string, unknown> = {};
jest.mock('../../security/IdentityResolver', () => ({
  resolvePrincipal: async (req: { headers: Record<string, string> }) => {
    const p = mockPrincipals[req.headers['x-test-user'] ?? ''];
    return p ? { ok: true, principal: p } : { ok: false, reason: 'NO_SESSION' };
  },
}));
jest.mock('../../security/audit/SecurityAuditService', () => ({
  logSecurityEvent: async () => undefined,
  snapshotFromPrincipal: () => ({}),
}));
jest.mock('../../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../auth/requestClientIp', () => ({ authRequestIpOrNull: () => null }));
const mockSvc = {
  begin: jest.fn(async () => ({ ok: true, contentHash: 'h', preview: null, passkeyRequired: true, passkeyOptions: { challenge: 'c' } })),
  approve: jest.fn(async () => ({ ok: true, status: 'approved' })),
  revoke: jest.fn(async () => ({ ok: true, status: 'cancelled' })),
  resubmit: jest.fn(async () => ({ ok: true, status: 'awaiting_approval' })),
};
jest.mock('../../services/orchestration/journeyApproval', () => ({
  beginTenantJourneyApproval: (a: unknown) => mockSvc.begin(a),
  approveTenantJourneyTask: (a: unknown) => mockSvc.approve(a),
  revokeTenantJourneyApproval: (a: unknown) => mockSvc.revoke(a),
  resubmitTenantJourneyTask: (a: unknown) => mockSvc.resubmit(a),
}));

const mockOperator = {
  approve: jest.fn(async (..._a: unknown[]) => ({ ok: true, status: 'approved' })),
  begin: jest.fn(async (..._a: unknown[]) => ({ ok: true, contentHash: 'h', passkeyRequired: true, passkeyOptions: { challenge: 'c' } })),
};
jest.mock('../../services/leadOutreachActivation', () => ({
  approveOutreachTaskForOperator: (...a: unknown[]) => mockOperator.approve(...a),
  beginOperatorApproval: (...a: unknown[]) => mockOperator.begin(...a),
}));
// W2 — the existing limiter, recorded and switchable per test.
const mockRateLimit = { allow: true, keys: [] as string[] };
jest.mock('../../services/requestAccessService', () => ({
  requireAdminRateLimit: async (_req: unknown, res: { status: (c: number) => { json: (b: unknown) => unknown } }, key: string) => {
    mockRateLimit.keys.push(key);
    if (mockRateLimit.allow) return true;
    res.status(429).json({ code: 'RATE_LIMITED' });
    return false;
  },
}));

import handler from '../../../pages/api/outreach/journey-approval';
import platformHandler from '../../../pages/api/super-admin/outreach/approve';
import { capabilitiesForRole, ROLE_CAPABILITIES } from '../../security/capabilityRegistry';
import { PLATFORM_TIER_CAPABILITIES } from '../../security/platformCapabilities';
import { getStepUpPolicy } from '../../security/stepup/StepUpPolicyRegistry';
import { OUTREACH_JOURNEY_APPROVE, STEP_UP_REQUIRED_CAPABILITIES } from '../../../shared/contracts/security';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const P = '44444444-4444-4444-8444-444444444444';

function principal(userId: string, memberships: Membership[], bridge = false) {
  const byOrganization: Record<string, string[]> = {};
  for (const m of memberships) byOrganization[m.organizationId] = [...capabilitiesForRole(m.role)];
  return {
    userId, supabaseUid: `sb-${userId}`, email: `${userId}@example.test`, emailVerified: true,
    sessionId: `sess-${userId}`, sessionAgeSeconds: 1, sessionStaleSeconds: 0,
    organizations: memberships, activeOrgId: null,
    capabilities: [...new Set(Object.values(byOrganization).flat())],
    capabilityScope: { byOrganization, global: [] },
    mfa: { enrolled: true, factors: ['webauthn'], lastVerifiedAt: null, phishingResistant: true },
    device: { deviceId: 'd', trusted: true, fingerprint: 'f' },
    stepUp: { active: true, expiresAt: new Date(Date.now() + 300_000), factor: 'webauthn', sessionId: 'su' },
    legacyCookieSuperAdmin: bridge,
  };
}
const m = (organizationId: string, role: string): Membership => ({ organizationId, role, status: 'active' });

beforeAll(() => {
  Object.assign(mockPrincipals, {
    super: principal('u-super', [m(P, 'SUPER_ADMIN')]),
    superWithTenantRole: principal('u-super2', [m(P, 'SUPER_ADMIN'), m(A, 'COMPANY_ADMIN')]),
    bridge: { ...principal('legacy', [m(A, 'COMPANY_ADMIN')], true) },
    admin: principal('u-admin', [m(A, 'COMPANY_ADMIN')]),
    reviewer: principal('u-reviewer', [m(A, 'CONTENT_REVIEWER')]),
    creator: principal('u-creator', [m(A, 'CONTENT_CREATOR')]),
    publisher: principal('u-publisher', [m(A, 'CONTENT_PUBLISHER')]),
    architect: principal('u-architect', [m(A, 'CONTENT_ARCHITECT')]),
    viewer: principal('u-viewer', [m(A, 'VIEW_ONLY')]),
    adminElsewhere: principal('u-admin-b', [m(B, 'COMPANY_ADMIN'), m(A, 'VIEW_ONLY')]),
  });
});
beforeEach(() => { for (const f of Object.values(mockSvc)) f.mockClear(); mockRateLimit.allow = true; mockRateLimit.keys = []; });

type Res = { statusCode: number; body: unknown } & Record<string, unknown>;
async function call(user: string | null, body: Record<string, unknown>, method = 'POST') {
  const res = { statusCode: 200, body: undefined } as Res;
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.setHeader = () => res;
  const req = { method, headers: user ? { 'x-test-user': user } : {}, body, query: {}, socket: {}, cookies: {}, url: '/api/outreach/journey-approval' };
  await (handler as unknown as (q: unknown, s: unknown) => Promise<unknown>)(req, res);
  return res;
}
const approveBody = { companyId: A, taskId: 't-1', action: 'approve', expectedContentHash: 'a'.repeat(64), passkey: { id: 'x' } };
const effects = () => mockSvc.begin.mock.calls.length + mockSvc.approve.mock.calls.length + mockSvc.revoke.mock.calls.length + mockSvc.resubmit.mock.calls.length;

describe('D-02 — the capability', () => {
  it('is held by COMPANY_ADMIN and CONTENT_REVIEWER only — never by SUPER_ADMIN', () => {
    const holders = Object.keys(ROLE_CAPABILITIES).filter((r) => capabilitiesForRole(r).includes(OUTREACH_JOURNEY_APPROVE)).sort();
    expect(holders).toEqual(['COMPANY_ADMIN', 'CONTENT_REVIEWER']);
  });
  it('is tenant tier, with the per-approval passkey instead of a session step-up', () => {
    expect(PLATFORM_TIER_CAPABILITIES).not.toContain(OUTREACH_JOURNEY_APPROVE);
    expect(STEP_UP_REQUIRED_CAPABILITIES).not.toContain(OUTREACH_JOURNEY_APPROVE);
    expect(getStepUpPolicy(OUTREACH_JOURNEY_APPROVE)).toBeNull();
  });
});

describe('D-02 — routine approvers', () => {
  it.each(['admin', 'reviewer'])('%s of the tenant is allowed; the approver is the authenticated user', async (who) => {
    const r = await call(who, { ...approveBody, approverUserId: 'someone-else' });
    expect(r.statusCode).toBe(200);
    expect(mockSvc.approve).toHaveBeenCalledTimes(1);
    expect(mockSvc.approve.mock.calls[0][0]).toMatchObject({ organizationId: A, taskId: 't-1', approverUserId: `u-${who}` });
    expect(JSON.stringify(mockSvc.approve.mock.calls[0])).not.toContain('someone-else');
  });

  it('a platform super-admin is refused as a routine approver', async () => {
    const r = await call('super', approveBody);
    expect(r.statusCode).toBe(403);
    expect(effects()).toBe(0);
  });

  it('a platform super-admin who also holds a tenant role is still refused', async () => {
    const r = await call('superWithTenantRole', approveBody);
    expect(r.statusCode).toBe(403);
    expect((r.body as { code: string }).code).toBe('PLATFORM_PRINCIPAL_NOT_ROUTINE_APPROVER');
    expect(effects()).toBe(0);
  });

  it.each(['bridge', 'creator', 'publisher', 'architect', 'viewer', 'adminElsewhere'])('%s is refused', async (who) => {
    const r = await call(who, approveBody);
    expect(r.statusCode).toBe(403);
    expect(effects()).toBe(0);
  });

  it('unauthenticated is refused 401', async () => {
    expect((await call(null, approveBody)).statusCode).toBe(401);
    expect(effects()).toBe(0);
  });

  it.each([['begin', 'begin'], ['revoke', 'revoke'], ['resubmit', 'resubmit']])('%s reaches only its own service call', async (action, fn) => {
    const r = await call('reviewer', { companyId: A, taskId: 't-1', action });
    expect(r.statusCode).toBe(200);
    expect(mockSvc[fn as keyof typeof mockSvc]).toHaveBeenCalledTimes(1);
    expect(effects()).toBe(1);
  });

  it('a refusal maps to a status and code; nothing else runs', async () => {
    mockSvc.approve.mockResolvedValueOnce({ ok: false, code: 'passkey_replayed', reason: 'used' } as never);
    const r = await call('admin', approveBody);
    expect(r.statusCode).toBe(401);
    expect(r.body).toMatchObject({ ok: false, code: 'passkey_replayed' });
  });

  it('the platform override always enforces the per-approval passkey, and stays platform-only', async () => {
    const res = { statusCode: 200, body: undefined } as Res;
    res.status = (c: number) => { res.statusCode = c; return res; };
    res.json = (b: unknown) => { res.body = b; return res; };
    res.setHeader = () => res;
    const req = (user: string, body: Record<string, unknown>) => ({ method: 'POST', headers: { 'x-test-user': user }, body, query: {}, socket: {}, cookies: {}, url: '/api/super-admin/outreach/approve' });
    await (platformHandler as unknown as (q: unknown, s: unknown) => Promise<unknown>)(req('super', { companyId: A, taskId: 't-1', reason: 'override', passkey: { id: 'p' } }), res);
    expect(res.statusCode).toBe(200);
    expect(mockOperator.approve).toHaveBeenCalledTimes(1);
    expect(mockOperator.approve.mock.calls[0][5]).toMatchObject({ passkey: { id: 'p' } });
    // D-02 (S-02) — there is no opt-out left to pass: the service always enforces it.
    expect(mockOperator.approve.mock.calls[0][5]).not.toHaveProperty('enforcePasskey');
    mockOperator.approve.mockClear();
    await (platformHandler as unknown as (q: unknown, s: unknown) => Promise<unknown>)(req('admin', { companyId: A, taskId: 't-1', reason: 'override' }), res);
    expect(res.statusCode).toBe(403);
    expect(mockOperator.approve).not.toHaveBeenCalled();
  });

  it('W2: `begin` is rate-limited by the existing limiter; a limited begin writes no challenge', async () => {
    mockRateLimit.allow = false;
    const r = await call('reviewer', { companyId: A, taskId: 't-1', action: 'begin' });
    expect(r.statusCode).toBe(429);
    expect(mockSvc.begin).not.toHaveBeenCalled();
    expect(mockRateLimit.keys).toEqual(['rl:outreach:journey-approval-begin']);
    // Only `begin` writes a challenge row, so only `begin` is limited here.
    mockRateLimit.keys = [];
    await call('reviewer', approveBody);
    expect(mockRateLimit.keys).toEqual([]);
  });

  it('bad requests are refused before authorization', async () => {
    expect((await call('admin', { companyId: A, taskId: 't-1', action: 'approve_all' })).statusCode).toBe(400);
    expect((await call('admin', approveBody, 'GET')).statusCode).toBe(405);
    expect(effects()).toBe(0);
  });
});

describe('N2 — the resubmit requester is the authenticated principal', () => {
  const resubmitBody = { companyId: A, taskId: 't-1', action: 'resubmit' };

  it.each(['admin', 'reviewer'])('%s: the service gets the session user and the reason; a body-supplied id never reaches it', async (who) => {
    const r = await call(who, { ...resubmitBody, reason: 'copy fixed', approverUserId: 'forged-id', requester: 'forged-id', userId: 'forged-id' });
    expect(r.statusCode).toBe(200);
    expect(mockSvc.resubmit).toHaveBeenCalledTimes(1);
    expect((mockSvc.resubmit.mock.calls[0] as unknown[])[0]).toMatchObject({ organizationId: A, taskId: 't-1', approverUserId: `u-${who}`, reason: 'copy fixed' });
    expect(JSON.stringify(mockSvc.resubmit.mock.calls[0])).not.toContain('forged-id');
  });

  it.each(['super', 'superWithTenantRole', 'bridge', 'creator', 'publisher', 'architect', 'viewer', 'adminElsewhere'])(
    'unauthorised requester %s is refused; the service is never reached, so nothing is recorded', async (who) => {
      const r = await call(who, resubmitBody);
      expect(r.statusCode).toBe(403);
      expect(effects()).toBe(0);
    });

  it('cross-tenant: an approver of tenant B cannot resubmit in tenant A, and vice versa', async () => {
    expect((await call('adminElsewhere', resubmitBody)).statusCode).toBe(403);
    expect((await call('admin', { ...resubmitBody, companyId: B })).statusCode).toBe(403);
    expect(effects()).toBe(0);
  });

  it('no session: refused 401, nothing reached', async () => {
    expect((await call(null, resubmitBody)).statusCode).toBe(401);
    expect(effects()).toBe(0);
  });
});
