/**
 * Closure-004 — thread re-scheduling: tenant isolation and thread identity.
 *
 * Drives the REAL activity-workspace schedule route (thread branch, enforce
 * mode), the REAL re-schedule service, the REAL thread orchestrator and publish
 * worker, and the REAL reconciliation service over one in-memory,
 * Postgres-shaped store. The two thread RPCs are modelled on their SQL bodies
 * (supabase/migrations/20260809_thread_per_node_attachments.sql):
 * `replace_thread_children` deletes EVERY child of the root and inserts fresh
 * 'draft' children; `insert_thread_atomic` creates root + drafts.
 *
 * Every platform call is counted per node, so each test shows whether a
 * re-schedule could make the platform see a node twice.
 */
export {};

type Row = Record<string, unknown>;

const OWNER = '00000000-0000-4000-8000-0000000000a1';
const OTHER = '00000000-0000-4000-8000-0000000000a2';
const COMPANY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CAMPAIGN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const FOREIGN_CAMPAIGN = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const store: Record<string, Row[]> = {};
let authUser: string | null = OWNER;

type Filters = { eq: Row; in: Record<string, unknown[]>; is: Row; lt: Row; contains: Record<string, Row> };

let writeLock: Promise<unknown> = Promise.resolve();
function serialised<T>(fn: () => T): Promise<T> {
  const next = writeLock.then(fn, fn);
  writeLock = next.catch(() => undefined);
  return next;
}

function rowMatches(row: Row, f: Filters): boolean {
  for (const [k, v] of Object.entries(f.eq)) if (row[k] !== v) return false;
  for (const [k, vals] of Object.entries(f.in)) if (!vals.includes(row[k])) return false;
  for (const [k, v] of Object.entries(f.is)) if ((row[k] ?? null) !== v) return false;
  for (const [k, v] of Object.entries(f.lt)) if (row[k] == null || String(row[k]) >= String(v)) return false;
  for (const [k, criteria] of Object.entries(f.contains)) {
    const col = row[k];
    if (col == null || typeof col !== 'object') return false;
    if (!Object.entries(criteria).every(([ck, cv]) => (col as Row)[ck] === cv)) return false;
  }
  return true;
}

/** Runs inside the serialised write of EVERY scheduled_posts update, before its predicate (cleared per test). */
let beforePostUpdate: ((payload: Row, f: Filters) => void) | null = null;
let idSeq = 0;

function buildChain(table: string) {
  if (!store[table]) store[table] = [];
  const f: Filters = { eq: {}, in: {}, is: {}, lt: {}, contains: {} };
  let updatePayload: Row | null = null;
  let insertRows: Row[] | null = null;
  let orderBy: string | null = null;
  let descending = false;
  let limitN: number | null = null;

  const settle = () => serialised(() => {
    const rows = store[table];
    if (insertRows) {
      const created = insertRows.map((r) => ({
        id: r.id ?? `${table}-${++idSeq}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...r,
      }));
      rows.push(...created);
      return { data: created, error: null };
    }
    if (updatePayload && table === 'scheduled_posts' && beforePostUpdate) beforePostUpdate(updatePayload, f);
    let hit = rows.filter((r) => rowMatches(r, f));
    if (orderBy) {
      const key = orderBy;
      hit = [...hit].sort((a, b) => (String(a[key] ?? '') < String(b[key] ?? '') ? -1 : 1) * (descending ? -1 : 1));
    }
    if (limitN !== null) hit = hit.slice(0, limitN);
    if (updatePayload) {
      const payload = updatePayload;
      hit.forEach((r) => Object.assign(r, payload));
    }
    return { data: hit.map((r) => ({ ...r })), error: null };
  });

  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: () => chain,
    insert: (r: Row | Row[]) => { insertRows = Array.isArray(r) ? r : [r]; return chain; },
    update: (p: Row) => { updatePayload = p; return chain; },
    eq: (k: string, v: unknown) => { f.eq[k] = v; return chain; },
    in: (k: string, v: unknown[]) => { f.in[k] = v; return chain; },
    is: (k: string, v: unknown) => { f.is[k] = v; return chain; },
    lt: (k: string, v: unknown) => { f.lt[k] = v; return chain; },
    lte: () => chain,
    contains: (k: string, v: Row) => { f.contains[k] = v; return chain; },
    order: (k: string, o?: { ascending?: boolean }) => { orderBy = k; descending = o?.ascending === false; return chain; },
    limit: (n: number) => { limitN = n; return chain; },
    single: async () => {
      const r = await settle();
      const list = r.data as Row[];
      return list[0] ? { data: list[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
    },
    maybeSingle: async () => {
      const r = await settle();
      return { data: (r.data as Row[])[0] ?? null, error: null };
    },
    then: <A, B = never>(ok: (r: { data: unknown; error: null }) => A, err?: (e: unknown) => B) => settle().then(ok, err),
  });
  return chain;
}

const rpcCalls: string[] = [];
async function rpc(name: string, args: Row) {
  rpcCalls.push(name);
  return serialised(() => {
    const posts = store.scheduled_posts;
    const childRow = (root: Row, node: Row): Row => ({
      id: `node-${++idSeq}`, user_id: root.user_id, social_account_id: root.social_account_id, campaign_id: root.campaign_id,
      platform: root.platform, content_type: root.content_type, content: node.content, media_urls: [],
      scheduled_for: root.scheduled_for, status: 'draft', parent_post_id: root.id, thread_position: node.position,
      is_thread_start: false, platform_post_id: null, error_code: null, error_message: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    if (name === 'replace_thread_children') {
      const root = posts.find((r) => r.id === args.p_root_id && r.is_thread_start === true);
      if (!root) return { data: null, error: { code: 'P0001', message: 'thread_root_not_found' } };
      // DELETE FROM scheduled_posts WHERE parent_post_id = p_root_id — every child.
      store.scheduled_posts = posts.filter((r) => r.parent_post_id !== root.id);
      const created = (args.p_children as Row[]).map((n) => childRow(root, n));
      store.scheduled_posts.push(...created);
      return { data: { root_id: root.id, node_ids: created.map((c) => c.id) }, error: null };
    }
    if (name === 'insert_thread_atomic') {
      const p = args.p_payload as Row;
      const nodes = p.nodes as Row[];
      const root: Row = {
        id: `root-${++idSeq}`, user_id: p.user_id, social_account_id: p.social_account_id, campaign_id: p.campaign_id,
        platform: p.platform, content_type: p.platform === 'twitter' ? 'thread' : 'post', content: nodes[0].content,
        media_urls: [], scheduled_for: p.scheduled_for, status: p.root_status ?? 'scheduled', title: p.title,
        is_thread_start: true, parent_post_id: null, thread_position: 0, platform_post_id: null, error_code: null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      };
      posts.push(root);
      const children = nodes.slice(1).map((n) => childRow(root, n));
      posts.push(...children);
      return { data: { root_id: root.id, node_ids: [root.id, ...children.map((c) => c.id)] }, error: null };
    }
    return { data: null, error: { message: `rpc ${name} missing` } };
  });
}

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: (t: string) => buildChain(t), rpc: (n: string, a: Row) => rpc(n, a) },
}));

// ─── Platform boundary ──────────────────────────────────────────────────────

const platformCalls: Array<{ rowId: string; replyTo: string | undefined }> = [];
const outcomeFor = new Map<string, Row>();
jest.mock('../../adapters/platformAdapter', () => ({
  publishToPlatform: jest.fn(async (rowId: string, _a: string, opts?: { replyToPlatformPostId?: string }) => {
    platformCalls.push({ rowId, replyTo: opts?.replyToPlatformPostId });
    const o = outcomeFor.get(rowId);
    if (o) return o;
    return { success: true, platform_post_id: `tw_${rowId}_${platformCalls.length}`, post_url: `https://x.test/${rowId}` };
  }),
}));

// ─── Route collaborators ────────────────────────────────────────────────────

jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: jest.fn(async () => (authUser ? { user: { id: authUser }, error: null } : { user: null, error: 'MISSING_AUTH' })),
}));
jest.mock('../../security/IdentityResolver', () => ({
  resolvePrincipal: jest.fn(async () => (authUser
    ? { ok: true, principal: { userId: authUser, legacyCookieSuperAdmin: false } }
    : { ok: false, reason: 'NO_PRINCIPAL' })),
}));
/** Company-level campaign access: OWNER and OTHER are both members of COMPANY. */
jest.mock('../../security/TenantGuard', () => ({
  requireCampaignTenantAccess: jest.fn(async (_req: unknown, res: { status: (c: number) => { json: (b: unknown) => void } }, campaignId: string) => {
    if (campaignId === CAMPAIGN && (authUser === OWNER || authUser === OTHER)) return { organizationId: COMPANY };
    res.status(403).json({ error: 'FORBIDDEN' });
    return null;
  }),
}));
const enqueued: string[] = [];
jest.mock('../../scheduler/schedulerService', () => ({
  enqueueScheduledPostAt: jest.fn(async (id: string) => { enqueued.push(id); return 'enqueued'; }),
}));
jest.mock('../../services/creator/media', () => ({ runSharedMediaPreEnqueue: jest.fn(async () => ({ ran: false })) }));
jest.mock('../../services/earnCreditsService', () => ({ grantEarnCredit: jest.fn(async () => ({ granted: false })) }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../middleware/withIdempotency', () => ({ withIdempotency: (h: unknown) => h }));
// ENFORCE mode: the multi-row root IS the publish target and is enqueued.
jest.mock('../../../lib/thread/threadRuntimeMode', () => ({
  getThreadRuntimeMode: () => 'enforce',
  isMultiRowWriteEnabled: () => true,
  isLegacyJoinedWriteSkipped: () => true,
  checkEnforceGate: () => ({ allowed: true }),
}));

// ─── Worker collaborators (as in the other publish suites) ──────────────────

jest.mock('../../services/publishNowService', () => {
  const actual = jest.requireActual('../../services/publishNowService');
  return { ...actual, refreshScheduledPostMediaFromRefs: jest.fn(async () => undefined) };
});
jest.mock('../../services/publishReadinessValidator', () => ({ validatePublishReadiness: jest.fn(() => ({ ok: true, warnings: [] })) }));
jest.mock('../../services/mediaReferenceResolver', () => ({ refreshDurableMediaBeforePublish: jest.fn(async () => undefined) }));
jest.mock('../../services/creator/publishingOrganizationResolver', () => ({ resolvePublishingOrganization: jest.fn(async () => null) }));
jest.mock('../../services/creator/creatorPublishResolution', () => ({ resolvePublishMedia: jest.fn(async () => ({ mediaUrls: [], resolvedCount: 0 })) }));
jest.mock('../../services/creatorQueueReliabilityService', () => ({ recordPublishFailure: jest.fn(async () => undefined) }));
jest.mock('../../services/errorRecoveryService', () => ({
  categorizeError: jest.fn((_p: string, err: { code?: string; message?: string } | undefined) => ({
    code: err?.code ?? 'PROCESSING_ERROR', user_message: err?.message ?? String(err),
  })),
}));
jest.mock('../../services/analyticsService', () => ({ recordPostAnalytics: jest.fn(async () => undefined) }));
jest.mock('../../services/analyticsNormalizationService', () => ({ schedulePostPolls: jest.fn(async () => undefined) }));
jest.mock('../../services/activityLogger', () => ({ logActivity: jest.fn(async () => undefined) }));
jest.mock('../../services/userNotificationService', () => ({ createUserNotification: jest.fn(async () => undefined) }));
jest.mock('../../services/CampaignCompletionService', () => ({ checkAndCompleteCampaignIfEligible: jest.fn(async () => undefined) }));
jest.mock('../../security/audit/SecurityAuditService', () => ({ logSecurityEvent: jest.fn(async () => undefined) }));
jest.mock('../../services/creator/strategyAttributionResolver', () => ({ resolveStrategyAttributionForScheduledPost: jest.fn(async () => null) }));
jest.mock('../../services/creator/variantExperimentLifecycle', () => ({ notifyExperimentAssetPublished: jest.fn(() => undefined) }));
jest.mock('../../services/executionGovernor', () => ({ acquire: jest.fn(() => ({ ok: true, release: () => undefined })) }));
jest.mock('../../queue/bullmqClient', () => ({
  getQueue: () => ({ name: 'publish', add: async () => undefined, getJob: async () => null }),
  getEngagementPollingQueue: () => ({ add: async () => undefined }),
}));

import type { Job } from 'bullmq';
import scheduleHandler from '../../../pages/api/activity-workspace/schedule';
import { publishThread, resumeThreadPublish } from '../../services/threadRuntime/threadPublishOrchestrator';
import { processPublishJob } from '../../queue/jobProcessors/publishProcessor';
import { reconcileUncertainPublish } from '../../services/publishOutcomeReconciliation';

// ─── Helpers ────────────────────────────────────────────────────────────────

const TITLE = 'Launch thread';
const nodesOf = (...contents: string[]) => contents.map((content, position) => ({ position, content }));
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

function mockRes() {
  const res: { statusCode: number; body: Row | null; status: (c: number) => typeof res; json: (b: Row) => typeof res; setHeader: () => typeof res } = {
    statusCode: 0, body: null,
    status: (c: number) => { res.statusCode = c; return res; },
    json: (b: Row) => { res.body = b; return res; },
    setHeader: () => res,
  };
  return res;
}
async function schedule(as: string | null, nodes: Array<{ position: number; content: string }>, extra: Row = {}) {
  authUser = as;
  const res = mockRes();
  await (scheduleHandler as unknown as (rq: Row, rs: typeof res) => Promise<void>)({
    method: 'POST', url: '/api/activity-workspace/schedule', headers: {}, query: {},
    body: { platform: 'twitter', content: nodes[0].content, title: TITLE, scheduledDate: tomorrow, campaignId: CAMPAIGN, nodes, ...extra },
  }, res);
  return res;
}

const posts = (): Row[] => store.scheduled_posts;
const rootsOf = (userId: string) => posts().filter((r) => r.is_thread_start === true && r.user_id === userId);
const childrenOf = (rootId: string) =>
  posts().filter((r) => r.parent_post_id === rootId).sort((a, b) => Number(a.thread_position) - Number(b.thread_position));
const callsFor = (id: string) => platformCalls.filter((c) => c.rowId === id).length;
const snapshot = () => JSON.parse(JSON.stringify(posts())) as Row[];

function job(id: string, rootId: string, attemptsMade = 0) {
  return {
    id, data: { scheduled_post_id: rootId, social_account_id: 'acct-owner', user_id: OWNER }, attemptsMade, opts: { attempts: 3 },
  } as unknown as Job<{ scheduled_post_id: string; social_account_id: string; user_id: string }>;
}
function seedJob(id: string, rootId: string, over: Row = {}) {
  store.queue_jobs.push({
    id, scheduled_post_id: rootId, job_type: 'publish', status: 'pending', attempts: 0, max_attempts: 3, retry_state: null,
    metadata: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...over,
  });
}

/** The owner schedules a 3-node thread; returns the root id. */
async function ownerThread(...contents: string[]): Promise<string> {
  const res = await schedule(OWNER, nodesOf(...(contents.length ? contents : ['one', 'two', 'three'])));
  expect(res.statusCode).toBe(200);
  return String(res.body?.scheduled_post_id);
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  for (const t of ['scheduled_posts', 'queue_jobs', 'queue_job_logs', 'campaigns', 'daily_content_plans', 'worker_dead_letter_queue']) store[t] = [];
  store.campaigns = [{ id: CAMPAIGN, status: 'active' }];
  store.social_accounts = [
    { id: 'acct-owner', user_id: OWNER, is_active: true, company_id: COMPANY, platform: 'twitter' },
    { id: 'acct-other', user_id: OTHER, is_active: true, company_id: COMPANY, platform: 'twitter' },
  ];
  writeLock = Promise.resolve();
  platformCalls.length = 0;
  outcomeFor.clear();
  rpcCalls.length = 0;
  enqueued.length = 0;
  beforePostUpdate = null;
  authUser = OWNER;
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

// ─── Ownership and isolation ────────────────────────────────────────────────

describe('Closure-004 — ownership of thread lookups and writes', () => {
  test("another member of the same company cannot locate the owner's thread: their request creates their own, the owner's is untouched", async () => {
    const rootId = await ownerThread();
    const before = snapshot();

    const res = await schedule(OTHER, nodesOf('hijack', 'hijack 2'));
    expect(res.statusCode).toBe(200);
    expect(res.body?.scheduled_post_id).not.toBe(rootId);
    expect(rpcCalls.filter((r) => r === 'replace_thread_children')).toHaveLength(0);
    // Every row the owner had is byte-for-byte unchanged (no re-own, no rewrite, no child swap).
    for (const row of before) expect(posts().find((r) => r.id === row.id)).toEqual(row);
    expect(rootsOf(OTHER)).toHaveLength(1);
  });

  test("a thread whose child belongs to another user: re-schedule refused (409), publish refuses the whole thread", async () => {
    const rootId = await ownerThread();
    const child = childrenOf(rootId)[0];
    child.user_id = OTHER; // corrupted / re-owned child
    const before = snapshot();

    const res = await schedule(OWNER, nodesOf('a', 'b', 'c'));
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ code: 'THREAD_OWNERSHIP_CONFLICT', node_ids: [child.id] });
    expect(posts()).toEqual(before);

    const r = await publishThread({ root_scheduled_post_id: rootId, social_account_id: 'acct-owner', user_id: OWNER });
    expect(r.status).toBe('FAILED');
    expect(platformCalls).toHaveLength(0);
  });

  test('unauthenticated → 401 and a campaign of another company → 403; nothing written either way', async () => {
    await ownerThread();
    const before = snapshot();
    expect((await schedule(null, nodesOf('x', 'y'))).statusCode).toBe(401);
    expect((await schedule(OWNER, nodesOf('x', 'y'), { campaignId: FOREIGN_CAMPAIGN })).statusCode).toBe(403);
    expect(posts()).toEqual(before);
  });

  test('the valid owner can still re-schedule an unpublished thread: root rewritten in place, children replaced, root re-enqueued', async () => {
    const rootId = await ownerThread('one', 'two', 'three');
    const oldChildIds = childrenOf(rootId).map((c) => c.id);

    const res = await schedule(OWNER, nodesOf('ONE', 'TWO', 'THREE'));
    expect(res.statusCode).toBe(200);
    expect(res.body?.scheduled_post_id).toBe(rootId);
    const root = posts().find((r) => r.id === rootId) as Row;
    expect(root).toMatchObject({ content: 'ONE', user_id: OWNER, status: 'scheduled' });
    const children = childrenOf(rootId);
    expect(children.map((c) => c.content)).toEqual(['TWO', 'THREE']);
    expect(children.some((c) => oldChildIds.includes(c.id))).toBe(false);
    expect(enqueued.filter((id) => id === rootId)).toHaveLength(2);
  });
});

// ─── Thread identity ────────────────────────────────────────────────────────

describe('Closure-004 — re-scheduling never erases or re-publishes a published node', () => {
  async function publishedThread(): Promise<{ rootId: string; childIds: string[] }> {
    const rootId = await ownerThread('one', 'two', 'three');
    const r = await publishThread({ root_scheduled_post_id: rootId, social_account_id: 'acct-owner', user_id: OWNER });
    expect(r.status).toBe('PUBLISHED');
    expect(platformCalls).toHaveLength(3);
    return { rootId, childIds: childrenOf(rootId).map((c) => String(c.id)) };
  }

  test('THE DEFECT: a fully published thread re-scheduled → 409, every published id kept, and nothing is ever published again', async () => {
    const { rootId, childIds } = await publishedThread();
    const before = snapshot();

    const res = await schedule(OWNER, nodesOf('one', 'two', 'three'));
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ code: 'THREAD_ALREADY_PUBLISHED' });
    expect(posts()).toEqual(before);
    expect(rpcCalls.filter((r) => r === 'replace_thread_children')).toHaveLength(0);

    // Every path that could publish it again finds nothing to do.
    seedJob('qj-redelivery', rootId, { status: 'processing', updated_at: new Date(Date.now() - 40 * 60 * 1000).toISOString() });
    // The worker refuses a published root outright (publish authorization);
    // either way it must not reach the platform.
    await processPublishJob(job('qj-redelivery', rootId)).catch(() => undefined);
    await resumeThreadPublish({ root_scheduled_post_id: rootId });
    expect(platformCalls).toHaveLength(3);
    for (const id of [rootId, ...childIds]) expect(callsFor(id)).toBe(1);
  });

  test('published root + published child + unpublished (rejected) child: refused; resume then publishes ONLY the unpublished child, as a reply', async () => {
    const rootId = await ownerThread('one', 'two', 'three');
    const [c1, c2] = childrenOf(rootId);
    outcomeFor.set(String(c2.id), { success: false, error: { code: 'TWITTER_RATE_LIMIT', message: 'Too Many Requests' } });
    await publishThread({ root_scheduled_post_id: rootId, social_account_id: 'acct-owner', user_id: OWNER });
    expect(c2).toBeDefined();
    const c1Id = String(c1.id);
    const c1PlatformId = String((posts().find((r) => r.id === c1Id) as Row).platform_post_id);
    const before = snapshot();

    // Including a request that tries to REMOVE the unpublished child.
    for (const nodes of [nodesOf('one', 'two', 'three'), nodesOf('one', 'two')]) {
      const res = await schedule(OWNER, nodes);
      expect(res.statusCode).toBe(409);
      expect(res.body?.code).toBe('THREAD_ALREADY_PUBLISHED');
      expect(posts()).toEqual(before);
    }

    outcomeFor.clear();
    await resumeThreadPublish({ root_scheduled_post_id: rootId });
    expect(callsFor(rootId)).toBe(1);
    expect(callsFor(c1Id)).toBe(1);
    expect(callsFor(String(c2.id))).toBe(2); // the rejected attempt + the resume
    expect(platformCalls[platformCalls.length - 1].replyTo).toBe(c1PlatformId);
  });

  test('an uncertain child blocks re-scheduling until reconciled; after reconciliation, resume publishes it once', async () => {
    const rootId = await ownerThread('one', 'two', 'three');
    const [, c2] = childrenOf(rootId);
    outcomeFor.set(String(c2.id), { success: false, error: { code: 'TWITTER_API_ERROR', message: '503' } });
    await publishThread({ root_scheduled_post_id: rootId, social_account_id: 'acct-owner', user_id: OWNER });
    expect(posts().find((r) => r.id === c2.id)).toMatchObject({ status: 'failed', error_code: 'PUBLISH_OUTCOME_UNCERTAIN' });
    const before = snapshot();

    const res = await schedule(OWNER, nodesOf('one', 'two', 'three'));
    expect(res.statusCode).toBe(409);
    expect(posts()).toEqual(before);

    outcomeFor.clear();
    await reconcileUncertainPublish({
      scheduledPostId: String(c2.id), resolution: 'not_published', actorUserId: 'admin', note: 'not on the timeline',
    });
    await resumeThreadPublish({ root_scheduled_post_id: rootId });
    expect(callsFor(String(c2.id))).toBe(2); // the ambiguous attempt + the one after reconciliation
    expect(platformCalls).toHaveLength(4);
  });

  test('a thread being published right now (a node publishing) is not re-scheduled', async () => {
    const rootId = await ownerThread('one', 'two', 'three');
    const [c1] = childrenOf(rootId);
    Object.assign(c1, { status: 'publishing', error_code: 'PUBLISH_CALL_STARTED' });
    const before = snapshot();
    const res = await schedule(OWNER, nodesOf('x', 'y', 'z'));
    expect(res.statusCode).toBe(409);
    expect(res.body?.code).toBe('THREAD_PUBLISH_IN_PROGRESS');
    expect(posts()).toEqual(before);
  });
});

describe('Closure-004 — unpublished threads: replace, remove, repeat, race', () => {
  test('removing an unpublished child, then publishing: each remaining node is called exactly once', async () => {
    const rootId = await ownerThread('one', 'two', 'three');
    expect((await schedule(OWNER, nodesOf('one', 'two'))).statusCode).toBe(200);
    expect(childrenOf(rootId)).toHaveLength(1);

    await publishThread({ root_scheduled_post_id: rootId, social_account_id: 'acct-owner', user_id: OWNER });
    expect(platformCalls.map((c) => c.rowId)).toEqual([rootId, String(childrenOf(rootId)[0].id)]);
  });

  test('the same request repeated: one thread, and publishing calls each node once', async () => {
    const rootId = await ownerThread('one', 'two', 'three');
    for (let i = 0; i < 3; i++) expect((await schedule(OWNER, nodesOf('one', 'two', 'three'))).statusCode).toBe(200);
    expect(rootsOf(OWNER)).toHaveLength(1);
    expect(childrenOf(rootId)).toHaveLength(2);

    await publishThread({ root_scheduled_post_id: rootId, social_account_id: 'acct-owner', user_id: OWNER });
    expect(platformCalls).toHaveLength(3);
    // ...and repeating it once more after publication is refused, with no call.
    expect((await schedule(OWNER, nodesOf('one', 'two', 'three'))).statusCode).toBe(409);
    expect(platformCalls).toHaveLength(3);
  });

  test('two concurrent re-schedules: the thread ends consistent (one set of children) and publishes each node once', async () => {
    const rootId = await ownerThread('one', 'two', 'three');
    const [a, b] = await Promise.all([schedule(OWNER, nodesOf('A1', 'A2', 'A3')), schedule(OWNER, nodesOf('B1', 'B2', 'B3'))]);
    expect([a.statusCode, b.statusCode]).toContain(200);
    expect(rootsOf(OWNER)).toHaveLength(1);
    const children = childrenOf(rootId);
    expect(children).toHaveLength(2);
    expect(children.every((c) => c.status === 'draft' && c.error_code === null)).toBe(true);

    await publishThread({ root_scheduled_post_id: rootId, social_account_id: 'acct-owner', user_id: OWNER });
    expect(platformCalls).toHaveLength(3);
  });

  test('a publisher that claims a child between the read and the fence makes the re-schedule refuse; nothing is replaced', async () => {
    const rootId = await ownerThread('one', 'two', 'three');
    const [c1] = childrenOf(rootId);
    // Lands inside the first fence write, before its predicate.
    beforePostUpdate = () => { Object.assign(c1, { status: 'publishing', error_code: 'PUBLISH_CLAIMED:publisher' }); };
    const res = await schedule(OWNER, nodesOf('x', 'y', 'z'));
    expect(res.statusCode).toBe(409);
    expect(res.body?.code).toBe('THREAD_CHANGED_CONCURRENTLY');
    expect(rpcCalls.filter((r) => r === 'replace_thread_children')).toHaveLength(0);
    // No fence is left behind on the untouched child.
    expect(childrenOf(rootId).every((c) => !String(c.error_code ?? '').startsWith('THREAD_RESCHEDULING:'))).toBe(true);
  });

  test('a fenced child is never claimed by a publisher (it reads as held)', async () => {
    const rootId = await ownerThread('one', 'two', 'three');
    const [c1] = childrenOf(rootId);
    c1.error_code = 'THREAD_RESCHEDULING:other-request';
    const r = await publishThread({ root_scheduled_post_id: rootId, social_account_id: 'acct-owner', user_id: OWNER });
    expect(r.uncertain).toBe(true);
    expect(callsFor(String(c1.id))).toBe(0);
  });

  test('worker redelivery after a re-schedule publishes the NEW children once each', async () => {
    const rootId = await ownerThread('one', 'two', 'three');
    expect((await schedule(OWNER, nodesOf('ONE', 'TWO', 'THREE'))).statusCode).toBe(200);
    seedJob('qj-1', rootId);
    await processPublishJob(job('qj-1', rootId));
    seedJob('qj-2', rootId, { status: 'processing', updated_at: new Date(Date.now() - 40 * 60 * 1000).toISOString() });
    // A stale re-delivery: the root is now published, so the worker refuses it
    // (publish authorization) before any node — no call either way.
    await processPublishJob(job('qj-2', rootId)).catch(() => undefined);
    expect(platformCalls).toHaveLength(3);
    for (const c of childrenOf(rootId)) expect(callsFor(String(c.id))).toBe(1);
  });
});

describe('Closure-004 — the re-schedule service holds on its own (defence in depth)', () => {
  test("called directly with another user's id for the owner's root: refused, nothing changed", async () => {
    const rootId = await ownerThread('one', 'two', 'three');
    const before = snapshot();
    const { rescheduleExistingThread } = await import('../../services/threadRuntime/threadReschedule');
    const { supabase } = await import('../../db/supabaseClient');
    const r = await rescheduleExistingThread(supabase as unknown as Parameters<typeof rescheduleExistingThread>[0], {
      rootId, userId: OTHER, rootUpdate: { content: 'hijack' }, children: [{ position: 1, content: 'x' }],
    });
    expect(r).toMatchObject({ ok: false, code: 'THREAD_CHANGED_CONCURRENTLY' });
    expect(posts()).toEqual(before);
    expect(rpcCalls.filter((n) => n === 'replace_thread_children')).toHaveLength(0);
  });

  test("a child whose code changes (same status) between the read and its fence is not fenced or replaced", async () => {
    const rootId = await ownerThread('one', 'two', 'three');
    const [c1] = childrenOf(rootId);
    Object.assign(c1, { status: 'failed', error_code: 'TWITTER_RATE_LIMIT' });
    let raced = false;
    beforePostUpdate = (_p, f) => {
      if (!raced && f.eq.id === c1.id) { raced = true; c1.error_code = 'PUBLISH_OUTCOME_UNCERTAIN'; }
    };
    const res = await schedule(OWNER, nodesOf('x', 'y', 'z'));
    expect(res.statusCode).toBe(409);
    expect(rpcCalls.filter((n) => n === 'replace_thread_children')).toHaveLength(0);
    expect(posts().find((r) => r.id === c1.id)).toMatchObject({ status: 'failed', error_code: 'PUBLISH_OUTCOME_UNCERTAIN' });
  });

  test('a race on the SECOND child rolls back the fence already written on the first', async () => {
    const rootId = await ownerThread('one', 'two', 'three');
    const [c1, c2] = childrenOf(rootId);
    beforePostUpdate = (_p, f) => {
      if (f.eq.id === c2.id && c2.status === 'draft') Object.assign(c2, { status: 'publishing', error_code: 'PUBLISH_CLAIMED:publisher' });
    };
    const res = await schedule(OWNER, nodesOf('x', 'y', 'z'));
    expect(res.statusCode).toBe(409);
    expect(rpcCalls.filter((n) => n === 'replace_thread_children')).toHaveLength(0);
    expect(posts().find((r) => r.id === c1.id)?.error_code).toBeNull(); // fence rolled back
  });

  test('the root changes (a publisher claims it) after the children were swapped: the root is NOT rewritten', async () => {
    const rootId = await ownerThread('one', 'two', 'three');
    beforePostUpdate = (p, f) => {
      if (f.eq.id === rootId && p.content === 'NEW ROOT') {
        Object.assign(posts().find((r) => r.id === rootId) as Row, { status: 'publishing', error_code: 'PUBLISH_CLAIMED:publisher' });
      }
    };
    const res = await schedule(OWNER, nodesOf('NEW ROOT', 'b', 'c'));
    expect(res.statusCode).toBe(409);
    expect(res.body?.code).toBe('THREAD_CHANGED_CONCURRENTLY');
    expect(posts().find((r) => r.id === rootId)).toMatchObject({ content: 'one', status: 'publishing' });
  });
});
