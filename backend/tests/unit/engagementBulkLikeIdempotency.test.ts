/**
 * /api/engagement/message/bulk-like — stable, durable per-item request identity
 * (engagementRequestIdempotency, scope 'like').
 *
 * Before: every item got crypto.randomUUID() as its action id, so a retried or
 * double-submitted bulk request liked every message again. Now every item is a
 * durable request record (reserve-before-act on the primary key) whose action
 * id is derived from (tenant, actor, scope, item key, attempt).
 *
 * Two executors:
 *   - 'real': the real communityAiActionExecutorRuntime on the in-memory
 *     PostgREST fake (bulk-like dispatches execution_mode 'manual', which the
 *     executor records as a sent_unverified simulation row).
 *   - 'fake': a programmable executor that models the executor's primary-key
 *     dedup and lets a test choose the outcome (executed / not-acted failure /
 *     may-have-acted throw). It counts how many times an item ACTED.
 *
 * The response double is Next-faithful: json() returns undefined and a second
 * response on the same res throws.
 *
 * D-01: the REAL executor refuses an ad-hoc (auto_insert) like before writing
 * any action row (skipped / HUMAN_APPROVAL_REQUIRED, may_have_acted=false), so
 * the 'real' tests below assert that refusal. The 'fake' executor still models
 * an acting executor; it exercises the request ledger, not approval.
 */
import { createFakeDb, COMMUNITY_STATUS_VOCABULARY, type FakeDb } from './helpers/communityExecutionFakeDb';

let mockDb: FakeDb = createFakeDb();
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => mockDb.from(t),
  ownedDbRpc: jest.fn(async () => ({ data: null, error: null })),
}));
jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: (t: string) => mockDb.from(t), rpc: jest.fn(async () => ({ data: null, error: null })) },
}));
const mockPolicy = { execution_enabled: true, require_human_approval: false };
jest.mock('../../services/communityAiPlatformPolicyService', () => ({
  getCommunityAiPlatformPolicy: jest.fn(async () => ({ ...mockPolicy })),
}));
jest.mock('../../services/usageEnforcementService', () => ({ checkUsageBeforeExecution: jest.fn(async () => ({ allowed: true })) }));
jest.mock('../../services/communityAiNotificationService', () => ({ notifyCommunityAi: jest.fn(async () => undefined) }));
jest.mock('../../services/communityAiWebhookService', () => ({ sendCommunityAiWebhooks: jest.fn(async () => undefined) }));
jest.mock('../../services/communityAiActionLogService', () => ({ logCommunityAiActionEvent: jest.fn(async () => undefined) }));
jest.mock('../../services/usageLedgerService', () => ({ logUsageEvent: jest.fn(async () => undefined) }));
jest.mock('../../services/usageMeterService', () => ({ incrementUsageMeter: jest.fn(async () => undefined) }));
jest.mock('../../services/platformTokenService', () => ({ getToken: jest.fn(async () => ({ access_token: 'tok' })) }));
let mockPlaybooks: Array<{ id: string; status: string }> = [{ id: 'pb1', status: 'active' }];
jest.mock('../../services/playbooks/playbookService', () => ({
  getPlaybookById: jest.fn(async () => ({ id: 'pb1' })),
  listPlaybooks: jest.fn(async () => mockPlaybooks),
}));
jest.mock('../../services/playbooks/playbookValidator', () => ({ validateActionAgainstPlaybook: jest.fn(() => ({ allowed: true })) }));
jest.mock('../../services/executionGuardrailService', () => ({ canExecuteAction: jest.fn(async () => ({ allowed: true })) }));
jest.mock('../../services/rpaWorker/rpaWorkerService', () => ({ executeRpaTask: jest.fn(), rpaResultMayHaveActed: () => true }));

type Outcome = 'executed' | 'not_acted' | 'throw_uncertain';
let mockExecutorMode: 'real' | 'fake' = 'fake';
const mockOutcomes = new Map<string, Outcome>(); // target_id → outcome (fake executor)
const mockActs: string[] = []; // target ids that ACTED (fake executor)
const mockExecCalls: Array<{ id: string; target_id: string; source?: string }> = [];
jest.mock('../../services/communityAiActionExecutor', () => {
  const real = jest.requireActual('../../services/communityAiActionExecutor');
  return {
    ...real,
    executeAction: async (action: any, approved: boolean, opts: any) => {
      mockExecCalls.push({ id: action.id, target_id: action.target_id, source: opts?.source });
      if (mockExecutorMode === 'real') return real.executeAction(action, approved, opts);
      // Fake: the executor's primary-key dedup, then a chosen outcome.
      const rows = mockDb.tables.community_ai_actions;
      const existing = rows.find((r) => r.id === action.id);
      if (existing) return { ok: existing.status === 'executed', status: existing.status, deduplicated: true };
      const outcome = mockOutcomes.get(action.target_id) ?? 'executed';
      if (outcome === 'not_acted') {
        rows.push({ id: action.id, organization_id: action.organization_id, status: 'blocked' });
        return { ok: false, status: 'blocked', error: { code: 'PLAN_LIMIT_EXCEEDED' }, may_have_acted: false };
      }
      rows.push({ id: action.id, organization_id: action.organization_id, status: 'executing' });
      await new Promise((r) => setTimeout(r, 3));
      mockActs.push(action.target_id);
      if (outcome === 'throw_uncertain') throw new Error('socket hang up');
      rows.find((r) => r.id === action.id)!.status = 'executed';
      return { ok: true, status: 'executed', platform_id: 'urn:li:like:1' };
    },
  };
});

let mockUserId = 'user_1';
jest.mock('../../services/userContextService', () => ({
  resolveUserContext: async () => ({ userId: mockUserId, defaultCompanyId: null }),
  enforceCompanyAccess: async () => true,
}));
jest.mock('../../services/rbacService', () => ({
  enforceRole: async () => ({ userId: mockUserId, role: 'COMPANY_ADMIN' }),
}));
jest.mock('../../services/rbac/communityAiCapabilities', () => ({
  COMMUNITY_AI_CAPABILITIES: { EXECUTE_ACTIONS: ['COMPANY_ADMIN'] },
}));
const mockIncrementLike = jest.fn(async () => undefined);
jest.mock('../../services/responsePerformanceService', () => ({
  incrementReplyLike: (...a: any[]) => mockIncrementLike(...(a as [])),
}));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

/* eslint-disable @typescript-eslint/no-var-requires */
const bulkLikeHandler = require('../../../pages/api/engagement/message/bulk-like').default;
const idem = require('../../services/engagementRequestIdempotency');
/* eslint-enable @typescript-eslint/no-var-requires */

const ORG = '00000000-0000-0000-0000-00000000000a';
const OTHER_ORG = '00000000-0000-0000-0000-00000000000b';

/** Next-faithful response double: json() returns undefined; a 2nd response throws. */
function nextRes() {
  const res: any = { statusCode: 200, body: undefined, sent: 0, headers: {} as Record<string, unknown> };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.setHeader = (k: string, v: unknown) => { res.headers[k] = v; return res; };
  res.json = (b: unknown) => {
    if (res.sent > 0) throw new Error('ERR_HTTP_HEADERS_SENT: response already sent');
    res.sent += 1;
    res.body = b;
    return undefined;
  };
  return res;
}

async function bulk(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  const res = nextRes();
  await bulkLikeHandler({ method: 'POST', headers, query: {}, body: { organization_id: ORG, ...body } }, res);
  expect(res.sent).toBe(1);
  return res;
}

const actions = () => mockDb.tables.community_ai_actions;
const records = () => mockDb.tables.engagement_request_idempotency ?? [];

/** D-01 refusals: the real executor's pre-insert approval refusal, as logged. */
const approvalRefusals = () =>
  (jest.requireMock('../../services/communityAiActionLogService').logCommunityAiActionEvent as jest.Mock).mock.calls
    .filter(([e]: any[]) => e?.event_type === 'skipped'
      && e?.event_payload?.reason === 'ad_hoc_action_has_no_human_approval');

beforeEach(() => {
  mockDb = createFakeDb({
    community_ai_actions: [],
    community_ai_execution_metric_events: [],
    engagement_request_idempotency: [],
    engagement_messages: [
      { id: 'm1', organization_id: ORG, thread_id: 't1', platform_message_id: 'pm1', post_comment_id: null, platform: 'linkedin', platform_created_at: '2026-10-01T00:00:00Z' },
      { id: 'm2', organization_id: ORG, thread_id: 't2', platform_message_id: 'pm2', post_comment_id: null, platform: 'linkedin', platform_created_at: '2026-10-01T00:00:00Z' },
      { id: 'm3', organization_id: ORG, thread_id: 't3', platform_message_id: 'pm3', post_comment_id: null, platform: 'linkedin', platform_created_at: '2026-10-01T00:00:00Z' },
    ],
    engagement_threads: [
      { id: 't1', organization_id: ORG },
      { id: 't2', organization_id: ORG },
      { id: 't3', organization_id: ORG },
    ],
  });
  mockDb.statusCheck.community_ai_actions = COMMUNITY_STATUS_VOCABULARY;
  mockExecutorMode = 'fake';
  mockOutcomes.clear();
  mockActs.length = 0;
  mockExecCalls.length = 0;
  mockIncrementLike.mockClear();
  (jest.requireMock('../../services/communityAiActionLogService').logCommunityAiActionEvent as jest.Mock).mockClear();
  mockUserId = 'user_1';
  mockPlaybooks = [{ id: 'pb1', status: 'active' }];
  mockPolicy.execution_enabled = true;
});

// ─────────────────────────────────────────────────────────────────────────────
describe('stable identity — same request → same ids; retry keeps ids', () => {
  it('no random ids: action ids are the derived per-item ids, identical across a retry', async () => {
    const first = await bulk({ message_ids: ['m1', 'm2'] }, { 'idempotency-key': 'bulk-key-0001' });
    expect(first.statusCode).toBe(200);
    expect(first.body).toEqual({ success: true, liked: 2 });
    const ids1 = mockExecCalls.map((c) => c.id);
    for (const [i, m] of ['m1', 'm2'].entries()) {
      const key = idem.deriveBulkItemRequestKey('bulk-key-0001', { kind: 'message', id: m });
      const rec = idem.requestRecordId({ organizationId: ORG, actorId: 'user_1', scope: 'like', key });
      expect(ids1[i]).toBe(idem.actionIdForAttempt(rec, 1));
    }

    const retry = await bulk({ message_ids: ['m1', 'm2'] }, { 'idempotency-key': 'bulk-key-0001' });
    expect(retry.statusCode).toBe(200);
    expect(retry.body.liked).toBe(2);
    expect(retry.body.items.every((x: any) => x.replayed === true && x.status === 200)).toBe(true);
    expect(mockExecCalls).toHaveLength(2); // no new executeAction at all
    expect(mockActs).toEqual(['pm1', 'pm2']); // one act per item, ever
    expect(records()).toHaveLength(2);
    expect(records().every((r) => r.scope === 'like' && r.key_source === 'client')).toBe(true);
  });

  it('without a key, items share the single /like derived record (unbucketed) — a retry never re-likes', async () => {
    await bulk({ message_ids: ['m1'] });
    await bulk({ message_ids: ['m1'] });
    expect(mockActs).toEqual(['pm1']);
    const fp = idem.computeRequestFingerprint({ scope: 'like', platform: 'linkedin', messageId: 'm1', account: ORG });
    expect(records()).toHaveLength(1);
    expect(records()[0]).toMatchObject({ idempotency_key: `derived:${fp}`, key_source: 'derived', scope: 'like' });
  });

  it('per-item keys satisfy the table key-shape CHECK and are distinct per item, per kind and per bulk key', () => {
    const shape = /^[A-Za-z0-9._:-]{8,200}$/;
    const a = idem.deriveBulkItemRequestKey('bulk-key-0001', { kind: 'message', id: 'm1' });
    const b = idem.deriveBulkItemRequestKey('bulk-key-0001', { kind: 'message', id: 'm2' });
    const c = idem.deriveBulkItemRequestKey('bulk-key-0002', { kind: 'message', id: 'm1' });
    const d = idem.deriveBulkItemRequestKey('bulk-key-0001', { kind: 'thread', id: 'm1' });
    for (const k of [a, b, c, d]) expect(k).toMatch(shape);
    expect(new Set([a, b, c, d]).size).toBe(4);
    expect(idem.deriveBulkItemRequestKey('bulk-key-0001', { kind: 'message', id: 'm1' })).toBe(a);
  });

  it('a NEW bulk key is a new intent (items may act again)', async () => {
    await bulk({ message_ids: ['m1'] }, { 'idempotency-key': 'bulk-key-0003' });
    await bulk({ message_ids: ['m1'] }, { 'idempotency-key': 'bulk-key-0004' });
    expect(mockActs).toEqual(['pm1', 'pm1']);
  });

  it('thread_ids items keep the thread identity across a retry', async () => {
    await bulk({ thread_ids: ['t1', 't2'] }, { 'idempotency-key': 'bulk-key-0005' });
    const retry = await bulk({ thread_ids: ['t1', 't2'] }, { 'idempotency-key': 'bulk-key-0005' });
    expect(mockActs).toEqual(['pm1', 'pm2']);
    expect(retry.body.items.map((x: any) => x.item)).toEqual([{ kind: 'thread', id: 't1' }, { kind: 'thread', id: 't2' }]);
  });

  // D-01: was "retry creates no new action rows" after 3 liked items. Every
  // item is now refused before any row is written; a retry with the same key
  // re-runs the gate (failed_not_acted, attempt 2) and still writes no row.
  it('real executor: every item is refused for lack of approval; a retry still creates no action rows', async () => {
    mockExecutorMode = 'real';
    const first = await bulk({ message_ids: ['m1', 'm2', 'm3'] }, { 'idempotency-key': 'bulk-key-real-1' });
    expect(first.body).toMatchObject({ success: true, liked: 0 });
    expect(first.body.items.every((x: any) => x.status === 502 && x.request_state === 'failed_not_acted')).toBe(true);
    expect(approvalRefusals()).toHaveLength(3);
    expect(actions()).toHaveLength(0);
    const retry = await bulk({ message_ids: ['m1', 'm2', 'm3'] }, { 'idempotency-key': 'bulk-key-real-1' });
    expect(retry.body.liked).toBe(0);
    expect(approvalRefusals()).toHaveLength(6);
    expect(actions()).toHaveLength(0);
    expect(records().every((r) => r.state === 'failed_not_acted' && r.attempt === 2)).toBe(true);
  });
});

describe('concurrent duplicates → exactly one action per item', () => {
  it('three concurrent identical bulk requests (same key) act once per item', async () => {
    const rs = await Promise.all([
      bulk({ message_ids: ['m1', 'm2'] }, { 'idempotency-key': 'bulk-key-0010' }),
      bulk({ message_ids: ['m1', 'm2'] }, { 'idempotency-key': 'bulk-key-0010' }),
      bulk({ message_ids: ['m1', 'm2'] }, { 'idempotency-key': 'bulk-key-0010' }),
    ]);
    expect(mockActs.filter((t) => t === 'pm1')).toHaveLength(1);
    expect(mockActs.filter((t) => t === 'pm2')).toHaveLength(1);
    expect(rs.every((r) => r.statusCode === 200)).toBe(true);
    const totalLiked = rs.reduce((n, r) => n + r.body.liked, 0);
    expect(totalLiked).toBeGreaterThanOrEqual(2); // others are in-progress or replays, never new acts
  });

  it('concurrent keyless duplicates act once per item', async () => {
    await Promise.all([bulk({ message_ids: ['m1', 'm2'] }), bulk({ message_ids: ['m1', 'm2'] })]);
    expect(mockActs.sort()).toEqual(['pm1', 'pm2']);
  });
});

describe('payload conflict → 422, nothing sent', () => {
  it('a thread item whose latest message changed under the same key → 422 for the whole request', async () => {
    await bulk({ thread_ids: ['t1', 't2'] }, { 'idempotency-key': 'bulk-key-0020' });
    expect(mockActs).toEqual(['pm1', 'pm2']);
    // A newer message lands in t2: the same bulk key now names a different payload for that item.
    mockDb.tables.engagement_messages.push({
      id: 'm2b', organization_id: ORG, thread_id: 't2', platform_message_id: 'pm2b', post_comment_id: null, platform: 'linkedin', platform_created_at: '2026-10-20T00:00:00Z',
    });
    mockDb.tables.engagement_messages.push({
      id: 'm3b', organization_id: ORG, thread_id: 't3', platform_message_id: 'pm3', post_comment_id: null, platform: 'linkedin', platform_created_at: '2026-10-21T00:00:00Z',
    });
    const r = await bulk({ thread_ids: ['t1', 't2', 't3'] }, { 'idempotency-key': 'bulk-key-0020' });
    expect(r.statusCode).toBe(422);
    expect(r.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED', item: { kind: 'thread', id: 't2' } });
    expect(mockActs).toEqual(['pm1', 'pm2']); // nothing sent — not even the new t3 item
    expect(mockExecCalls).toHaveLength(2);
  });

  it('malformed Idempotency-Key → 400 before any read or action', async () => {
    const r = await bulk({ message_ids: ['m1'] }, { 'idempotency-key': 'x' });
    expect(r.statusCode).toBe(400);
    expect(r.body.code).toBe('INVALID_IDEMPOTENCY_KEY');
    expect(mockExecCalls).toHaveLength(0);
    expect(records()).toHaveLength(0);
  });
});

describe('uncertain item never resent; not-acted item retried with the same key', () => {
  it('a may-have-acted throw → uncertain; the retry answers 409 OUTCOME_UNCERTAIN and never resends it', async () => {
    mockOutcomes.set('pm2', 'throw_uncertain');
    const first = await bulk({ message_ids: ['m1', 'm2', 'm3'] }, { 'idempotency-key': 'bulk-key-0030' });
    expect(first.statusCode).toBe(500); // pre-existing behaviour: a throw aborts the batch
    expect(mockActs).toEqual(['pm1', 'pm2']);
    mockOutcomes.clear();
    const retry = await bulk({ message_ids: ['m1', 'm2', 'm3'] }, { 'idempotency-key': 'bulk-key-0030' });
    expect(retry.statusCode).toBe(200);
    const byMsg = Object.fromEntries(retry.body.items.map((x: any) => [x.message_id, x]));
    expect(byMsg.m1).toMatchObject({ status: 200, replayed: true, liked: true });
    expect(byMsg.m2).toMatchObject({ status: 409, code: 'OUTCOME_UNCERTAIN', liked: false });
    expect(byMsg.m3).toMatchObject({ status: 200, liked: true });
    expect(mockActs).toEqual(['pm1', 'pm2', 'pm3']); // pm2 NOT resent
    expect(records().find((r) => r.target_id === 'pm2')!.state).toBe('uncertain');
  });

  it('a provably-not-acted failure is retried with the SAME key (attempt 2, new derived action id, gates again)', async () => {
    mockOutcomes.set('pm1', 'not_acted');
    const first = await bulk({ message_ids: ['m1'] }, { 'idempotency-key': 'bulk-key-0040' });
    expect(first.body).toMatchObject({ success: true, liked: 0 });
    expect(first.body.items[0]).toMatchObject({ status: 502, request_state: 'failed_not_acted' });
    mockOutcomes.clear();
    const retry = await bulk({ message_ids: ['m1'] }, { 'idempotency-key': 'bulk-key-0040' });
    expect(retry.body).toEqual({ success: true, liked: 1 });
    const rec = records()[0];
    expect(rec).toMatchObject({ state: 'completed', attempt: 2 });
    expect(mockExecCalls.map((c) => c.id)).toEqual([idem.actionIdForAttempt(rec.id, 1), idem.actionIdForAttempt(rec.id, 2)]);
    expect(mockActs).toEqual(['pm1']);
  });

  // D-01: was "kill switch blocks; switching it back on lets the retry like".
  // The approval refusal now comes before the kill switch for an ad-hoc like,
  // so the kill switch is no longer observable on this path (that purpose no
  // longer applies here). What remains: every retry re-runs the gate and is
  // refused, whether execution is on or off — never replayed as success.
  it('real executor: kill switch on or off, the item is refused for lack of approval; each retry runs the gate again', async () => {
    mockExecutorMode = 'real';
    mockPolicy.execution_enabled = false;
    const first = await bulk({ message_ids: ['m1'] }, { 'idempotency-key': 'bulk-key-0050' });
    expect(first.body.liked).toBe(0);
    expect(records()[0].state).toBe('failed_not_acted');
    const again = await bulk({ message_ids: ['m1'] }, { 'idempotency-key': 'bulk-key-0050' });
    expect(again.body.liked).toBe(0);
    expect(records()[0]).toMatchObject({ state: 'failed_not_acted', attempt: 2 });
    mockPolicy.execution_enabled = true;
    const on = await bulk({ message_ids: ['m1'] }, { 'idempotency-key': 'bulk-key-0050' });
    expect(on.body).toMatchObject({ success: true, liked: 0 });
    expect(records()[0]).toMatchObject({ state: 'failed_not_acted', attempt: 3 });
    expect(approvalRefusals()).toHaveLength(3);
    expect(actions()).toHaveLength(0);
  });
});

describe('tenant isolation and route gates are preserved', () => {
  it('a message in a foreign-org thread is skipped: nothing reserved, nothing sent', async () => {
    mockDb.tables.engagement_threads.find((t) => t.id === 't2')!.organization_id = OTHER_ORG;
    const r = await bulk({ message_ids: ['m1', 'm2'] }, { 'idempotency-key': 'bulk-key-0060' });
    expect(r.body).toEqual({ success: true, liked: 1 });
    expect(mockActs).toEqual(['pm1']);
    expect(records()).toHaveLength(1);
  });

  it('no active playbook → nothing reserved, nothing sent', async () => {
    mockPlaybooks = [];
    const r = await bulk({ message_ids: ['m1'] }, { 'idempotency-key': 'bulk-key-0061' });
    expect(r.body).toEqual({ success: true, liked: 0 });
    expect(records()).toHaveLength(0);
    expect(mockExecCalls).toHaveLength(0);
  });

  it('the same key used by another actor or tenant is a different record', async () => {
    await bulk({ message_ids: ['m1'] }, { 'idempotency-key': 'bulk-key-0062' });
    mockUserId = 'user_2';
    await bulk({ message_ids: ['m1'] }, { 'idempotency-key': 'bulk-key-0062' });
    expect(records()).toHaveLength(2);
    expect(new Set(records().map((r) => r.actor_id))).toEqual(new Set(['user_1', 'user_2']));
    expect(records().every((r) => r.organization_id === ORG)).toBe(true);
  });

  it('request ledger unavailable on inspection → 503, nothing sent', async () => {
    const origFrom = mockDb.from;
    mockDb.from = (t: string) => {
      const q = origFrom(t);
      if (t === 'engagement_request_idempotency') q.maybeSingle = () => ({ then: (res: any) => res({ data: null, error: { message: 'down' } }) });
      return q;
    };
    const r = await bulk({ message_ids: ['m1'] }, { 'idempotency-key': 'bulk-key-0063' });
    expect(r.statusCode).toBe(503);
    expect(r.body.code).toBe('IDEMPOTENCY_UNAVAILABLE');
    expect(mockExecCalls).toHaveLength(0);
  });
});
