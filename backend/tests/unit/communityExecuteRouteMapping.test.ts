/**
 * Prompt 3 (OD-1, LD-7) — POST /api/community-ai/actions/execute, the real handler.
 *
 *   - every refusal that can be decided before the claim is decided before it:
 *     kill switch / tenant policy (423), approval missing / expired / without
 *     evidence (403). The claim is never called, the row is never written, and
 *     ONE governance refusal record is written (claim point 'manual');
 *   - 409 only for a genuine claim conflict (lost race, executing, leased);
 *     a browser command waiting for the extension is 202 (503 with no live
 *     extension), never 409;
 *   - a refusal returned BY the claim RPC maps the same way;
 *   - the claim is the single claim (claim point 'manual', the execution mode and
 *     a correlation id), and the executor runs only after it, compare-and-set
 *     from 'executing', under the same correlation id.
 */
import { withApprovalEvidence, approvedAgo } from '../helpers/communityApprovalEvidenceFixture';

const mockRows: Record<string, any> = {};
const mockSessions: Array<Record<string, any>> = [];
const mockWrites: Array<{ table: string; op: string; payload?: unknown }> = [];

// A tiny chainable query double: reads filter mockRows / mockSessions; writes are recorded.
function mockQuery(table: string) {
  const filters: Array<(r: any) => boolean> = [];
  let op: 'select' | 'update' | 'insert' = 'select';
  let payload: unknown;
  const rows = () => (table === 'extension_sessions' ? mockSessions : Object.values(mockRows)).filter((r) => filters.every((f) => f(r)));
  const q: any = {
    select: () => q,
    update: (p: unknown) => { op = 'update'; payload = p; mockWrites.push({ table, op, payload: p }); return q; },
    insert: (p: unknown) => { op = 'insert'; payload = p; mockWrites.push({ table, op, payload: p }); return q; },
    eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q; },
    gte: (c: string, v: string) => { filters.push((r) => String(r[c]) >= v); return q; },
    gt: (c: string, v: string) => { filters.push((r) => String(r[c]) > v); return q; },
    limit: () => q,
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve({ data: op === 'select' ? rows() : null, error: null, payload }).then(res, rej),
  };
  return q;
}

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => mockQuery(t), rpc: jest.fn() } }));
jest.mock('../../db/communityAiActionStore', () => ({
  getCommunityAiActionById: jest.fn(async (id: string) => ({ data: mockRows[id] ? { ...mockRows[id] } : null, error: null })),
}));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../../pages/api/community-ai/utils', () => ({
  requireTenantScope: jest.fn(async () => ({ tenantId: 'org-1', organizationId: 'org-1' })),
  enforceActionRole: jest.fn(async () => ({ userId: 'human-1' })),
}));
const mockClaim = jest.fn();
const mockExecute = jest.fn();
jest.mock('../../services/communityAiActionExecutor', () => ({
  claimCommunityActionForExecution: (...a: any[]) => mockClaim(...a),
  executeAction: (...a: any[]) => mockExecute(...a),
}));
const mockPolicy = jest.fn();
jest.mock('../../services/communityAiPlatformPolicyService', () => ({
  ...jest.requireActual('../../services/communityAiPlatformPolicyService'),
  getCommunityExecutionPolicy: (...a: any[]) => mockPolicy(...a),
}));
const mockRefusal = jest.fn(async () => true);
jest.mock('../../services/communityExecutionRefusal', () => ({
  recordCommunityExecutionRefusal: (...a: any[]) => (mockRefusal as any)(...a),
}));
jest.mock('../../services/communityAiActionLogService', () => ({ logCommunityAiActionEvent: jest.fn(async () => undefined) }));
jest.mock('../../services/communityAiNotificationService', () => ({ notifyCommunityAi: jest.fn(async () => undefined) }));
jest.mock('../../services/communityAiWebhookService', () => ({ sendCommunityAiWebhooks: jest.fn(async () => undefined) }));
jest.mock('../../services/playbooks/playbookService', () => ({ getPlaybookById: jest.fn(async () => ({ id: 'pb1' })) }));
jest.mock('../../services/playbooks/playbookValidator', () => ({ validateActionAgainstPlaybook: jest.fn(() => ({ allowed: true })) }));

import handler from '../../../pages/api/community-ai/actions/execute';

const ID = '00000000-0000-4000-8000-00000000e001';
const base = (over: Record<string, any> = {}) => ({
  id: ID,
  tenant_id: 'org-1',
  organization_id: 'org-1',
  platform: 'linkedin',
  action_type: 'like',
  target_id: 'https://www.linkedin.com/feed/update/urn:li:activity:1/',
  suggested_text: null,
  playbook_id: 'pb1',
  execution_mode: 'api',
  status: 'approved',
  risk_level: 'low',
  requires_human_approval: true,
  dispatch_lease_id: null,
  cancel_requested_at: null,
  ...over,
});
const approved = (over: Record<string, any> = {}, opts?: { approvedAt?: string }) => withApprovalEvidence(base(over), opts);

const call = async (body: Record<string, unknown> = {}) => {
  const res: any = { statusCode: 0, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  await (handler as any)({ method: 'POST', headers: {}, query: {}, body: { action_id: ID, approved: true, ...body } }, res);
  return res as { statusCode: number; body: any };
};

const ALLOW = { ok: true, policy: { execution_enabled: true, auto_rules_enabled: false }, version: 'v1' };

beforeEach(() => {
  for (const k of Object.keys(mockRows)) delete mockRows[k];
  mockSessions.length = 0;
  mockWrites.length = 0;
  mockClaim.mockReset();
  mockExecute.mockReset();
  mockRefusal.mockClear();
  mockPolicy.mockReset();
  mockPolicy.mockResolvedValue(ALLOW);
  mockClaim.mockResolvedValue({ claimed: true, code: null, currentStatus: 'executing' });
  mockExecute.mockResolvedValue({ ok: true, status: 'executed', execution_mode: 'api' });
});

const actionWrites = () => mockWrites.filter((w) => w.table === 'community_ai_actions');

describe('pre-claim refusals never burn the approval (LD-7)', () => {
  it.each([
    ['PLATFORM_KILL_SWITCH'],
    ['POLICY_MISSING'],
    ['POLICY_EXECUTION_DISABLED'],
    ['POLICY_UNREADABLE'],
  ])('policy refusal %s -> 423 COMMUNITY_EXECUTION_DISABLED, no claim, one refusal record', async (code) => {
    mockRows[ID] = approved();
    mockPolicy.mockResolvedValue({ ok: false, code });
    const r = await call();
    expect(r.statusCode).toBe(423);
    expect(r.body).toEqual({ error: 'COMMUNITY_EXECUTION_DISABLED', code });
    expect(mockPolicy).toHaveBeenCalledWith({ organizationId: 'org-1', tenantId: 'org-1' });
    expect(mockClaim).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
    expect(actionWrites()).toEqual([]);
    expect(mockRefusal).toHaveBeenCalledTimes(1);
    expect(mockRefusal).toHaveBeenCalledWith(expect.objectContaining({ actionId: ID, organizationId: 'org-1', tenantId: 'org-1', claimPoint: 'manual', code, actorId: 'human-1' }));
  });

  it('an approval older than 7 days -> 403 APPROVAL_EXPIRED, no claim, row left approved', async () => {
    mockRows[ID] = approved({}, { approvedAt: approvedAgo(7 * 24 * 3600_000 + 60_000) });
    const r = await call();
    expect(r.statusCode).toBe(403);
    expect(r.body).toMatchObject({ error: 'APPROVAL_EXPIRED', code: 'APPROVAL_EXPIRED', reapprove: true });
    expect(mockClaim).not.toHaveBeenCalled();
    expect(actionWrites()).toEqual([]);
    expect(mockRows[ID].status).toBe('approved');
    expect(mockRefusal).toHaveBeenCalledWith(expect.objectContaining({ claimPoint: 'manual', code: 'APPROVAL_EXPIRED' }));
  });

  it('just inside 7 days is not expired', async () => {
    mockRows[ID] = approved({}, { approvedAt: approvedAgo(7 * 24 * 3600_000 - 60_000) });
    expect((await call()).statusCode).toBe(200);
    expect(mockClaim).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['no approver', { approved_by: null }],
    ['no content binding', { approved_content_hash: null }],
    ['no passkey', { passkey_credential_id: null }],
  ])('approval evidence missing (%s) -> 403 APPROVAL_EVIDENCE_REQUIRED, no claim', async (_n, strip) => {
    mockRows[ID] = { ...approved(), ...strip };
    const r = await call();
    expect(r.statusCode).toBe(403);
    expect(r.body).toMatchObject({ error: 'APPROVAL_EVIDENCE_REQUIRED', code: 'APPROVAL_EVIDENCE_REQUIRED', reapprove: true });
    expect(mockClaim).not.toHaveBeenCalled();
    expect(mockRefusal).toHaveBeenCalledWith(expect.objectContaining({ code: 'APPROVAL_EVIDENCE_REQUIRED' }));
  });

  it('content changed after approval -> 403 APPROVAL_EVIDENCE_REQUIRED (APPROVAL_CONTENT_CHANGED)', async () => {
    mockRows[ID] = { ...approved(), target_id: 'https://www.linkedin.com/feed/update/urn:li:activity:2/' };
    const r = await call();
    expect(r.statusCode).toBe(403);
    expect(r.body).toMatchObject({ error: 'APPROVAL_EVIDENCE_REQUIRED', code: 'APPROVAL_CONTENT_CHANGED' });
    expect(mockClaim).not.toHaveBeenCalled();
  });

  it('an AI flag (requires_human_approval=false, low risk) never waives the evidence', async () => {
    mockRows[ID] = base({ requires_human_approval: false, risk_level: 'low', approved_at: approvedAgo() });
    const r = await call();
    expect(r.statusCode).toBe(403);
    expect(r.body.error).toBe('APPROVAL_EVIDENCE_REQUIRED');
    expect(mockClaim).not.toHaveBeenCalled();
  });

  it('approved with no approved_at -> 403 APPROVAL_REQUIRED', async () => {
    mockRows[ID] = base({ approved_at: null });
    const r = await call();
    expect(r.statusCode).toBe(403);
    expect(r.body).toMatchObject({ error: 'APPROVAL_REQUIRED' });
    expect(mockClaim).not.toHaveBeenCalled();
  });
});

describe('row state: 409 only for a genuine conflict; nothing is claimed', () => {
  it('pending, never approved -> 403 APPROVAL_REQUIRED', async () => {
    mockRows[ID] = base({ status: 'pending', approved_at: null });
    const r = await call();
    expect([r.statusCode, r.body.error]).toEqual([403, 'APPROVAL_REQUIRED']);
  });

  it('executing -> 409 ACTION_IN_PROGRESS', async () => {
    mockRows[ID] = approved({ status: 'executing' });
    const r = await call();
    expect([r.statusCode, r.body.error, r.body.current_status]).toEqual([409, 'ACTION_IN_PROGRESS', 'executing']);
  });

  it('leased browser row -> 409 ACTION_DISPATCHED', async () => {
    mockRows[ID] = approved({ status: 'pending', execution_mode: 'browser', dispatch_lease_id: 'lease-1' });
    const r = await call();
    expect([r.statusCode, r.body.error]).toEqual([409, 'ACTION_DISPATCHED']);
  });

  it('unleased browser row with a live extension -> 202 AWAITING_EXTENSION (NOT 409)', async () => {
    mockRows[ID] = approved({ status: 'pending', execution_mode: 'browser' });
    mockSessions.push({ id: 's1', org_id: 'org-1', last_seen: new Date().toISOString(), expires_at: new Date(Date.now() + 3600_000).toISOString() });
    const r = await call();
    expect(r.statusCode).toBe(202);
    expect(r.body).toMatchObject({ code: 'AWAITING_EXTENSION', status: 'pending' });
  });

  it('unleased browser row with no live extension -> 503 EXTENSION_NOT_READY', async () => {
    mockRows[ID] = approved({ status: 'pending', execution_mode: 'browser' });
    mockSessions.push({ id: 'stale', org_id: 'org-1', last_seen: new Date(Date.now() - 3600_000).toISOString(), expires_at: new Date(Date.now() + 3600_000).toISOString() });
    mockSessions.push({ id: 'other-org', org_id: 'org-2', last_seen: new Date().toISOString(), expires_at: new Date(Date.now() + 3600_000).toISOString() });
    const r = await call();
    expect([r.statusCode, r.body.error]).toEqual([503, 'EXTENSION_NOT_READY']);
  });

  it.each(['executed', 'sent_unverified'])('%s -> 200 idempotent', async (status) => {
    mockRows[ID] = approved({ status, execution_result: { ok: true } });
    const r = await call();
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatchObject({ idempotent: true, status });
  });

  it.each(['failed', 'skipped', 'uncertain'])('%s -> 422 ACTION_TERMINAL', async (status) => {
    mockRows[ID] = approved({ status });
    const r = await call();
    expect([r.statusCode, r.body.error, r.body.current_status]).toEqual([422, 'ACTION_TERMINAL', status]);
  });

  it('tenant mismatch -> 403 TENANT_SCOPE_VIOLATION', async () => {
    mockRows[ID] = approved({ tenant_id: 'org-2', organization_id: 'org-2' });
    const r = await call();
    expect([r.statusCode, r.body.error]).toEqual([403, 'TENANT_SCOPE_VIOLATION']);
  });

  afterEach(() => {
    expect(mockClaim).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
    expect(actionWrites()).toEqual([]);
  });
});

describe('the claim RPC result', () => {
  it('a lost race -> 409 ACTION_CLAIM_CONFLICT; the executor never runs', async () => {
    mockRows[ID] = approved();
    mockClaim.mockResolvedValue({ claimed: false, code: 'CLAIM_CONFLICT', currentStatus: 'executing' });
    const r = await call();
    expect(r.statusCode).toBe(409);
    expect(r.body).toEqual({ error: 'ACTION_CLAIM_CONFLICT', current_status: 'executing' });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it.each([
    ['PLATFORM_KILL_SWITCH', 423, 'COMMUNITY_EXECUTION_DISABLED'],
    ['POLICY_AUTO_RULES_DISABLED', 423, 'COMMUNITY_EXECUTION_DISABLED'],
    ['APPROVAL_EXPIRED', 403, 'APPROVAL_EXPIRED'],
    ['APPROVAL_EVIDENCE_REQUIRED', 403, 'APPROVAL_EVIDENCE_REQUIRED'],
    ['APPROVAL_REQUIRED', 403, 'APPROVAL_REQUIRED'],
    ['TENANT_SCOPE_VIOLATION', 403, 'TENANT_SCOPE_VIOLATION'],
    ['ACTION_NOT_FOUND', 404, 'ACTION_NOT_FOUND'],
    ['SOMETHING_NEW', 500, 'CLAIM_REFUSED'],
    ['CLAIM_RPC_ERROR', 500, 'STATE_TRANSITION_FAILED'],
    ['CLAIM_STAMP_FAILED', 500, 'STATE_TRANSITION_FAILED'],
  ])('claim refusal %s -> %i %s; no executor, no second refusal record here', async (code, status, error) => {
    mockRows[ID] = approved();
    mockClaim.mockResolvedValue({ claimed: false, code, currentStatus: 'approved' });
    const r = await call();
    expect([r.statusCode, r.body.error]).toEqual([status, error]);
    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockRefusal).not.toHaveBeenCalled(); // the RPC recorded it
  });

  it('happy path: one claim (manual, mode, correlation id), then the executor CAS from executing', async () => {
    mockRows[ID] = approved();
    const r = await call({ execution_mode: 'api' });
    expect(r.statusCode).toBe(200);
    expect(mockClaim).toHaveBeenCalledTimes(1);
    const claimArg = mockClaim.mock.calls[0][0];
    expect(claimArg).toMatchObject({ actionId: ID, tenantId: 'org-1', organizationId: 'org-1', claimPoint: 'manual', executionMode: 'api', stamp: { idempotency_key: null } });
    expect(claimArg.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(mockExecute).toHaveBeenCalledTimes(1);
    const opts = mockExecute.mock.calls[0][2];
    expect(opts).toMatchObject({ source: 'manual', persist: true, expected_from_statuses: ['executing'], correlation_id: claimArg.correlationId });
    expect(mockClaim.mock.invocationCallOrder[0]).toBeLessThan(mockExecute.mock.invocationCallOrder[0]);
    expect(mockRefusal).not.toHaveBeenCalled();
  });

  it('an idempotency-key collision at the claim answers the prior row (200 idempotent); nothing runs', async () => {
    mockRows[ID] = approved();
    mockRows.prior = { id: 'prior', organization_id: 'org-1', idempotency_key: 'k-1', status: 'executed', execution_result: { ok: true } };
    mockClaim.mockResolvedValue({ claimed: false, code: 'IDEMPOTENCY_KEY_CONFLICT', currentStatus: 'approved' });
    const res: any = { statusCode: 0, body: undefined };
    res.status = (c: number) => { res.statusCode = c; return res; };
    res.json = (b: unknown) => { res.body = b; return res; };
    // The first read (before the claim) finds no prior row: emulate the key landing in between.
    const prior = mockRows.prior; delete mockRows.prior;
    mockClaim.mockImplementation(async () => { mockRows.prior = prior; return { claimed: false, code: 'IDEMPOTENCY_KEY_CONFLICT', currentStatus: 'approved' }; });
    await (handler as any)({ method: 'POST', headers: { 'idempotency-key': 'k-1' }, query: {}, body: { action_id: ID, approved: true } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ action_id: 'prior', status: 'executed', idempotent: true });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('a refusal from a gate inside the executor maps the same way (423)', async () => {
    mockRows[ID] = approved();
    mockExecute.mockResolvedValue({ ok: false, status: 'skipped', reason: 'PLATFORM_POLICY', error: 'POLICY_EXECUTION_DISABLED', response: { pre_claim_refusal: true, code: 'POLICY_EXECUTION_DISABLED' } });
    const r = await call();
    expect([r.statusCode, r.body.error, r.body.code]).toEqual([423, 'COMMUNITY_EXECUTION_DISABLED', 'POLICY_EXECUTION_DISABLED']);
  });

  it('body.approved !== true -> 403 before anything is read', async () => {
    mockRows[ID] = approved();
    const r = await call({ approved: false });
    expect([r.statusCode, r.body.error]).toEqual([403, 'APPROVAL_REQUIRED']);
    expect(mockPolicy).not.toHaveBeenCalled();
    expect(mockClaim).not.toHaveBeenCalled();
  });
});
