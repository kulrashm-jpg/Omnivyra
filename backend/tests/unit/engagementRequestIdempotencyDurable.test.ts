/**
 * Durable request-level idempotency for /api/engagement/reply and /like
 * (engagementRequestIdempotency + migration 20261231000008), and the DM send
 * policy on the reply / bulk / executor paths (dmDispatchSafety).
 *
 * Real executor (communityAiActionExecutorRuntime) + real routes on the
 * in-memory PostgREST fake; the platform connector is a counting fake. No
 * live actions. The assertion that matters everywhere: how many times did the
 * platform connector run, and what does the request record say?
 *
 * Responses use a Next-faithful double: res.json() returns undefined (never a
 * "handled" signal) and a second response on the same request throws.
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
const mockRpaTask = jest.fn();
jest.mock('../../services/rpaWorker/rpaWorkerService', () => ({ executeRpaTask: (...a: any[]) => mockRpaTask(...a), rpaResultMayHaveActed: () => true }));
const mockConnector = jest.fn();
jest.mock('../../services/platformConnectors/linkedinConnector', () => ({
  executeAction: (...a: any[]) => mockConnector(...a),
}));
jest.mock('../../services/platformConnectors/instagramConnector', () => ({
  executeAction: (...a: any[]) => mockConnector(...a),
}));
jest.mock('../../services/platformConnectors/twitterConnector', () => ({
  executeAction: (...a: any[]) => mockConnector(...a),
}));

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
jest.mock('../../services/responsePerformanceService', () => ({
  incrementReplyLike: async () => undefined,
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
const idem = require('../../services/engagementRequestIdempotency');
const { dmSendRefusal } = require('../../services/dmDispatchSafety');
/* eslint-enable @typescript-eslint/no-var-requires */

const ORG = '00000000-0000-0000-0000-00000000000a';
const OTHER_ORG = '00000000-0000-0000-0000-00000000000b';
const TABLE = 'engagement_request_idempotency';
const HOUR = 60 * 60 * 1000;

/** Next-faithful response double. */
function nextRes() {
  const res: any = { statusCode: 0, body: undefined, responses: 0 };
  res.status = (c: number) => {
    if (res.responses > 0) throw new Error('ERR_HTTP_HEADERS_SENT: status() after the response was sent');
    res.statusCode = c;
    return res;
  };
  res.json = (b: unknown) => {
    if (res.responses > 0) throw new Error('ERR_HTTP_HEADERS_SENT: a second response on one request');
    res.responses += 1;
    res.body = b;
    return undefined; // Next's res.json() returns void
  };
  res.setHeader = () => res;
  return res;
}

async function like(headers: Record<string, string> = {}, body: Record<string, unknown> = {}) {
  const res = nextRes();
  await likeHandler({ method: 'POST', headers, body: { organization_id: ORG, message_id: 'm1', platform: 'linkedin', ...body } }, res);
  expect(res.responses).toBe(1);
  return res;
}

async function reply(headers: Record<string, string> = {}, body: Record<string, unknown> = {}) {
  const res = nextRes();
  await replyHandler({ method: 'POST', headers, query: {}, body: { organization_id: ORG, message_id: 'm1', platform: 'linkedin', reply_text: 'Thanks!', ...body } }, res);
  expect(res.responses).toBe(1);
  return res;
}

function connectorOk() {
  mockConnector.mockImplementation(async () => {
    await new Promise((r) => setTimeout(r, 5));
    return { success: true, platform_id: 'urn:li:comment:ok' };
  });
}

const actions = () => mockDb.tables.community_ai_actions;
const records = () => mockDb.tables[TABLE] ?? [];

function seedDb() {
  mockDb = createFakeDb({
    community_ai_actions: [],
    community_ai_execution_metric_events: [],
    [TABLE]: [],
    engagement_messages: [
      {
        id: 'm1', organization_id: ORG, thread_id: 't1', platform_message_id: 'urn:li:comment:(urn:li:activity:1,2)',
        post_comment_id: null, platform: 'linkedin', message_type: 'comment', author_id: null, raw_payload: {},
      },
      {
        id: 'm2', organization_id: ORG, thread_id: 't1', platform_message_id: 'urn:li:comment:(urn:li:activity:1,3)',
        post_comment_id: null, platform: 'linkedin', message_type: 'comment', author_id: null, raw_payload: {},
      },
      {
        id: 'dm1', organization_id: ORG, thread_id: 'tdm', platform_message_id: 'dm-msg-1',
        post_comment_id: null, platform: 'linkedin', message_type: 'dm', author_id: null,
        raw_payload: { sender_name: 'Rajesh Singh', sender_profile_url: 'https://www.linkedin.com/in/rajesh' },
      },
    ],
    engagement_threads: [
      { id: 't1', organization_id: ORG, platform_thread_id: 'urn:li:activity:1', raw_payload: {} },
      {
        id: 'tdm', organization_id: ORG, platform: 'linkedin',
        platform_thread_id: 'https://www.linkedin.com/messaging/thread/2-MTc1MjQ5MzE5OTA1OGI0MjI1My0xMDA/',
        raw_payload: { participant_name: 'Rajesh Singh' },
      },
    ],
    engagement_authors: [],
    ai_message_drafts: [{ id: 'draft-dm', thread_id: 'tdm', platform: 'linkedin', status: 'draft' }],
    comment_likes: [], comment_replies: [],
  });
  mockDb.statusCheck.community_ai_actions = COMMUNITY_STATUS_VOCABULARY;
  mockDb.statusCheck[TABLE] = new Set(['reserved', 'completed', 'failed_not_acted', 'uncertain']);
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
}

let nowSpy: jest.SpyInstance | null = null;
function setNow(ms: number) {
  nowSpy?.mockRestore();
  nowSpy = jest.spyOn(Date, 'now').mockReturnValue(ms);
}

beforeEach(() => {
  seedDb();
  mockConnector.mockReset();
  mockRpaTask.mockReset();
  mockUserId = 'user_1';
  mockCapabilityMode = 'api';
  mockPolicy.execution_enabled = true;
  connectorOk();
});
afterEach(() => {
  nowSpy?.mockRestore();
  nowSpy = null;
});

// ─────────────────────────────────────────────────────────────────────────────
// Service level
// ─────────────────────────────────────────────────────────────────────────────
const ctx = (over: Record<string, any> = {}) => ({
  db: mockDb,
  organizationId: ORG,
  actorId: 'user_1',
  scope: 'like' as const,
  clientKey: 'key-00000001',
  fingerprint: 'a'.repeat(64),
  platform: 'linkedin',
  actionType: 'like',
  targetId: 'urn:li:comment:1',
  ...over,
});

describe('reservation — atomic, exactly one concurrent caller proceeds', () => {
  it('10 concurrent reservations of one key → 1 proceed, 9 × 409 REQUEST_IN_PROGRESS', async () => {
    const out = await Promise.all(Array.from({ length: 10 }, () => idem.reserveEngagementRequest(ctx({ db: mockDb }))));
    expect(out.filter((o: any) => o.kind === 'proceed')).toHaveLength(1);
    const answers = out.filter((o: any) => o.kind === 'answer');
    expect(answers).toHaveLength(9);
    for (const a of answers) expect(a.answer).toMatchObject({ status: 409, body: { code: 'REQUEST_IN_PROGRESS' } });
    expect(records()).toHaveLength(1);
    expect(records()[0]).toMatchObject({ state: 'reserved', attempt: 1, organization_id: ORG, key_source: 'client' });
  });

  it('a non-unique DB error fails CLOSED (503, nothing proceeds)', async () => {
    const db = { from: (t: string) => (t === TABLE ? { insert: async () => ({ error: { code: '42P01', message: 'relation does not exist' } }) } : mockDb.from(t)) };
    const out = await idem.reserveEngagementRequest(ctx({ db }));
    expect(out.kind).toBe('answer');
    expect(out.answer).toMatchObject({ status: 503, body: { code: 'IDEMPOTENCY_UNAVAILABLE' } });
  });

  it('same key + same fingerprint after completion → replay; different fingerprint → 422 (never proceeds)', async () => {
    const first = await idem.reserveEngagementRequest(ctx({ db: mockDb }));
    await idem.finalizeEngagementRequest(mockDb, first.record, { state: 'completed', outcomeStatus: 'executed', error: null });
    const replay = await idem.reserveEngagementRequest(ctx({ db: mockDb }));
    expect(replay).toMatchObject({ kind: 'answer', answer: { status: 200, body: { replayed: true, prior_status: 'executed' } } });
    const mismatch = await idem.reserveEngagementRequest(ctx({ db: mockDb, fingerprint: 'b'.repeat(64) }));
    expect(mismatch).toMatchObject({ kind: 'answer', answer: { status: 422, body: { code: 'IDEMPOTENCY_KEY_REUSED' } } });
  });

  it('failed_not_acted → same-key retry reserves attempt 2 with a NEW action id; concurrent retries → one winner (CAS)', async () => {
    const first = await idem.reserveEngagementRequest(ctx({ db: mockDb }));
    await idem.finalizeEngagementRequest(mockDb, first.record, { state: 'failed_not_acted', outcomeStatus: 'skipped', error: 'PLATFORM_POLICY' });
    const retries = await Promise.all([1, 2, 3, 4].map(() => idem.reserveEngagementRequest(ctx({ db: mockDb }))));
    const won = retries.filter((r: any) => r.kind === 'proceed');
    expect(won).toHaveLength(1);
    expect(won[0].attempt).toBe(2);
    expect(won[0].actionId).not.toBe(first.actionId);
    expect(won[0].actionId).toBe(idem.actionIdForAttempt(first.record.id, 2));
    // A failed_not_acted record does NOT admit a different payload under the key.
    await idem.finalizeEngagementRequest(mockDb, won[0].record, { state: 'failed_not_acted', outcomeStatus: 'failed', error: 'x' });
    const other = await idem.reserveEngagementRequest(ctx({ db: mockDb, fingerprint: 'c'.repeat(64) }));
    expect(other.answer.status).toBe(422);
  });

  it('uncertain → 409 needs_review, at ANY age (never expires into a resend)', async () => {
    const t0 = Date.now();
    const first = await idem.reserveEngagementRequest(ctx({ db: mockDb, nowMs: t0 }));
    await idem.finalizeEngagementRequest(mockDb, first.record, { state: 'uncertain', outcomeStatus: 'uncertain', error: 'TIMEOUT' }, t0);
    for (const later of [t0 + 1000, t0 + 25 * HOUR, t0 + 400 * 24 * HOUR]) {
      const r = await idem.reserveEngagementRequest(ctx({ db: mockDb, nowMs: later }));
      expect(r).toMatchObject({ kind: 'answer', answer: { status: 409, body: { code: 'OUTCOME_UNCERTAIN', review_status: 'needs_review' } } });
    }
    expect(records()[0].state).toBe('uncertain');
  });

  it('expiry: a completed record past its replay window is a NEW request (deliberate repeat), even with another payload', async () => {
    const t0 = Date.now();
    const first = await idem.reserveEngagementRequest(ctx({ db: mockDb, nowMs: t0 }));
    await idem.finalizeEngagementRequest(mockDb, first.record, { state: 'completed', outcomeStatus: 'executed', error: null }, t0);
    const inside = await idem.reserveEngagementRequest(ctx({ db: mockDb, nowMs: t0 + 23 * HOUR }));
    expect(inside.kind).toBe('answer');
    const after = await idem.reserveEngagementRequest(ctx({ db: mockDb, nowMs: t0 + 24 * HOUR + 1, fingerprint: 'd'.repeat(64) }));
    expect(after.kind).toBe('proceed');
    expect(after.attempt).toBe(2);
    expect(records()[0].request_fingerprint).toBe('d'.repeat(64));
  });
});

describe('stale reservations — released ONLY when provably not acted', () => {
  async function staleReserved(t0: number) {
    const r = await idem.reserveEngagementRequest(ctx({ db: mockDb, nowMs: t0 }));
    expect(r.kind).toBe('proceed');
    return r;
  }

  it('fresh reserved (not stale) → 409, no fence, nothing released', async () => {
    const t0 = Date.now();
    await staleReserved(t0);
    const r = await idem.reserveEngagementRequest(ctx({ db: mockDb, nowMs: t0 + idem.ENGAGEMENT_REQUEST_STALE_MS - 1 }));
    expect(r.answer.status).toBe(409);
    expect(actions()).toHaveLength(0);
  });

  it('no action row → a FENCE row is inserted under the planned id → failed_not_acted → retry proceeds; a late executeAction for the abandoned attempt cannot act', async () => {
    const t0 = Date.now();
    const first = await staleReserved(t0);
    const retry = await idem.reserveEngagementRequest(ctx({ db: mockDb, nowMs: t0 + idem.ENGAGEMENT_REQUEST_STALE_MS + 1 }));
    expect(retry.kind).toBe('proceed');
    expect(retry.attempt).toBe(2);
    const fence = actions().find((a) => a.id === first.actionId)!;
    expect(fence).toMatchObject({ status: 'skipped', skip_reason: idem.FENCE_REASON, organization_id: ORG });
    expect(fence.execution_correlation_id).toBeTruthy();

    // The crashed caller wakes up and calls executeAction for attempt 1.
    const late = await executeAction(
      { id: first.actionId, tenant_id: ORG, organization_id: ORG, platform: 'linkedin', action_type: 'like', target_id: 'urn:li:comment:1', suggested_text: null, playbook_id: null, execution_mode: 'api' },
      true,
      { source: 'manual', persist: true, auto_insert: true, notify: false, webhook: false },
    );
    expect(late).toMatchObject({ deduplicated: true, status: 'skipped' });
    expect(mockConnector).not.toHaveBeenCalled();
    // ...and its finalize cannot overwrite the takeover (compare-and-set on attempt).
    const fin = await idem.finalizeEngagementRequest(mockDb, first.record, idem.classifyExecutionOutcome(late));
    expect(fin.ok).toBe(false);
    expect(records()[0]).toMatchObject({ state: 'reserved', attempt: 2 });
  });

  it.each([
    ['executing', 'uncertain', 409],
    ['failed', 'uncertain', 409],
    ['uncertain', 'uncertain', 409],
    ['executed', 'completed', 200],
    ['pending', 'completed', 202],
  ])('an action row in %s → request %s (never released)', async (actionStatus, expectedState, httpStatus) => {
    const t0 = Date.now();
    const first = await staleReserved(t0);
    actions().push({ id: first.actionId, organization_id: ORG, status: actionStatus });
    const r = await idem.reserveEngagementRequest(ctx({ db: mockDb, nowMs: t0 + idem.ENGAGEMENT_REQUEST_STALE_MS + 1 }));
    expect(r.kind).toBe('answer');
    expect(r.answer.status).toBe(httpStatus);
    expect(records()[0].state).toBe(expectedState);
    expect(actions()).toHaveLength(1);
  });

  it('bulk reconcile is bounded and leaves fresh reservations alone', async () => {
    const t0 = Date.now();
    for (let i = 0; i < 5; i += 1) await idem.reserveEngagementRequest(ctx({ db: mockDb, nowMs: t0, clientKey: `key-stale-000${i}` }));
    await idem.reserveEngagementRequest(ctx({ db: mockDb, nowMs: t0 + idem.ENGAGEMENT_REQUEST_STALE_MS, clientKey: 'key-fresh-0001' }));
    const out = await idem.reconcileStaleEngagementRequests(mockDb, { limit: 3, nowMs: t0 + idem.ENGAGEMENT_REQUEST_STALE_MS + 1 });
    expect(out).toEqual({ examined: 3, reconciled: 3 });
    expect(records().filter((r) => r.state === 'failed_not_acted')).toHaveLength(3);
    expect(records().find((r) => r.idempotency_key === 'key-fresh-0001').state).toBe('reserved');
  });
});

describe('lifecycle cleanup — bounded, tenant-scoped, never reserved/uncertain', () => {
  it('deletes only completed / failed_not_acted records expired longer than the grace period', async () => {
    const now = Date.now();
    const old = new Date(now - idem.ENGAGEMENT_REQUEST_PURGE_GRACE_MS - 1).toISOString();
    const recent = new Date(now - 1000).toISOString();
    const row = (id: string, state: string, expires_at: string, organization_id = ORG) => ({ id, organization_id, state, expires_at });
    mockDb.tables[TABLE].push(
      row('c-old', 'completed', old), row('f-old', 'failed_not_acted', old), row('c-recent', 'completed', recent),
      row('r-old', 'reserved', old), row('u-old', 'uncertain', old), row('x-old', 'completed', old, OTHER_ORG),
    );
    const out = await idem.purgeExpiredEngagementRequests(mockDb, { organizationId: ORG, nowMs: now });
    expect(out.deleted).toBe(2);
    expect(records().map((r) => r.id).sort()).toEqual(['c-recent', 'r-old', 'u-old', 'x-old']);
  });

  it('respects the limit', async () => {
    const old = new Date(Date.now() - idem.ENGAGEMENT_REQUEST_PURGE_GRACE_MS - 1).toISOString();
    for (let i = 0; i < 7; i += 1) mockDb.tables[TABLE].push({ id: `c${i}`, organization_id: ORG, state: 'completed', expires_at: old });
    expect((await idem.purgeExpiredEngagementRequests(mockDb, { limit: 5 })).deleted).toBe(5);
    expect(records()).toHaveLength(2);
  });
});

describe('outcome classification — only provably-not-acted is released', () => {
  it.each([
    [{ ok: true, status: 'executed' }, 'completed'],
    [{ ok: true, status: 'sent_unverified' }, 'completed'],
    [{ ok: true, status: 'dispatched' }, 'completed'],
    [{ ok: false, status: 'deferred', may_have_acted: false }, 'completed'],
    [{ ok: false, status: 'failed', may_have_acted: false }, 'failed_not_acted'],
    [{ ok: false, status: 'skipped', may_have_acted: false }, 'failed_not_acted'],
    [{ ok: false, status: 'blocked', may_have_acted: false }, 'failed_not_acted'],
    [{ ok: false, status: 'failed' }, 'uncertain'],
    [{ ok: false, status: 'failed', may_have_acted: true }, 'uncertain'],
    [{ ok: false, status: 'skipped' }, 'uncertain'],
    [{ ok: false, status: 'uncertain', may_have_acted: false }, 'uncertain'],
    [{ ok: false, status: 'failed', may_have_acted: false, deduplicated: true }, 'uncertain'],
    [{ ok: true, status: 'executed', deduplicated: true }, 'completed'],
    [{}, 'uncertain'],
  ])('%j → %s', (result, state) => {
    expect(idem.classifyExecutionOutcome(result).state).toBe(state);
  });

  it('a throw is uncertain unless it is the pre-execution auto-insert failure', () => {
    expect(idem.classifyExecutionOutcome(undefined, new Error('socket hang up')).state).toBe('uncertain');
    expect(idem.classifyExecutionOutcome(undefined, new Error('community_ai_action_auto_insert_failed:boom')).state).toBe('failed_not_acted');
  });
});

describe('tenant isolation', () => {
  it('the same client key in two organizations is two independent requests', async () => {
    const a = await idem.reserveEngagementRequest(ctx({ db: mockDb }));
    const b = await idem.reserveEngagementRequest(ctx({ db: mockDb, organizationId: OTHER_ORG }));
    expect(a.kind).toBe('proceed');
    expect(b.kind).toBe('proceed');
    expect(a.record.id).not.toBe(b.record.id);
  });

  it('a record is only ever read through its own organization (a cross-tenant id collision fails closed, nothing sent)', async () => {
    const id = idem.requestRecordId({ organizationId: OTHER_ORG, actorId: 'user_1', scope: 'like', key: 'key-00000001' });
    mockDb.tables[TABLE].push({ id, organization_id: ORG, state: 'completed', request_fingerprint: 'a'.repeat(64), expires_at: new Date(Date.now() + HOUR).toISOString() });
    expect(await idem.inspectEngagementRequest(ctx({ db: mockDb, organizationId: OTHER_ORG }))).toBeNull();
    const r = await idem.reserveEngagementRequest(ctx({ db: mockDb, organizationId: OTHER_ORG }));
    expect(r).toMatchObject({ kind: 'answer', answer: { status: 503 } });
  });

  it('route: another user replaying the same key does not see the first user\'s outcome', async () => {
    await like({ 'idempotency-key': 'like-key-0009' });
    mockUserId = 'user_2';
    const r = await like({ 'idempotency-key': 'like-key-0009' });
    expect(r.body.replayed).toBeUndefined();
    expect(mockConnector).toHaveBeenCalledTimes(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Routes (real executor)
// ─────────────────────────────────────────────────────────────────────────────
describe('routes — durable replay, conflicts, ambiguity, not-acted retry', () => {
  it('like: same key twice → ONE platform call; the replay carries the recorded outcome', async () => {
    const a = await like({ 'idempotency-key': 'like-key-0001' });
    const b = await like({ 'idempotency-key': 'like-key-0001' });
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(b.body).toMatchObject({ replayed: true, prior_status: 'executed', request_state: 'completed' });
    expect(mockConnector).toHaveBeenCalledTimes(1);
    expect(records()).toHaveLength(1);
    expect(records()[0]).toMatchObject({ state: 'completed', attempt: 1, outcome_status: 'executed', scope: 'like' });
  });

  it('like: the replay is answered BEFORE any gate (the message has since disappeared → still the recorded 200, not 404)', async () => {
    await like({ 'idempotency-key': 'like-key-0007' });
    mockDb.tables.engagement_messages = mockDb.tables.engagement_messages.filter((m) => m.id !== 'm1');
    const r = await like({ 'idempotency-key': 'like-key-0007' });
    expect(r.statusCode).toBe(200);
    expect(r.body.replayed).toBe(true);
    expect(mockConnector).toHaveBeenCalledTimes(1);
  });

  it('reply: an AI-draft replay is answered BEFORE the draft gate (draft already sent → replay, not AI_DRAFT_TERMINAL)', async () => {
    mockDb.tables.ai_message_drafts.push({ id: 'draft-c', thread_id: 't1', platform: 'linkedin', status: 'draft' });
    const body = { thread_id: 't1', ai_generated: true, ai_draft_id: 'draft-c' };
    const a = await reply({}, body);
    expect(a.statusCode).toBe(200);
    expect(mockDb.tables.ai_message_drafts.find((d) => d.id === 'draft-c').status).toBe('sent');
    const b = await reply({}, body);
    expect(b.statusCode).toBe(200);
    expect(b.body.replayed).toBe(true);
    expect(mockConnector).toHaveBeenCalledTimes(1);
  });

  it('like: key reused for a DIFFERENT message → 422, nothing sent', async () => {
    await like({ 'idempotency-key': 'like-key-0002' });
    const r = await like({ 'idempotency-key': 'like-key-0002' }, { message_id: 'm2' });
    expect(r.statusCode).toBe(422);
    expect(r.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(mockConnector).toHaveBeenCalledTimes(1);
  });

  it('reply: key reused with different TEXT → 422, nothing sent', async () => {
    await reply({ 'idempotency-key': 'reply-key-0001' }, { reply_text: 'First' });
    const r = await reply({ 'idempotency-key': 'reply-key-0001' }, { reply_text: 'Second' });
    expect(r.statusCode).toBe(422);
    expect(mockConnector).toHaveBeenCalledTimes(1);
  });

  it('reply: concurrent identical requests (no key) → ONE platform call, one action row', async () => {
    const out = await Promise.all([reply(), reply(), reply(), reply()]);
    expect(mockConnector).toHaveBeenCalledTimes(1);
    expect(actions()).toHaveLength(1);
    expect(out.filter((r) => r.statusCode === 200 && !r.body.replayed)).toHaveLength(1);
  });

  it('reply: NO key, two requests either side of the OLD 5-minute bucket boundary → ONE action', async () => {
    const boundary = Math.ceil(Date.now() / (5 * 60 * 1000)) * (5 * 60 * 1000) + 5 * 60 * 1000;
    setNow(boundary - 1);
    const a = await reply();
    setNow(boundary + 1);
    const b = await reply();
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(b.body.replayed).toBe(true);
    expect(mockConnector).toHaveBeenCalledTimes(1);
    expect(actions()).toHaveLength(1);
  });

  it('reply: NO key, straddling requests in flight concurrently → ONE action', async () => {
    const boundary = Math.ceil(Date.now() / (5 * 60 * 1000)) * (5 * 60 * 1000) + 10 * 60 * 1000;
    setNow(boundary - 1);
    const p1 = reply();
    setNow(boundary + 1);
    const p2 = reply();
    await Promise.all([p1, p2]);
    expect(mockConnector).toHaveBeenCalledTimes(1);
    expect(actions()).toHaveLength(1);
  });

  it('ambiguous delivery → uncertain; the same key is NEVER resent; a no-key repeat a day later is still refused; only a NEW key sends', async () => {
    const t0 = Date.now();
    setNow(t0);
    mockConnector.mockRejectedValue(new Error('socket hang up'));
    const first = await reply({ 'idempotency-key': 'reply-key-0002' });
    expect(first.statusCode).toBe(502);
    expect(first.body).toMatchObject({ request_state: 'uncertain', retry_with_same_key: false });
    connectorOk();
    const again = await reply({ 'idempotency-key': 'reply-key-0002' });
    expect(again.statusCode).toBe(409);
    expect(again.body).toMatchObject({ code: 'OUTCOME_UNCERTAIN', review_status: 'needs_review' });
    expect(mockConnector).toHaveBeenCalledTimes(1);

    // Same payload, no key, uncertain → refused at any age.
    mockConnector.mockRejectedValueOnce(new Error('ETIMEDOUT'));
    await reply({}, { reply_text: 'Unclear' });
    setNow(t0 + 30 * HOUR);
    const later = await reply({}, { reply_text: 'Unclear' });
    expect(later.statusCode).toBe(409);
    expect(later.body.code).toBe('OUTCOME_UNCERTAIN');
    expect(mockConnector).toHaveBeenCalledTimes(2);

    // Deliberate new intent: a new key.
    const fresh = await reply({ 'idempotency-key': 'reply-key-0003' }, { reply_text: 'Unclear' });
    expect(fresh.statusCode).toBe(200);
    expect(mockConnector).toHaveBeenCalledTimes(3);
  });

  it('provably-not-acted failure → retry with the SAME key re-runs every gate; it sends only once the gate passes', async () => {
    mockPolicy.execution_enabled = false; // platform kill switch
    const first = await like({ 'idempotency-key': 'like-key-0003' });
    expect(first.statusCode).toBe(502);
    expect(first.body).toMatchObject({ request_state: 'failed_not_acted', retry_with_same_key: true });
    expect(records()[0]).toMatchObject({ state: 'failed_not_acted', attempt: 1 });

    const stillBlocked = await like({ 'idempotency-key': 'like-key-0003' });
    expect(stillBlocked.statusCode).toBe(502); // the kill switch is re-checked on the retry
    expect(records()[0]).toMatchObject({ state: 'failed_not_acted', attempt: 2 });
    expect(mockConnector).not.toHaveBeenCalled();

    mockPolicy.execution_enabled = true;
    const ok = await like({ 'idempotency-key': 'like-key-0003' });
    expect(ok.statusCode).toBe(200);
    expect(mockConnector).toHaveBeenCalledTimes(1);
    expect(records()[0]).toMatchObject({ state: 'completed', attempt: 3 });
    expect(actions().map((a) => a.status).sort()).toEqual(['executed', 'skipped', 'skipped']);
    // ...and from now on it is a replay.
    const replay = await like({ 'idempotency-key': 'like-key-0003' });
    expect(replay.body.replayed).toBe(true);
    expect(mockConnector).toHaveBeenCalledTimes(1);
  });

  it('connector failure WITHOUT a not-acted flag → uncertain; the retry is refused (409), never resent', async () => {
    mockConnector.mockResolvedValueOnce({ success: false, error: 'HTTP 500' });
    const first = await like({ 'idempotency-key': 'like-key-0004' });
    expect(first.statusCode).toBe(502);
    expect(records()[0].state).toBe('uncertain');
    const second = await like({ 'idempotency-key': 'like-key-0004' });
    expect(second.statusCode).toBe(409);
    expect(second.body.code).toBe('OUTCOME_UNCERTAIN');
    expect(mockConnector).toHaveBeenCalledTimes(1);
  });

  it('connector failure explicitly NOT acted → the executor single API→browser fallback queues it → completed; the retry replays the queued action, no second row', async () => {
    mockConnector.mockResolvedValueOnce({ success: false, error: 'TOKEN_EXPIRED', may_have_acted: false });
    const first = await like({ 'idempotency-key': 'like-key-0006' });
    expect(records()[0]).toMatchObject({ state: 'completed', outcome_status: 'dispatched' });
    expect(first.statusCode).toBe(502); // the like route reports only 'executed' as success (unchanged)
    const second = await like({ 'idempotency-key': 'like-key-0006' });
    expect(second.statusCode).toBe(202);
    expect(second.body).toMatchObject({ replayed: true, status: 'queued' });
    expect(actions()).toHaveLength(1);
    expect(mockConnector).toHaveBeenCalledTimes(1);
  });

  it('executeAction throwing before acting (auto-insert failure) → failed_not_acted; the same key may retry', async () => {
    const origFrom = mockDb.from;
    let failOnce = true;
    mockDb.from = (t: string) => {
      const q = origFrom(t);
      if (t === 'community_ai_actions' && failOnce) {
        const origInsert = q.insert;
        q.insert = (row: any) => {
          if (failOnce) { failOnce = false; return { then: (res: any) => Promise.resolve({ data: null, error: { code: '08006', message: 'connection lost' } }).then(res) }; }
          return origInsert(row);
        };
      }
      return q;
    };
    const first = await like({ 'idempotency-key': 'like-key-0005' });
    expect(first.statusCode).toBe(500);
    expect(records()[0].state).toBe('failed_not_acted');
    expect(mockConnector).not.toHaveBeenCalled();
    const retry = await like({ 'idempotency-key': 'like-key-0005' });
    expect(retry.statusCode).toBe(200);
    expect(mockConnector).toHaveBeenCalledTimes(1);
  });

  it('a deliberate repeat of the same reply AFTER the 24 h window (no key) is a new send; inside it is a replay', async () => {
    const t0 = Date.now();
    setNow(t0);
    await reply();
    setNow(t0 + 23 * HOUR);
    expect((await reply()).body.replayed).toBe(true);
    setNow(t0 + 48 * HOUR);
    const later = await reply();
    expect(later.statusCode).toBe(200);
    expect(later.body.replayed).toBeUndefined();
    expect(mockConnector).toHaveBeenCalledTimes(2);
  });

  it('browser-mode reply: the replay of a queued action is 202 queued, never a second claimable row', async () => {
    mockCapabilityMode = 'browser';
    const a = await reply({ 'idempotency-key': 'reply-key-0004' });
    const b = await reply({ 'idempotency-key': 'reply-key-0004' });
    expect(a.statusCode).toBe(202);
    expect(b.statusCode).toBe(202);
    expect(b.body).toMatchObject({ replayed: true, status: 'queued' });
    expect(actions().filter((r) => r.status === 'pending' && r.execution_mode === 'browser')).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DM send policy — every path
// ─────────────────────────────────────────────────────────────────────────────
describe('DM recipient safety — DMs are refused on every path (no authoritative mapping)', () => {
  it.each(['linkedin', 'twitter', 'facebook'])('reply route: a %s DM → 409 DM_RECIPIENT_MAPPING_UNAVAILABLE; no reservation, no action, no draft approval', async (platform) => {
    mockCapabilityMode = 'browser';
    mockDb.tables.engagement_messages.find((m) => m.id === 'dm1').platform = platform;
    const r = await reply({}, { message_id: 'dm1', platform, ai_generated: true, ai_draft_id: 'draft-dm' });
    expect(r.statusCode).toBe(409);
    expect(r.body.code).toBe('DM_RECIPIENT_MAPPING_UNAVAILABLE');
    expect(actions()).toHaveLength(0);
    expect(records()).toHaveLength(0);
    expect(mockDb.tables.ai_message_drafts[0].status).toBe('draft');
    expect(mockConnector).not.toHaveBeenCalled();
  });

  it('reply route: an Instagram DM → 409 INSTAGRAM_DM_ACCOUNT_TIER_UNVERIFIED (a client-declared tier is not an input)', async () => {
    mockCapabilityMode = 'browser';
    mockDb.tables.engagement_messages.find((m) => m.id === 'dm1').platform = 'instagram';
    const r = await reply({}, { message_id: 'dm1', platform: 'instagram', account_tier: 'business', metadata: { account_tier: 'business' } });
    expect(r.statusCode).toBe(409);
    expect(r.body.code).toBe('INSTAGRAM_DM_ACCOUNT_TIER_UNVERIFIED');
    expect(actions()).toHaveLength(0);
  });

  it('a direct_message type is a DM too', async () => {
    mockDb.tables.engagement_messages.find((m) => m.id === 'dm1').message_type = 'direct_message';
    const r = await reply({}, { message_id: 'dm1' });
    expect(r.statusCode).toBe(409);
    expect(actions()).toHaveLength(0);
  });

  it('bulk: a DM is refused before any action row exists', async () => {
    mockCapabilityMode = 'browser';
    const r = await sendReply(ORG, 'tdm', 'dm1', 'Hi', 'linkedin', true, 'user_1');
    expect(r).toMatchObject({ ok: false, outcome: 'skipped_capability' });
    expect(actions()).toHaveLength(0);
  });

  const dmAction = (over: Record<string, any> = {}) => ({
    id: '00000000-0000-0000-0000-0000000000e1', tenant_id: ORG, organization_id: ORG, platform: 'linkedin', action_type: 'dm',
    target_id: 'https://www.linkedin.com/messaging/thread/2-MTc1MjQ5MzE5OTA1OGI0MjI1My0xMDA/',
    suggested_text: 'hi', playbook_id: 'pb1', execution_mode: 'browser', ...over,
  });

  it.each([
    ['browser, validated thread URL', {}, 'DM_RECIPIENT_MAPPING_UNAVAILABLE'],
    ['browser, dm_thread_ready participant', { target_id: 'Rajesh', metadata: { dm_thread_ready: true, dm_participant_name: 'Rajesh' } }, 'DM_RECIPIENT_MAPPING_UNAVAILABLE'],
    ['browser, handle (twitter)', { platform: 'twitter', target_id: 'someone' }, 'DM_RECIPIENT_MAPPING_UNAVAILABLE'],
    ['browser, foreign-host thread URL (shape refusal first)', { target_id: 'https://evil.example/linkedin.com/messaging/thread/x/', metadata: { dm_thread_ready: true, dm_thread_url: 'https://evil.example/messaging/thread/x/' } }, 'DM_THREAD_URL_INVALID'],
    ['browser, no text (used to fall through to a bare DM)', { suggested_text: '' }, null],
    ['api mode (no API→browser fallback either)', { execution_mode: 'api' }, 'DM_RECIPIENT_MAPPING_UNAVAILABLE'],
    ['rpa mode', { execution_mode: 'rpa' }, 'DM_RECIPIENT_MAPPING_UNAVAILABLE'],
    ['direct_message type (rejected by validation)', { action_type: 'direct_message' }, null],
  ])('executor (%s) → refused, not acted, nothing dispatched', async (_l, over, code) => {
    const r = await executeAction(dmAction(over), true, { source: 'manual', persist: true, auto_insert: true, notify: false, webhook: false });
    expect(r.ok).toBe(false);
    expect(r.may_have_acted).toBe(false);
    if (code) expect(r.error).toBe(code);
    expect(mockConnector).not.toHaveBeenCalled();
    expect(mockRpaTask).not.toHaveBeenCalled();
    const row = actions().find((a) => a.id === '00000000-0000-0000-0000-0000000000e1');
    expect(row?.status).not.toBe('pending'); // never claimable by the extension
    expect(row?.command_chain ?? null).toBeNull();
  });

  it('executor: an Instagram DM is refused with the tier reason', async () => {
    const r = await executeAction(dmAction({ platform: 'instagram', target_id: 'https://www.instagram.com/direct/t/123456/' }), true, { source: 'manual', notify: false, webhook: false });
    expect(r).toMatchObject({ ok: false, error: 'INSTAGRAM_DM_ACCOUNT_TIER_UNVERIFIED', may_have_acted: false });
  });

  it('policy: Instagram needs a verified business tier first; every platform then needs the (absent) mapping', () => {
    expect(dmSendRefusal({ platform: 'instagram', verifiedInstagramTier: null })).toBe('INSTAGRAM_DM_ACCOUNT_TIER_UNVERIFIED');
    expect(dmSendRefusal({ platform: 'instagram', verifiedInstagramTier: 'creator' })).toBe('INSTAGRAM_DM_ACCOUNT_TIER_UNVERIFIED');
    expect(dmSendRefusal({ platform: 'instagram', verifiedInstagramTier: 'business' })).toBe('DM_RECIPIENT_MAPPING_UNAVAILABLE');
    expect(dmSendRefusal({ platform: 'linkedin' })).toBe('DM_RECIPIENT_MAPPING_UNAVAILABLE');
  });

  it('non-DM actions are untouched by the DM policy', async () => {
    const r = await executeAction(dmAction({ action_type: 'reply', execution_mode: 'api', target_id: 'urn:li:activity:1' }), true, { source: 'manual', notify: false, webhook: false });
    expect(r.status).toBe('executed');
    expect(mockConnector).toHaveBeenCalledTimes(1);
  });
});
