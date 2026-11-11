/**
 * Prompt 3 — OD-2 / LD-5 two-person control on the super-admin community policy route.
 *
 *   - Loosening (enable execution / auto rules, approval off, or a new row that enables
 *     anything) records a pending request; nothing is loosened until a DIFFERENT
 *     authorised operator confirms it, and exactly the requested change is applied.
 *   - Self-confirm, a stale request, a wrong request id, or a change sent with confirm
 *     are refused. Tightening applies at once, single operator.
 *   - Both steps pass requireCapability (step-up) and write logSecurityEvent.
 */

import { createFakeDb, type FakeDb } from './helpers/communityExecutionFakeDb';

let mockDb: FakeDb = createFakeDb();
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => mockDb.from(t), rpc: jest.fn() } }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
let mockOperator = '00000000-0000-4000-8000-0000000000a1';
const mockCapabilityCalls: any[] = [];
jest.mock('../../security/requireCapability', () => ({
  requireCapability: async (_req: unknown, _res: unknown, opts: unknown) => {
    mockCapabilityCalls.push(opts);
    return { ok: true, principal: { userId: mockOperator, email: `${mockOperator}@example.test` } };
  },
}));
const mockSecurity: any[] = [];
jest.mock('../../security/audit/SecurityAuditService', () => ({ logSecurityEvent: async (e: unknown) => { mockSecurity.push(e); } }));
jest.mock('../../services/requestAccessService', () => ({ requireAdminRateLimit: async () => true }));
jest.mock('../../services/supabaseAuthService', () => ({ getSupabaseUserFromRequest: async () => ({ user: null }) }));
jest.mock('../../services/rbacService', () => ({ isPlatformSuperAdmin: async () => false }));
jest.mock('../../services/superAdminSession', () => ({ getLegacySuperAdminSession: () => ({ userId: 'super_admin_session' }) }));
jest.mock('../../../lib/security/clientIp', () => ({ getTrustedClientIpOrNull: () => null }));

const handler = require('../../../pages/api/super-admin/community-ai-policy').default;

const OP_A = '00000000-0000-4000-8000-0000000000a1';
const OP_B = '00000000-0000-4000-8000-0000000000a2';
const ORG = '00000000-0000-4000-8000-0000000000b1';

const mockRes = () => {
  const res: any = { statusCode: 200, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: any) => { res.body = b; return res; };
  res.setHeader = () => res;
  return res;
};
const post = async (operator: string, body: Record<string, unknown>) => {
  mockOperator = operator;
  const res = mockRes();
  await handler({ method: 'POST', body, headers: {}, query: {} }, res);
  return res;
};
const rowOf = () => mockDb.tables.community_ai_platform_policy.find((r) => r.organization_id === ORG);
const closedRow = (over: Record<string, unknown> = {}) => ({
  id: 'p1', organization_id: ORG, tenant_id: ORG,
  execution_enabled: false, auto_rules_enabled: false, require_human_approval: true,
  updated_at: '2026-11-01T00:00:00.000Z', updated_by: null,
  requested_execution_enabled: null, requested_auto_rules_enabled: null, requested_by: null, requested_at: null,
  requested_base_execution_enabled: null, requested_base_auto_rules_enabled: null,
  ...over,
});

beforeEach(() => {
  mockDb = createFakeDb({ community_ai_platform_policy: [closedRow()] });
  mockSecurity.length = 0;
  mockCapabilityCalls.length = 0;
});

describe('OD-2 two-person control for loosening', () => {
  it('enable execution: the request is recorded, nothing is loosened', async () => {
    const res = await post(OP_A, { organization_id: ORG, execution_enabled: true });
    expect(res.statusCode).toBe(202);
    expect(res.body).toMatchObject({ status: 'pending_second_operator' });
    expect(rowOf()).toMatchObject({
      execution_enabled: false,
      requested_by: OP_A,
      requested_execution_enabled: true, requested_auto_rules_enabled: false,
    });
    expect(mockSecurity.map((e) => e.reason)).toContain('community_ai_policy:override_requested');
  });

  it('a different operator confirms: exactly the requested change applies and the request clears', async () => {
    const req = await post(OP_A, { organization_id: ORG, execution_enabled: true });
    const res = await post(OP_B, { organization_id: ORG, action: 'confirm', request_id: req.body.request_id });
    expect(res.statusCode).toBe(200);
    expect(rowOf()).toMatchObject({ execution_enabled: true, auto_rules_enabled: false, require_human_approval: true, updated_by: OP_B });
    // The confirming statement never writes the request columns (the DB trigger refuses a
    // request and its confirmation in one statement, and clears the request itself).
    const confirmPatch = mockDb.ops.filter((o) => o.op === 'update').pop()!.patch!;
    expect(Object.keys(confirmPatch).filter((k) => k.startsWith('requested_'))).toEqual([]);
    const reasons = mockSecurity.map((e) => e.reason);
    expect(reasons).toEqual(expect.arrayContaining(['community_ai_policy:override_requested', 'community_ai_policy:override_confirmed']));
    expect(mockSecurity.every((e) => e.capability === 'intelligence.override.manage')).toBe(true);
    expect(mockCapabilityCalls).toHaveLength(2);
  });

  it('the initiator cannot confirm their own request', async () => {
    const req = await post(OP_A, { organization_id: ORG, auto_rules_enabled: true });
    const res = await post(OP_A, { organization_id: ORG, action: 'confirm', request_id: req.body.request_id });
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('OVERRIDE_SELF_CONFIRM_FORBIDDEN');
    expect(rowOf()).toMatchObject({ auto_rules_enabled: false });
    expect(mockSecurity.map((e) => e.reason)).toContain('community_ai_policy:override_self_confirm');
  });

  it('a wrong request id, or no pending request, is refused', async () => {
    await post(OP_A, { organization_id: ORG, execution_enabled: true });
    expect((await post(OP_B, { organization_id: ORG, action: 'confirm', request_id: 'nope' })).statusCode).toBe(409);
    mockDb = createFakeDb({ community_ai_platform_policy: [closedRow()] });
    expect((await post(OP_B, { organization_id: ORG, action: 'confirm', request_id: 'nope' })).statusCode).toBe(409);
    expect(rowOf()).toMatchObject({ execution_enabled: false });
  });

  it('a request older than the TTL cannot be confirmed', async () => {
    await post(OP_A, { organization_id: ORG, execution_enabled: true });
    // Exactly at the 1-hour TTL (the DB trigger's `requested_at <= now - 1 hour`): expired.
    const stale = new Date(Date.now() - 60 * 60_000).toISOString();
    rowOf()!.requested_at = stale;
    const res = await post(OP_B, { organization_id: ORG, action: 'confirm', request_id: stale });
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe('OVERRIDE_REQUEST_EXPIRED');
    expect(rowOf()).toMatchObject({ execution_enabled: false });
  });

  it('confirm carries no change of its own (the confirmed change is the requested one)', async () => {
    const req = await post(OP_A, { organization_id: ORG, execution_enabled: true });
    const res = await post(OP_B, { organization_id: ORG, action: 'confirm', request_id: req.body.request_id, auto_rules_enabled: true });
    expect(res.statusCode).toBe(400);
    expect(rowOf()).toMatchObject({ execution_enabled: false, auto_rules_enabled: false });
  });

  it('require_human_approval cannot be turned off at all (not even by two operators)', async () => {
    mockDb = createFakeDb({ community_ai_platform_policy: [closedRow({ execution_enabled: true })] });
    expect((await post(OP_A, { organization_id: ORG, require_human_approval: false })).statusCode).toBe(400);
    expect(rowOf()).toMatchObject({ require_human_approval: true, requested_by: null });
  });

  it('a NEW tenant row that enables execution is created CLOSED with a pending request', async () => {
    mockDb = createFakeDb({ community_ai_platform_policy: [] });
    const res = await post(OP_A, { organization_id: ORG, execution_enabled: true });
    expect(res.statusCode).toBe(202);
    expect(rowOf()).toMatchObject({ execution_enabled: false, auto_rules_enabled: false, require_human_approval: true, requested_by: OP_A });
  });

  it('the legacy cookie session (unattributable) cannot initiate a loosening', async () => {
    const res = await post('super_admin_session', { organization_id: ORG, execution_enabled: true });
    expect(res.statusCode).toBe(403);
    expect(rowOf()).toMatchObject({ requested_by: null });
  });

  it('the initiator may cancel a pending request (it loosens nothing)', async () => {
    const req = await post(OP_A, { organization_id: ORG, execution_enabled: true });
    const res = await post(OP_A, { organization_id: ORG, action: 'cancel', request_id: req.body.request_id });
    expect(res.statusCode).toBe(200);
    expect(rowOf()).toMatchObject({ requested_by: null, requested_at: null, execution_enabled: false });
  });
});

describe('F2: a stale request never re-opens a kill switch', () => {
  const OP_C = '00000000-0000-4000-8000-0000000000a3';

  it('the request records the flags it was made against', async () => {
    mockDb = createFakeDb({ community_ai_platform_policy: [closedRow({ execution_enabled: true })] });
    await post(OP_A, { organization_id: ORG, auto_rules_enabled: true });
    expect(rowOf()).toMatchObject({
      requested_execution_enabled: true, requested_auto_rules_enabled: true,
      requested_base_execution_enabled: true, requested_base_auto_rules_enabled: false,
    });
  });

  it('tighten (kill switch) then confirm: the tighten clears the request and the confirm is refused', async () => {
    // The reviewer's repro: exec=true, A requests auto=true, C throws the kill switch, B confirms.
    mockDb = createFakeDb({ community_ai_platform_policy: [{ ...closedRow({ execution_enabled: true }), id: 'plat', organization_id: null, tenant_id: null }] });
    const platform = () => mockDb.tables.community_ai_platform_policy[0];
    const req = await post(OP_A, { auto_rules_enabled: true });
    expect(req.statusCode).toBe(202);
    const kill = await post(OP_C, { execution_enabled: false });
    expect(kill.statusCode).toBe(200);
    expect(platform()).toMatchObject({
      execution_enabled: false, requested_by: null, requested_at: null,
      requested_execution_enabled: null, requested_auto_rules_enabled: null,
      requested_base_execution_enabled: null, requested_base_auto_rules_enabled: null,
    });
    expect(mockSecurity.map((e) => e.reason)).toContain('community_ai_policy:override_request_cleared_by_tightening');
    const conf = await post(OP_B, { action: 'confirm', request_id: req.body.request_id });
    expect(conf.statusCode).toBe(409);
    expect(platform()).toMatchObject({ execution_enabled: false, auto_rules_enabled: false });
  });

  it('a confirm against changed base flags is refused (OVERRIDE_REQUEST_STALE), even if the request survived', async () => {
    mockDb = createFakeDb({ community_ai_platform_policy: [closedRow({ execution_enabled: true })] });
    const req = await post(OP_A, { organization_id: ORG, auto_rules_enabled: true });
    // The flags changed under the request by a writer that did not clear it.
    rowOf()!.execution_enabled = false;
    const conf = await post(OP_B, { organization_id: ORG, action: 'confirm', request_id: req.body.request_id });
    expect(conf.statusCode).toBe(409);
    expect(conf.body.error).toBe('OVERRIDE_REQUEST_STALE');
    expect(rowOf()).toMatchObject({ execution_enabled: false, auto_rules_enabled: false });
    expect(mockSecurity.map((e) => e.reason)).toContain('community_ai_policy:override_request_stale');
  });

  it('the confirm CAS pins the current flags to the base (a change between read and write matches nothing)', async () => {
    mockDb = createFakeDb({ community_ai_platform_policy: [closedRow({ execution_enabled: true })] });
    const req = await post(OP_A, { organization_id: ORG, auto_rules_enabled: true });
    // Flip the flag after the route reads the row and before its UPDATE runs.
    const realFrom = mockDb.from;
    let reads = 0;
    mockDb.from = (t: string) => {
      const q = realFrom(t);
      if (t === 'community_ai_platform_policy') {
        const update = q.update.bind(q);
        q.update = (p: any) => { rowOf()!.execution_enabled = false; return update(p); };
        reads += 1;
      }
      return q;
    };
    const conf = await post(OP_B, { organization_id: ORG, action: 'confirm', request_id: req.body.request_id });
    expect(reads).toBeGreaterThan(0);
    expect(conf.statusCode).toBe(409);
    expect(rowOf()).toMatchObject({ execution_enabled: false, auto_rules_enabled: false });
  });

  it('a legacy request with no recorded base is stale', async () => {
    const at = new Date().toISOString();
    mockDb = createFakeDb({ community_ai_platform_policy: [closedRow({
      requested_by: OP_A, requested_at: at, requested_execution_enabled: true, requested_auto_rules_enabled: false,
    })] });
    const conf = await post(OP_B, { organization_id: ORG, action: 'confirm', request_id: at });
    expect(conf.statusCode).toBe(409);
    expect(conf.body.error).toBe('OVERRIDE_REQUEST_STALE');
    expect(rowOf()).toMatchObject({ execution_enabled: false });
  });

  it('a change that loosens one flag and tightens another is refused (tighten first)', async () => {
    mockDb = createFakeDb({ community_ai_platform_policy: [closedRow({ execution_enabled: true })] });
    const res = await post(OP_A, { organization_id: ORG, execution_enabled: false, auto_rules_enabled: true });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('MIXED_POLICY_CHANGE');
    expect(rowOf()).toMatchObject({ execution_enabled: true, requested_by: null });
  });

  it('a request that asks for nothing is a withdrawal: not shown as pending and not confirmable', async () => {
    const at = new Date().toISOString();
    mockDb = createFakeDb({ community_ai_platform_policy: [closedRow({
      requested_by: OP_A, requested_at: at, requested_execution_enabled: null, requested_auto_rules_enabled: null,
      requested_base_execution_enabled: false, requested_base_auto_rules_enabled: false,
    })] });
    const conf = await post(OP_B, { organization_id: ORG, action: 'confirm', request_id: at });
    expect(conf.statusCode).toBe(409);
    expect(conf.body.error).toBe('NO_MATCHING_OVERRIDE_REQUEST');
    const res = mockRes();
    await handler({ method: 'GET', query: { organization_id: ORG }, headers: {} }, res);
    expect(res.body.pending_override).toBeNull();
  });

  it('a no-op write leaves a pending request alone; only a real tightening clears it', async () => {
    mockDb = createFakeDb({ community_ai_platform_policy: [closedRow({ execution_enabled: true })] });
    await post(OP_A, { organization_id: ORG, auto_rules_enabled: true });
    expect((await post(OP_C, { organization_id: ORG, require_human_approval: true })).statusCode).toBe(200);
    expect(rowOf()).toMatchObject({ requested_by: OP_A });
  });
});

describe('LD-5: tightening is single-operator and immediate', () => {
  it('disabling execution applies at once', async () => {
    mockDb = createFakeDb({ community_ai_platform_policy: [closedRow({ execution_enabled: true, auto_rules_enabled: true })] });
    const res = await post(OP_A, { organization_id: ORG, execution_enabled: false });
    expect(res.statusCode).toBe(200);
    expect(rowOf()).toMatchObject({ execution_enabled: false, auto_rules_enabled: true, requested_by: null });
    expect(mockSecurity.map((e) => e.reason)).toContain('community_ai_policy:tightened');
  });

  it('the platform kill switch (no organization_id) can be thrown by one operator', async () => {
    mockDb = createFakeDb({ community_ai_platform_policy: [{ ...closedRow({ execution_enabled: true }), id: 'plat', organization_id: null, tenant_id: null }] });
    const res = await post(OP_A, { execution_enabled: false });
    expect(res.statusCode).toBe(200);
    expect(mockDb.tables.community_ai_platform_policy[0]).toMatchObject({ execution_enabled: false });
  });

  it('re-enabling the platform row is a loosening and needs a second operator', async () => {
    mockDb = createFakeDb({ community_ai_platform_policy: [{ ...closedRow(), id: 'plat', organization_id: null, tenant_id: null }] });
    const res = await post(OP_A, { execution_enabled: true });
    expect(res.statusCode).toBe(202);
    expect(mockDb.tables.community_ai_platform_policy[0]).toMatchObject({ execution_enabled: false });
  });
});

describe('request validation and reads', () => {
  it('rejects unknown fields and malformed organization ids', async () => {
    expect((await post(OP_A, { organization_id: ORG, foo: 1 })).statusCode).toBe(400);
    expect((await post(OP_A, { organization_id: 'not-a-uuid', execution_enabled: false })).statusCode).toBe(400);
  });

  it('GET returns the tenant row and its pending request', async () => {
    await post(OP_A, { organization_id: ORG, execution_enabled: true });
    const res = mockRes();
    await handler({ method: 'GET', query: { organization_id: ORG }, headers: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.policy).toMatchObject({ organization_id: ORG, execution_enabled: false });
    expect(res.body.pending_override).toMatchObject({ requested_by: OP_A });
  });
});
