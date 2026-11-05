/**
 * D-01, tightened by Prompt 3 (OD-1): community policy defaults are fail-closed.
 *
 *   - Service: the decision belongs to this tenant only. No row, an unreadable row,
 *     a malformed decision, a tenant/org mismatch: all refuse; nothing is cached from
 *     another tenant. The zero-argument global reader is gone.
 *   - Super-admin route: a row written with a field omitted is CLOSED (execution off,
 *     auto rules off, approval required) — the old `?? true` is gone — and an omitted
 *     field keeps the stored value of an existing row.
 *
 * In-memory fake DB (helpers/communityExecutionFakeDb) + an RPC stub; no network.
 */

import { createFakeDb, type FakeDb } from './helpers/communityExecutionFakeDb';

let mockDb: FakeDb = createFakeDb();
let mockRpc: (fn: string, args: any) => Promise<{ data: unknown; error: unknown }> = async () => ({ data: [], error: null });
const mockRpcCalls: Array<{ fn: string; args: any }> = [];
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (t: string) => mockDb.from(t),
    rpc: (fn: string, args: any) => { mockRpcCalls.push({ fn, args }); return mockRpc(fn, args); },
  },
}));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../security/requireCapability', () => ({
  requireCapability: jest.fn(async () => ({ ok: true, principal: { userId: '00000000-0000-4000-8000-0000000000a1', email: 'a@example.test' } })),
}));
jest.mock('../../security/audit/SecurityAuditService', () => ({ logSecurityEvent: jest.fn(async () => undefined) }));
jest.mock('../../services/requestAccessService', () => ({ requireAdminRateLimit: jest.fn(async () => true) }));
jest.mock('../../services/supabaseAuthService', () => ({ getSupabaseUserFromRequest: jest.fn(async () => ({ user: null })) }));
jest.mock('../../services/rbacService', () => ({ isPlatformSuperAdmin: jest.fn(async () => false) }));
jest.mock('../../services/superAdminSession', () => ({ getLegacySuperAdminSession: jest.fn(() => null) }));
jest.mock('../../../lib/security/clientIp', () => ({ getTrustedClientIpOrNull: jest.fn(() => null) }));

const ORG_A = '00000000-0000-4000-8000-0000000000b1';
const ORG_B = '00000000-0000-4000-8000-0000000000b2';

const loadPolicyService = () => {
  let mod: typeof import('../../services/communityAiPlatformPolicyService') | undefined;
  jest.isolateModules(() => {
    mod = require('../../services/communityAiPlatformPolicyService');
  });
  return mod!;
};

const mockRes = () => {
  const res: any = { statusCode: 200, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: any) => { res.body = b; return res; };
  res.setHeader = () => res;
  return res;
};

const allow = (auto = false) => ({ data: [{ allowed: true, code: null, auto_rules_enabled: auto, policy_version: null }], error: null });
const refuse = (code: string) => ({ data: [{ allowed: false, code, auto_rules_enabled: null, policy_version: null }], error: null });

beforeEach(() => {
  mockDb = createFakeDb({ community_ai_platform_policy: [] });
  mockRpc = async () => refuse('POLICY_MISSING');
  mockRpcCalls.length = 0;
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('Prompt 3 policy service — tenant-scoped, fail closed', () => {
  it('the zero-argument global reader no longer exists', () => {
    expect((loadPolicyService() as any).getCommunityAiPlatformPolicy).toBeUndefined();
  });

  it('no tenant row: refused (POLICY_MISSING), never a permissive default', async () => {
    expect(await loadPolicyService().getCommunityExecutionPolicy({ organizationId: ORG_A, tenantId: ORG_A }))
      .toEqual({ ok: false, code: 'POLICY_MISSING' });
  });

  it.each([
    ['PLATFORM_KILL_SWITCH'], ['POLICY_AMBIGUOUS'], ['POLICY_TENANT_MISMATCH'], ['POLICY_MALFORMED'], ['POLICY_EXECUTION_DISABLED'],
  ])('every database refusal code is passed through: %s', async (code) => {
    mockRpc = async () => refuse(code);
    expect(await loadPolicyService().getCommunityExecutionPolicy({ organizationId: ORG_A, tenantId: ORG_A })).toEqual({ ok: false, code });
  });

  it.each([
    ['missing org', { organizationId: '', tenantId: ORG_A }],
    ['missing tenant', { organizationId: ORG_A, tenantId: '' }],
    ['tenant ≠ org', { organizationId: ORG_A, tenantId: ORG_B }],
    ['undefined scope', undefined],
  ])('scope invalid (%s): refused locally, nothing read', async (_l, scope) => {
    mockRpc = async () => allow(true);
    expect(await loadPolicyService().getCommunityExecutionPolicy(scope as any)).toEqual({ ok: false, code: 'POLICY_SCOPE_INVALID' });
    expect(mockRpcCalls).toHaveLength(0);
  });

  it.each([
    ['allowed with a code', { allowed: true, code: 'X', auto_rules_enabled: true }],
    ['allowed with a null auto flag', { allowed: true, code: null, auto_rules_enabled: null }],
    ['allowed as a string', { allowed: 'true', code: null, auto_rules_enabled: true }],
    ['an unknown refusal code', { allowed: false, code: 'SOMETHING_ELSE' }],
    ['a refusal with no code', { allowed: false, code: null }],
  ])('a malformed decision (%s) is unreadable and refused', async (_l, row) => {
    mockRpc = async () => ({ data: [row], error: null });
    expect(await loadPolicyService().getCommunityExecutionPolicy({ organizationId: ORG_A, tenantId: ORG_A }))
      .toEqual({ ok: false, code: 'POLICY_UNREADABLE' });
  });

  it.each([[[]], [[{ allowed: true, code: null, auto_rules_enabled: true }, { allowed: true, code: null, auto_rules_enabled: true }]]])(
    'a decision that is not exactly one row is unreadable (%#)',
    async (rows) => {
      mockRpc = async () => ({ data: rows, error: null });
      expect((await loadPolicyService().getCommunityExecutionPolicy({ organizationId: ORG_A, tenantId: ORG_A })).ok).toBe(false);
    },
  );

  it('auto rules are allowed only by an explicit true', async () => {
    mockRpc = async () => allow(false);
    expect(await loadPolicyService().getCommunityExecutionPolicy({ organizationId: ORG_A, tenantId: ORG_A }))
      .toEqual({ ok: true, policy: { execution_enabled: true, auto_rules_enabled: false }, version: null });
  });

  it('cache is per tenant: an allow for one tenant never answers for another', async () => {
    const svc = loadPolicyService();
    mockRpc = async (_fn, args) => (args.p_org === ORG_A ? allow(true) : refuse('POLICY_MISSING'));
    expect((await svc.getCommunityExecutionPolicy({ organizationId: ORG_A, tenantId: ORG_A })).ok).toBe(true);
    expect(await svc.getCommunityExecutionPolicy({ organizationId: ORG_B, tenantId: ORG_B })).toEqual({ ok: false, code: 'POLICY_MISSING' });
    // Cached (definite) for both: no further reads.
    await svc.getCommunityExecutionPolicy({ organizationId: ORG_A, tenantId: ORG_A });
    await svc.getCommunityExecutionPolicy({ organizationId: ORG_B, tenantId: ORG_B });
    expect(mockRpcCalls).toHaveLength(2);
  });

  it('definite results expire after 60 s and are re-read; invalidation drops them at once', async () => {
    const svc = loadPolicyService();
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(1_000_000);
    mockRpc = async () => allow(false);
    await svc.getCommunityExecutionPolicy({ organizationId: ORG_A, tenantId: ORG_A });
    now.mockReturnValue(1_000_000 + 59_999);
    await svc.getCommunityExecutionPolicy({ organizationId: ORG_A, tenantId: ORG_A });
    expect(mockRpcCalls).toHaveLength(1);
    now.mockReturnValue(1_000_000 + 60_000);
    mockRpc = async () => refuse('POLICY_EXECUTION_DISABLED');
    expect((await svc.getCommunityExecutionPolicy({ organizationId: ORG_A, tenantId: ORG_A })).ok).toBe(false);
    expect(mockRpcCalls).toHaveLength(2);
    svc.invalidateCommunityExecutionPolicyCache(ORG_A);
    await svc.getCommunityExecutionPolicy({ organizationId: ORG_A, tenantId: ORG_A });
    expect(mockRpcCalls).toHaveLength(3);
    now.mockRestore();
  });

  it('readCommunityPolicyRow: the platform row is the organization_id IS NULL row; tenant rows by org; ambiguity refused', async () => {
    mockDb = createFakeDb({
      community_ai_platform_policy: [
        { id: 'p', organization_id: null, tenant_id: null, execution_enabled: true },
        { id: 'a', organization_id: ORG_A, tenant_id: ORG_A, execution_enabled: false },
      ],
    });
    const svc = loadPolicyService();
    expect(await svc.readCommunityPolicyRow(null)).toMatchObject({ ok: true, row: { id: 'p' } });
    expect(await svc.readCommunityPolicyRow(ORG_A)).toMatchObject({ ok: true, row: { id: 'a' } });
    expect(await svc.readCommunityPolicyRow(ORG_B)).toEqual({ ok: true, row: null });
    mockDb.tables.community_ai_platform_policy.push({ id: 'p2', organization_id: null, tenant_id: null });
    expect(await svc.readCommunityPolicyRow(null)).toEqual({ ok: false, code: 'POLICY_AMBIGUOUS' });
  });
});

describe('Prompt 3 super-admin policy route — closed fallback (OD-1)', () => {
  it('a first tenant row written with fields omitted is CLOSED (no `?? true`)', async () => {
    const handler = require('../../../pages/api/super-admin/community-ai-policy').default;
    const res = mockRes();
    // Disabling auto rules on a tenant with no row: a tightening, single operator.
    await handler({ method: 'POST', body: { organization_id: ORG_A, auto_rules_enabled: false }, headers: {} } as any, res);
    expect(res.statusCode).toBe(200);
    const rows = mockDb.tables.community_ai_platform_policy;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organization_id: ORG_A,
      tenant_id: ORG_A,
      execution_enabled: false,
      auto_rules_enabled: false,
      require_human_approval: true,
    });
  });

  it('an omitted field keeps the stored value of an existing row; approval is always re-asserted required', async () => {
    mockDb = createFakeDb({
      community_ai_platform_policy: [{
        id: 'p1', organization_id: ORG_A, tenant_id: ORG_A, execution_enabled: true, auto_rules_enabled: true, require_human_approval: false,
        updated_at: '2026-10-01T00:00:00Z', updated_by: null,
      }],
    });
    const handler = require('../../../pages/api/super-admin/community-ai-policy').default;
    const res = mockRes();
    await handler({ method: 'POST', body: { organization_id: ORG_A, execution_enabled: false }, headers: {} } as any, res);
    expect(res.statusCode).toBe(200);
    expect(mockDb.tables.community_ai_platform_policy[0]).toMatchObject({
      execution_enabled: false,
      auto_rules_enabled: true,
      require_human_approval: true,
    });
  });

  it('require_human_approval can never be turned off (400 HUMAN_APPROVAL_NOT_WAIVABLE)', async () => {
    const handler = require('../../../pages/api/super-admin/community-ai-policy').default;
    const res = mockRes();
    await handler({ method: 'POST', body: { organization_id: ORG_A, require_human_approval: false }, headers: {} } as any, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('HUMAN_APPROVAL_NOT_WAIVABLE');
    expect(mockDb.tables.community_ai_platform_policy).toHaveLength(0);
  });
});
