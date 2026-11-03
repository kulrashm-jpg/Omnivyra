/**
 * D-01 — community AI platform policy defaults are fail-closed.
 *
 *   - No policy row (or an unreadable one): auto_rules_enabled=false,
 *     require_human_approval=true (communityAiPlatformPolicyService).
 *   - The super-admin policy route, writing the first row with a field
 *     omitted, falls back to the same defaults.
 *
 * In-memory fake DB (helpers/communityExecutionFakeDb); no network.
 */

import { createFakeDb, type FakeDb } from './helpers/communityExecutionFakeDb';

let mockDb: FakeDb = createFakeDb();
let mockFailRead = false;
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (t: string) => {
      if (mockFailRead && t === 'community_ai_platform_policy') {
        throw new Error('relation does not exist');
      }
      return mockDb.from(t);
    },
  },
}));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../security/requireCapability', () => ({
  requireCapability: jest.fn(async () => ({ ok: true, principal: { userId: 'admin-1', email: 'a@example.test' } })),
}));
jest.mock('../../services/requestAccessService', () => ({ requireAdminRateLimit: jest.fn(async () => true) }));
jest.mock('../../services/supabaseAuthService', () => ({ getSupabaseUserFromRequest: jest.fn(async () => ({ user: null })) }));
jest.mock('../../services/rbacService', () => ({ isPlatformSuperAdmin: jest.fn(async () => false) }));
jest.mock('../../services/superAdminSession', () => ({ getLegacySuperAdminSession: jest.fn(() => null) }));
jest.mock('../../../lib/security/clientIp', () => ({ getTrustedClientIpOrNull: jest.fn(() => null) }));

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
  return res;
};

beforeEach(() => {
  mockDb = createFakeDb({ community_ai_platform_policy: [] });
  mockFailRead = false;
});

describe('D-01 policy service defaults', () => {
  it('no policy row: auto-rules off, human approval required', async () => {
    const policy = await loadPolicyService().getCommunityAiPlatformPolicy();
    expect(policy.auto_rules_enabled).toBe(false);
    expect(policy.require_human_approval).toBe(true);
    expect(policy.execution_enabled).toBe(true);
  });

  it('unreadable policy table: same fail-closed defaults', async () => {
    mockFailRead = true;
    const policy = await loadPolicyService().getCommunityAiPlatformPolicy();
    expect(policy.auto_rules_enabled).toBe(false);
    expect(policy.require_human_approval).toBe(true);
  });

  it('a stored row is honoured as-is (existing configuration is not rewritten)', async () => {
    mockDb = createFakeDb({
      community_ai_platform_policy: [{
        id: 'p1', execution_enabled: true, auto_rules_enabled: true, require_human_approval: false,
        updated_at: '2026-10-01T00:00:00Z', updated_by: null,
      }],
    });
    const policy = await loadPolicyService().getCommunityAiPlatformPolicy();
    expect(policy.auto_rules_enabled).toBe(true);
    expect(policy.require_human_approval).toBe(false);
    expect(mockDb.ops.filter((o) => o.table === 'community_ai_platform_policy')).toEqual([]);
  });
});

describe('D-01 super-admin policy route fallback', () => {
  it('first write with the other fields omitted stores auto-rules off and approval required', async () => {
    const handler = require('../../../pages/api/super-admin/community-ai-policy').default;
    const res = mockRes();
    await handler({ method: 'POST', body: { execution_enabled: true }, headers: {} } as any, res);
    expect(res.statusCode).toBe(200);
    const rows = mockDb.tables.community_ai_platform_policy;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      execution_enabled: true,
      auto_rules_enabled: false,
      require_human_approval: true,
    });
  });

  it('an omitted field keeps the stored value of an existing row', async () => {
    mockDb = createFakeDb({
      community_ai_platform_policy: [{
        id: 'p1', execution_enabled: true, auto_rules_enabled: true, require_human_approval: false,
        updated_at: '2026-10-01T00:00:00Z', updated_by: null,
      }],
    });
    const handler = require('../../../pages/api/super-admin/community-ai-policy').default;
    const res = mockRes();
    await handler({ method: 'POST', body: { execution_enabled: false }, headers: {} } as any, res);
    expect(res.statusCode).toBe(200);
    expect(mockDb.tables.community_ai_platform_policy[0]).toMatchObject({
      execution_enabled: false,
      auto_rules_enabled: true,
      require_human_approval: false,
    });
  });
});
