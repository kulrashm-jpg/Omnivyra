/**
 * /api/admin/invite-user — authorization boundary (STEP 3AH-46 K2).
 *
 * The SUPER_ADMIN branch performs a cross-organization invitation. It must hold
 * the same boundary as the canonical super-admin identity-assignment routes:
 *   - requireCapability(IDENTITY_ADMIN_ASSIGN) — platform-tier, step-up
 *     mandatory — before any read or write of the target company or invitee;
 *   - the work-email rule (no unaudited personal-email override);
 *   - a strict audit row for the outcome, never carrying the invite link/token.
 * The COMPANY_ADMIN branch keeps its semantics: own company only.
 */
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../middleware/withIdempotency', () => ({ withIdempotency: (h: unknown) => h }));
jest.mock('../../services/requestAccessService', () => ({ requireAdminRateLimit: jest.fn(async () => true) }));
jest.mock('../../services/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() } }));
jest.mock('../../services/domainVerificationService', () => ({
  logDomainUnverifiedUsageForCompany: jest.fn(async () => undefined),
}));

const mockGetUser = jest.fn();
jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: (...a: unknown[]) => mockGetUser(...a),
}));
const mockFrom = jest.fn();
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (...a: unknown[]) => mockFrom(...a) } }));
const mockCreateAndSend = jest.fn();
jest.mock('../../services/invitationService', () => ({
  createAndSendInvitation: (...a: unknown[]) => mockCreateAndSend(...a),
}));
const mockNonWork = jest.fn();
jest.mock('../../services/domainEligibilityService', () => ({
  isNonWorkEmailDomain: (...a: unknown[]) => mockNonWork(...a),
}));
const mockResolvePrincipal = jest.fn();
jest.mock('../../security/IdentityResolver', () => ({
  resolvePrincipal: (...a: unknown[]) => mockResolvePrincipal(...a),
}));
const mockRequireCapability = jest.fn();
jest.mock('../../security/requireCapability', () => ({
  requireCapability: (...a: unknown[]) => mockRequireCapability(...a),
}));
const mockAudit = jest.fn(async (..._a: unknown[]) => ({ ok: true }));
jest.mock('../../services/auditActorService', () => ({
  insertAuditLogStrict: (...a: unknown[]) => mockAudit(...a),
}));

import handler from '../../../pages/api/admin/invite-user';
import { IDENTITY_ADMIN_ASSIGN, STEP_UP_REQUIRED_CAPABILITIES } from '../../../shared/contracts/security';
import { CROSS_ORGANIZATION_IDENTITY_CAPABILITIES } from '../../security/platformCapabilities';
import { getStepUpPolicy } from '../../security/stepup/StepUpPolicyRegistry';

const OWN_COMPANY = 'company-own';
const TARGET_COMPANY = 'company-target';
const INVITE_TOKEN = 'SECRET-INVITE-TOKEN-123';

const superAdminPrincipal = {
  ok: true,
  principal: { userId: 'sa-1', organizations: [{ organizationId: 'platform', role: 'SUPER_ADMIN', status: 'active' }] },
};
const companyAdminPrincipal = {
  ok: true,
  principal: { userId: 'ca-1', organizations: [{ organizationId: OWN_COMPANY, role: 'COMPANY_ADMIN', status: 'active' }] },
};

function chain(result: unknown) {
  const q: any = {};
  for (const m of ['select', 'eq', 'is', 'gt', 'limit', 'order']) q[m] = () => q;
  q.maybeSingle = async () => result;
  return q;
}

function tables(companyAdminRow: { company_id: string } | null) {
  mockFrom.mockImplementation((t: string) =>
    t === 'user_company_roles'
      ? chain({ data: companyAdminRow, error: null })
      : chain({ data: null, error: null }), // invitations: no active duplicate
  );
}

function call(body: Record<string, unknown>) {
  const req: any = { method: 'POST', headers: { 'idempotency-key': 'k-1' }, body, query: {} };
  const res: any = {
    statusCode: 0,
    payload: undefined as any,
    headers: {} as Record<string, string>,
    setHeader(k: string, v: string) { this.headers[k] = v; },
    status(c: number) { this.statusCode = c; return this; },
    json(p: unknown) { this.payload = p; return this; },
  };
  return (handler as any)(req, res).then(() => res);
}

const denyStepUp = (_req: unknown, res: any) => {
  res.status(401).json({ error: 'Step-up required', code: 'STEP_UP_REQUIRED', capability: IDENTITY_ADMIN_ASSIGN });
  return { ok: false, sent: true };
};
const allow = () => ({ ok: true, principal: { userId: 'sa-1' } });

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue({ user: { id: 'sa-1' }, error: null });
  mockNonWork.mockResolvedValue(false);
  mockCreateAndSend.mockResolvedValue({
    id: 'inv-1',
    inviteLink: `https://www.omnivyra.com/auth/accept-invite?token=${INVITE_TOKEN}`,
    expiresAt: '2026-10-01T00:00:00.000Z',
    replayed: false,
  });
});

describe('unauthenticated and ordinary users', () => {
  it('rejects an unauthenticated request before any authorization or data access', async () => {
    mockGetUser.mockResolvedValue({ user: null, error: 'NO_TOKEN' });
    const res = await call({ email: 'new.user@acme.com', role: 'CONTENT_CREATOR' });
    expect(res.statusCode).toBe(401);
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockRequireCapability).not.toHaveBeenCalled();
    expect(mockCreateAndSend).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('rejects an authenticated user who is neither SUPER_ADMIN nor COMPANY_ADMIN', async () => {
    mockGetUser.mockResolvedValue({ user: { id: 'u-1' }, error: null });
    mockResolvePrincipal.mockResolvedValue({ ok: true, principal: { userId: 'u-1', organizations: [] } });
    tables(null);
    const res = await call({ email: 'new.user@acme.com', role: 'CONTENT_CREATOR', companyId: TARGET_COMPANY });
    expect(res.statusCode).toBe(403);
    expect(mockRequireCapability).not.toHaveBeenCalled();
    expect(mockCreateAndSend).not.toHaveBeenCalled();
  });

  it('never allows SUPER_ADMIN as an invitable role', async () => {
    mockResolvePrincipal.mockResolvedValue(superAdminPrincipal);
    const res = await call({ email: 'new.user@acme.com', role: 'SUPER_ADMIN', companyId: TARGET_COMPANY });
    expect(res.statusCode).toBe(400);
    expect(mockCreateAndSend).not.toHaveBeenCalled();
  });
});

describe('COMPANY_ADMIN branch (semantics preserved)', () => {
  beforeEach(() => {
    mockGetUser.mockResolvedValue({ user: { id: 'ca-1' }, error: null });
    mockResolvePrincipal.mockResolvedValue(companyAdminPrincipal);
    tables({ company_id: OWN_COMPANY });
  });

  it('invites into the caller\'s own company only, ignoring a body companyId, without the platform capability', async () => {
    const res = await call({ email: 'new.user@acme.com', role: 'CONTENT_CREATOR', companyId: TARGET_COMPANY });
    expect(res.statusCode).toBe(201);
    expect(mockRequireCapability).not.toHaveBeenCalled();
    expect(mockCreateAndSend).toHaveBeenCalledWith(expect.objectContaining({ companyId: OWN_COMPANY }));
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'COMPANY_ADMIN_INVITE_CREATE',
      actorUserId: 'ca-1',
      companyId: OWN_COMPANY,
    }));
  });

  it('still blocks a personal email address', async () => {
    mockNonWork.mockResolvedValue(true);
    const res = await call({ email: 'someone@gmail.com', role: 'CONTENT_CREATOR' });
    expect(res.statusCode).toBe(400);
    expect(mockCreateAndSend).not.toHaveBeenCalled();
  });
});

describe('SUPER_ADMIN branch — canonical cross-organization boundary', () => {
  beforeEach(() => {
    mockResolvePrincipal.mockResolvedValue(superAdminPrincipal);
    tables(null);
  });

  it('requires a target companyId (input validation, before authorization)', async () => {
    const res = await call({ email: 'new.user@acme.com', role: 'COMPANY_ADMIN' });
    expect(res.statusCode).toBe(400);
    expect(mockRequireCapability).not.toHaveBeenCalled();
  });

  it('without a valid step-up: refused, and nothing is read, checked, written, or sent', async () => {
    mockRequireCapability.mockImplementation(denyStepUp);
    const res = await call({ email: 'new.user@acme.com', role: 'COMPANY_ADMIN', companyId: TARGET_COMPANY });
    expect(res.statusCode).toBe(401);
    expect(res.payload.code).toBe('STEP_UP_REQUIRED');
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockNonWork).not.toHaveBeenCalled();
    expect(mockCreateAndSend).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('gates on IDENTITY_ADMIN_ASSIGN for the TARGET company and never suppresses step-up', async () => {
    mockRequireCapability.mockImplementation(denyStepUp);
    await call({ email: 'new.user@acme.com', role: 'COMPANY_ADMIN', companyId: TARGET_COMPANY });
    expect(mockRequireCapability).toHaveBeenCalledTimes(1);
    const opts = mockRequireCapability.mock.calls[0][2];
    expect(opts.capability).toBe(IDENTITY_ADMIN_ASSIGN);
    expect(opts.organizationId).toBe(TARGET_COMPANY);
    expect(opts.resourceId).toBe('new.user@acme.com');
    expect(opts.requireStepUp).toBeUndefined();
    expect(opts.stepUpOverride).toBeUndefined();
  });

  it('with a valid step-up: invites into the target company and writes a strict audit row', async () => {
    mockRequireCapability.mockImplementation(allow);
    const res = await call({ email: 'New.User@Acme.com', role: 'COMPANY_ADMIN', companyId: TARGET_COMPANY });
    expect(res.statusCode).toBe(201);
    expect(mockCreateAndSend).toHaveBeenCalledWith(expect.objectContaining({
      email: 'new.user@acme.com',
      companyId: TARGET_COMPANY,
      role: 'COMPANY_ADMIN',
    }));
    expect(mockAudit).toHaveBeenCalledTimes(1);
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'SUPER_ADMIN_INVITE_CREATE',
      actorUserId: 'sa-1',
      companyId: TARGET_COMPANY,
      metadata: expect.objectContaining({
        capability: IDENTITY_ADMIN_ASSIGN,
        authority: 'super_admin',
        target_email: 'new.user@acme.com',
        role: 'COMPANY_ADMIN',
        outcome: 'created',
        invitation_id: 'inv-1',
      }),
    }));
  });

  it('the work-email rule applies to SUPER_ADMIN too, checked only after authorization', async () => {
    mockRequireCapability.mockImplementation(allow);
    mockNonWork.mockResolvedValue(true);
    const res = await call({ email: 'someone@gmail.com', role: 'COMPANY_ADMIN', companyId: TARGET_COMPANY });
    expect(res.statusCode).toBe(400);
    expect(mockCreateAndSend).not.toHaveBeenCalled();
    expect(mockRequireCapability.mock.invocationCallOrder[0]).toBeLessThan(mockNonWork.mock.invocationCallOrder[0]);
  });

  it('audits a failed invitation without leaking the invite token', async () => {
    mockRequireCapability.mockImplementation(allow);
    mockCreateAndSend.mockRejectedValue(new Error(`EMAIL_JOB_ENQUEUE_FAILED: https://x/accept?token=${INVITE_TOKEN}`));
    const res = await call({ email: 'new.user@acme.com', role: 'COMPANY_ADMIN', companyId: TARGET_COMPANY });
    expect(res.statusCode).toBe(500);
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'SUPER_ADMIN_INVITE_CREATE',
      metadata: expect.objectContaining({ outcome: 'failed' }),
    }));
    expect(JSON.stringify(mockAudit.mock.calls)).not.toContain(INVITE_TOKEN);
  });

  it('never records the invite link or token in the success audit row', async () => {
    mockRequireCapability.mockImplementation(allow);
    await call({ email: 'new.user@acme.com', role: 'COMPANY_ADMIN', companyId: TARGET_COMPANY });
    const recorded = JSON.stringify(mockAudit.mock.calls);
    expect(recorded).not.toContain(INVITE_TOKEN);
    expect(recorded).not.toContain('accept-invite');
  });
});

describe('the capability this route now gates on is step-up mandatory (real policy)', () => {
  it('IDENTITY_ADMIN_ASSIGN is cross-organization, step-up required, passkey on a trusted device, 10-min freshness', () => {
    expect(CROSS_ORGANIZATION_IDENTITY_CAPABILITIES).toContain(IDENTITY_ADMIN_ASSIGN);
    expect(STEP_UP_REQUIRED_CAPABILITIES).toContain(IDENTITY_ADMIN_ASSIGN);
    const policy = getStepUpPolicy(IDENTITY_ADMIN_ASSIGN);
    expect(policy).toEqual(expect.objectContaining({
      phishingResistantOnly: true,
      trustedDeviceRequired: true,
      maxAgeSeconds: 600,
    }));
  });
});
