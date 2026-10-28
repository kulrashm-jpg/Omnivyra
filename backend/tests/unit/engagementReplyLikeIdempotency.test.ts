/**
 * D4 — request-level idempotency for /api/engagement/reply and /like, and the
 * executor rule underneath it (D1): an action row that already exists is never
 * executed again and never revived.
 *
 * Real executor (communityAiActionExecutorRuntime) + real routes on the
 * in-memory PostgREST fake; the platform connector is a counting fake. The
 * assertion that matters everywhere is: how many times did the platform
 * connector run?
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
jest.mock('../../services/playbooks/playbookService', () => ({
  getPlaybookById: jest.fn(async () => ({ id: 'pb1' })),
  listPlaybooks: jest.fn(async () => [{ id: 'pb1', status: 'active' }]),
}));
jest.mock('../../services/playbooks/playbookValidator', () => ({ validateActionAgainstPlaybook: jest.fn(() => ({ allowed: true })) }));
jest.mock('../../services/executionGuardrailService', () => ({ canExecuteAction: jest.fn(async () => ({ allowed: true })) }));
jest.mock('../../services/rpaWorker/rpaWorkerService', () => ({ executeRpaTask: jest.fn(), rpaResultMayHaveActed: () => true }));
const mockConnector = jest.fn();
jest.mock('../../services/platformConnectors/linkedinConnector', () => ({
  executeAction: (...a: any[]) => mockConnector(...a),
}));

// Route-level dependencies.
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
let mockCapabilityMode: 'api' | 'browser' = 'api';
jest.mock('../../services/engagementCapabilityMap', () => ({
  resolveEngagementCapability: () => ({ status: 'api_verified', mode: mockCapabilityMode }),
}));
const mockIncrementLike = jest.fn(async () => undefined);
jest.mock('../../services/responsePerformanceService', () => ({
  incrementReplyLike: (...a: any[]) => mockIncrementLike(...(a as [])),
  recordReplyPerformance: async () => undefined,
}));
jest.mock('../../services/auditLoggingService', () => ({ logAuditEvent: async () => undefined }));
jest.mock('../../services/engagementOpportunityResolutionService', () => ({ resolveOpportunityByReply: async () => undefined }));
jest.mock('../../services/aiSuggestionTrackingService', () => ({ recordSuggestionAccepted: async () => undefined }));
jest.mock('../../services/engagementThreadEventService', () => ({ recordThreadEvent: async () => undefined }));
jest.mock('../../services/engagementThreadService', () => ({ isThreadActionable: async () => true }));
jest.mock('../../services/campaignOwnershipService', () => ({ resolveCampaignOwnership: async () => null }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('@/lib/api/withContract', () => ({ withContract: (h: unknown) => h }));

/* eslint-disable @typescript-eslint/no-var-requires */
const likeHandler = require('../../../pages/api/engagement/like').default;
const replyHandler = require('../../../pages/api/engagement/reply').default;
const { executeAction } = require('../../services/communityAiActionExecutor');
const { sendReply } = require('../../services/bulkEngagementService');
const { requestRecordId, actionIdForAttempt, computeRequestFingerprint, readClientIdempotencyKey } = require('../../services/engagementRequestIdempotency');
/* eslint-enable @typescript-eslint/no-var-requires */

const ORG = '00000000-0000-0000-0000-00000000000a';
const OTHER_ORG = '00000000-0000-0000-0000-00000000000b';

function mockRes() {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.setHeader = () => res;
  return res;
}

async function like(headers: Record<string, string> = {}, body: Record<string, unknown> = {}) {
  const res = mockRes();
  await likeHandler({ method: 'POST', headers, body: { organization_id: ORG, message_id: 'm1', platform: 'linkedin', ...body } }, res);
  return res;
}

async function reply(headers: Record<string, string> = {}, body: Record<string, unknown> = {}) {
  const res = mockRes();
  await replyHandler({ method: 'POST', headers, query: {}, body: { organization_id: ORG, message_id: 'm1', platform: 'linkedin', reply_text: 'Thanks!', ...body } }, res);
  return res;
}

/** Slow connector so concurrent requests genuinely interleave. */
function connectorOk() {
  mockConnector.mockImplementation(async () => {
    await new Promise((r) => setTimeout(r, 5));
    return { success: true, platform_id: 'urn:li:like:1' };
  });
}

const actions = () => mockDb.tables.community_ai_actions;

beforeEach(() => {
  mockDb = createFakeDb({
    community_ai_actions: [],
    community_ai_execution_metric_events: [],
    engagement_messages: [{
      id: 'm1', organization_id: ORG, thread_id: 't1', platform_message_id: 'urn:li:comment:(urn:li:activity:1,2)',
      post_comment_id: null, platform: 'linkedin', message_type: 'comment', author_id: null, raw_payload: {},
    }],
    engagement_threads: [{ id: 't1', organization_id: ORG, platform_thread_id: 'urn:li:activity:1', raw_payload: {} }],
    comment_likes: [], comment_replies: [],
  });
  mockDb.statusCheck.community_ai_actions = COMMUNITY_STATUS_VOCABULARY;
  // The shared fake has no upsert; the reply mirror needs one (idempotent on
  // thread_id + platform_message_id, like the real onConflict).
  const origFrom = mockDb.from;
  mockDb.from = (t: string) => {
    const q = origFrom(t);
    q.upsert = async (row: any) => {
      const rows = mockDb.tables[t] || (mockDb.tables[t] = []);
      const hit = rows.find((r) => r.thread_id === row.thread_id && r.platform_message_id === row.platform_message_id);
      if (hit) Object.assign(hit, row); else rows.push({ ...row });
      return { data: null, error: null };
    };
    return q;
  };
  mockConnector.mockReset();
  mockIncrementLike.mockClear();
  mockUserId = 'user_1';
  mockCapabilityMode = 'api';
  mockPolicy.execution_enabled = true;
  connectorOk();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('D4 — like: retries and concurrent duplicates perform ONE like', () => {
  it('client retry with the same Idempotency-Key → one platform call, replayed 200', async () => {
    const first = await like({ 'idempotency-key': 'like-key-0001' });
    const second = await like({ 'idempotency-key': 'like-key-0001' });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.body).toMatchObject({ replayed: true, prior_status: 'executed' });
    expect(mockConnector).toHaveBeenCalledTimes(1);
    expect(mockIncrementLike).toHaveBeenCalledTimes(1);
    expect(actions()).toHaveLength(1);
  });

  it('retry WITHOUT a key inside the bucket (current UI) → one platform call', async () => {
    await like();
    await like();
    expect(mockConnector).toHaveBeenCalledTimes(1);
  });

  it('concurrent double-click (Promise.all) → one platform call', async () => {
    const results = await Promise.all([like(), like(), like()]);
    expect(mockConnector).toHaveBeenCalledTimes(1);
    expect(actions()).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 200 && !r.body.replayed)).toHaveLength(1);
  });

  it('concurrent while the first is still executing → 409 REQUEST_IN_PROGRESS for the duplicate', async () => {
    mockConnector.mockImplementation(async () => { await new Promise((r) => setTimeout(r, 20)); return { success: true }; });
    const [a, b] = await Promise.all([like({ 'idempotency-key': 'like-key-0002' }), like({ 'idempotency-key': 'like-key-0002' })]);
    const codes = [a, b].map((r) => r.statusCode).sort();
    expect(codes).toEqual([200, 409]);
    expect([a, b].find((r) => r.statusCode === 409)!.body.code).toBe('REQUEST_IN_PROGRESS');
    expect(mockConnector).toHaveBeenCalledTimes(1);
  });

  it('a NEW key is a new intent (the action may run again)', async () => {
    await like({ 'idempotency-key': 'like-key-0003' });
    await like({ 'idempotency-key': 'like-key-0004' });
    expect(mockConnector).toHaveBeenCalledTimes(2);
  });

  it('a may-have-acted outcome is never re-run on retry (409 OUTCOME_UNCERTAIN)', async () => {
    mockConnector.mockRejectedValue(new Error('socket hang up'));
    const first = await like({ 'idempotency-key': 'like-key-0005' });
    expect(first.statusCode).toBe(502);
    const second = await like({ 'idempotency-key': 'like-key-0005' });
    expect(second.statusCode).toBe(409);
    expect(second.body.code).toBe('OUTCOME_UNCERTAIN');
    expect(mockConnector).toHaveBeenCalledTimes(1);
  });

  it('a malformed Idempotency-Key is refused before any action', async () => {
    const r = await like({ 'idempotency-key': 'x' });
    expect(r.statusCode).toBe(400);
    expect(r.body.code).toBe('INVALID_IDEMPOTENCY_KEY');
    expect(mockConnector).not.toHaveBeenCalled();
  });
});

describe('D4 — reply: retries and concurrent duplicates perform ONE reply', () => {
  it('same key retried → one platform call, no second mirror/comment row', async () => {
    const first = await reply({ 'idempotency-key': 'reply-key-0001' });
    const second = await reply({ 'idempotency-key': 'reply-key-0001' });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.body.replayed).toBe(true);
    expect(mockConnector).toHaveBeenCalledTimes(1);
    expect(mockDb.tables.engagement_messages.filter((m) => m.direction === 'outgoing')).toHaveLength(1);
  });

  it('concurrent identical replies without a key → one platform call', async () => {
    await Promise.all([reply(), reply(), reply()]);
    expect(mockConnector).toHaveBeenCalledTimes(1);
    expect(actions()).toHaveLength(1);
  });

  it('different text is a different request', async () => {
    await reply({}, { reply_text: 'First' });
    await reply({}, { reply_text: 'Second' });
    expect(mockConnector).toHaveBeenCalledTimes(2);
  });

  // Browser-mode REPLY (DMs are refused before dispatch — see
  // engagementRequestIdempotencyDurable.test.ts).
  it('browser-mode reply: a retry is the queued row (202), never a second claimable row', async () => {
    mockCapabilityMode = 'browser';
    const a = await reply({ 'idempotency-key': 'reply-key-0002' });
    const b = await reply({ 'idempotency-key': 'reply-key-0002' });
    expect(a.statusCode).toBe(202);
    expect(b.statusCode).toBe(202);
    expect(actions().filter((r) => r.status === 'pending' && r.execution_mode === 'browser')).toHaveLength(1);
  });
});

describe('D4 — key binding: tenant + user + scope + key; fingerprint binds the payload', () => {
  const base = { scope: 'like' as const, organizationId: ORG, actorId: 'u1', key: 'k-00000001' };
  it('same inputs → same record id; any component changes → different id; attempts get distinct action ids', () => {
    const id = requestRecordId(base);
    expect(requestRecordId(base)).toBe(id);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    for (const over of [{ organizationId: OTHER_ORG }, { actorId: 'u2' }, { scope: 'reply' as const }, { key: 'k-00000002' }]) {
      expect(requestRecordId({ ...base, ...over })).not.toBe(id);
    }
    expect(actionIdForAttempt(id, 1)).not.toBe(actionIdForAttempt(id, 2));
    expect(actionIdForAttempt(id, 1)).toBe(actionIdForAttempt(id, 1));
    const fp = { scope: 'reply' as const, platform: 'linkedin', messageId: 'm1', text: 'Hi', account: ORG };
    const f = computeRequestFingerprint(fp);
    for (const over of [{ platform: 'twitter' }, { messageId: 'm2' }, { text: 'Hi!' }, { account: OTHER_ORG }, { threadId: 't9' }]) {
      expect(computeRequestFingerprint({ ...fp, ...over })).not.toBe(f);
    }
    // x is the twitter alias; CRLF / surrounding whitespace are not payload changes.
    expect(computeRequestFingerprint({ ...fp, platform: 'x' })).toBe(computeRequestFingerprint({ ...fp, platform: 'twitter' }));
    expect(computeRequestFingerprint({ ...fp, text: '  Hi' + String.fromCharCode(13, 10) })).toBe(f);
  });

  it('another user replaying the same key does not see or re-run the first user\'s action', async () => {
    await like({ 'idempotency-key': 'like-key-0009' });
    mockUserId = 'user_2';
    const r = await like({ 'idempotency-key': 'like-key-0009' });
    expect(r.body.replayed).toBeUndefined();
    expect(actions()).toHaveLength(2);
  });

  it('header parsing', () => {
    expect(readClientIdempotencyKey({ headers: {} } as any)).toEqual({ ok: true, key: null });
    expect(readClientIdempotencyKey({ headers: { 'idempotency-key': ' abcdefgh ' } } as any)).toEqual({ ok: true, key: 'abcdefgh' });
    expect(readClientIdempotencyKey({ headers: { 'idempotency-key': 'bad key!' } } as any).ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('D1 — executor: an existing action row is never executed again or revived', () => {
  const ID = '00000000-0000-0000-0000-0000000000d1';
  const act = (over: Record<string, any> = {}) => ({
    id: ID, tenant_id: ORG, organization_id: ORG, platform: 'linkedin', action_type: 'dm',
    target_id: '2-SOMEONETHREADBBBBBB', suggested_text: 'hi', playbook_id: 'pb1',
    execution_mode: 'browser', ...over,
  });

  it.each(['failed', 'uncertain', 'executed', 'skipped', 'executing', 'pending'])(
    'deterministic id collides with a %s row → not executed, row unchanged',
    async (status) => {
      mockDb.tables.community_ai_actions.push({ id: ID, organization_id: ORG, status, execution_mode: 'browser', dispatch_lease_id: null });
      const r = await executeAction(act(), true, { source: 'bulk', persist: true, auto_insert: true, notify: false, webhook: false });
      expect(r).toMatchObject({ deduplicated: true, status, prior_action_id: ID });
      expect(actions()).toHaveLength(1);
      expect(actions()[0].status).toBe(status);
    },
  );

  it('a freshly inserted row is persisted compare-and-set from executing (reaped meanwhile → not revived)', async () => {
    const origFrom = mockDb.from;
    mockDb.from = (t: string) => {
      const q = origFrom(t);
      const origUpdate = q.update;
      q.update = (p: any) => {
        // The reaper moves the claimed row to uncertain just before the terminal write.
        const row = mockDb.tables.community_ai_actions.find((r) => r.id === ID);
        if (row && row.status === 'executing') row.status = 'uncertain';
        return origUpdate(p);
      };
      return q;
    };
    const r = await executeAction(act(), true, { source: 'bulk', persist: true, auto_insert: true, notify: false, webhook: false });
    mockDb.from = origFrom;
    expect(r.ok).toBe(false);
    expect(actions()[0].status).toBe('uncertain');
  });
});

// Browser-mode bulk REPLY (bulk DMs are refused before any row is written;
// see engagementRequestIdempotencyDurable.test.ts).
describe('D1 — bulk in-flight guard covers every possibly-delivered state', () => {
  beforeEach(() => {
    mockCapabilityMode = 'browser';
    mockDb.tables.engagement_messages[0].platform_message_id = '2-RECIPIENTTHREADAAAA';
  });

  it.each([
    ['pending', 'browser'],
    ['dispatched', 'browser'],
    ['acknowledged', 'browser'],
    ['executing', 'browser'],
    ['uncertain', 'browser'],
    ['uncertain', 'api'],
  ])('an existing %s (%s) row for the target blocks a new dispatch', async (status, mode) => {
    mockDb.tables.community_ai_actions.push({
      id: 'prior', organization_id: ORG, status, execution_mode: mode,
      platform: 'linkedin', action_type: 'reply', target_id: '2-RECIPIENTTHREADAAAA',
    });
    const r = await sendReply(ORG, 't1', 'm1', 'Hi', 'linkedin', true, 'user_1');
    expect(r.outcome).toBe('skipped_already_dispatched');
    expect(actions()).toHaveLength(1);
  });

  it('a terminal not-acted row (failed) does not block, and is never revived', async () => {
    mockDb.tables.community_ai_actions.push({
      id: 'prior', organization_id: ORG, status: 'failed', execution_mode: 'browser',
      platform: 'linkedin', action_type: 'reply', target_id: '2-RECIPIENTTHREADAAAA',
    });
    const r = await sendReply(ORG, 't1', 'm1', 'Hi', 'linkedin', true, 'user_1');
    expect(r.outcome).toBe('sent');
    expect(actions().find((a) => a.id === 'prior')!.status).toBe('failed');
    expect(actions().filter((a) => a.status === 'pending')).toHaveLength(1);
  });

  it('concurrent bulk sends to one target → exactly one claimable row', async () => {
    const out = await Promise.all([1, 2, 3].map(() => sendReply(ORG, 't1', 'm1', 'Hi', 'linkedin', true, 'user_1')));
    expect(out.filter((o: any) => o.outcome === 'sent')).toHaveLength(1);
    expect(actions().filter((a) => a.status === 'pending' && a.execution_mode === 'browser')).toHaveLength(1);
  });

  it('a second send in the same bucket after the first was reaped to uncertain → refused, not revived', async () => {
    await sendReply(ORG, 't1', 'm1', 'Hi', 'linkedin', true, 'user_1');
    actions()[0].status = 'uncertain';
    const r = await sendReply(ORG, 't1', 'm1', 'Hi', 'linkedin', true, 'user_1');
    expect(r.outcome).toBe('skipped_already_dispatched');
    expect(actions()).toHaveLength(1);
    expect(actions()[0].status).toBe('uncertain');
  });
});
