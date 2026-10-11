/**
 * Closure-003 R1 — no alternate endpoint re-queues an uncertain post.
 *
 * A post whose last attempt may already have published it carries
 * PUBLISH_OUTCOME_UNCERTAIN (or a leftover PUBLISH_CALL_STARTED). Besides the
 * manual retry route, three writers used to put such a row back to
 * 'scheduled' without reconciliation, after which the cron / queue published
 * it again:
 *   F2  POST /api/schedule/posts/[id]   ("publish now" — re-queue)
 *   F3  PUT  /api/schedule/posts/[id]   (client-supplied status)
 *   F5  POST /api/activity-workspace/schedule (dedup re-schedule of an
 *       existing row, and of an existing thread root + its children)
 * Each now answers 409 PUBLISH_OUTCOME_UNCERTAIN and writes / enqueues
 * nothing. Ownership scoping is unchanged: another user's post is still 404 /
 * never matched.
 */
export {};

type Row = Record<string, unknown>;

const OWNER = 'user-owner';
const OTHER = 'user-other';
const COMPANY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CAMPAIGN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

let authUser: string | null = OWNER;
let posts: Row[] = [];
const writes: Array<{ op: 'insert' | 'update'; table: string; filters: Row; row: Row }> = [];

function makeQuery(table: string) {
  const f: Row = {};
  const isF: Row = {};
  let op: 'select' | 'insert' | 'update' = 'select';
  let payload: Row = {};
  const b: Record<string, unknown> = {};
  const chain = () => b;
  b.select = chain;
  b.order = chain;
  b.limit = chain;
  b.in = (col: string, vals: unknown[]) => { f[col] = vals; return b; };
  b.eq = (col: string, val: unknown) => { f[col] = val; return b; };
  b.is = (col: string, val: unknown) => { isF[col] = val; return b; };
  b.insert = (p: Row) => { op = 'insert'; payload = p; return b; };
  b.update = (p: Row) => { op = 'update'; payload = p; return b; };
  const matches = (r: Row) =>
    Object.entries(f).every(([k, v]) => r[k] === v) && Object.entries(isF).every(([k, v]) => (r[k] ?? null) === v);
  const resolveList = (): { data: unknown; error: null } => {
    if (op !== 'select') {
      writes.push({ op, table, filters: { ...f, ...isF }, row: payload });
      if (op === 'update' && table === 'scheduled_posts') {
        // Compare-and-set semantics: the update lands on (and reports) exactly the matching rows.
        const hit = posts.filter(matches);
        hit.forEach((r) => Object.assign(r, payload));
        return { data: hit.map((r) => ({ ...r })), error: null };
      }
      return { data: op === 'insert' ? { id: 'new-post-1' } : null, error: null };
    }
    if (table === 'scheduled_posts') return { data: posts.filter(matches).map((r) => ({ ...r })), error: null };
    if (table === 'campaigns') return { data: [{ company_id: COMPANY }], error: null };
    if (table === 'user_company_roles') {
      return { data: f.user_id === OWNER || f.user_id === OTHER ? [{ role: 'COMPANY_ADMIN', status: 'active' }] : [], error: null };
    }
    if (table === 'companies') return { data: [{ id: f.id, status: 'active' }], error: null };
    if (table === 'campaign_versions') return { data: [{ company_id: COMPANY }], error: null };
    if (table === 'social_accounts') return { data: [{ id: `account-of-${f.user_id}` }], error: null };
    return { data: [], error: null };
  };
  const first = () => {
    const r = resolveList();
    return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: null };
  };
  b.single = () => Promise.resolve(first());
  b.maybeSingle = () => Promise.resolve(first());
  b.then = (ok: (v: unknown) => unknown) => Promise.resolve(resolveList()).then(ok);
  return b;
}

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => makeQuery(t) } }));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => makeQuery(t) }));
jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: jest.fn(async () =>
    authUser ? { user: { id: authUser }, error: null } : { user: null, error: 'MISSING_AUTH' }),
}));
jest.mock('../../security/IdentityResolver', () => ({
  resolvePrincipal: jest.fn(async () => (authUser
    ? { ok: true, principal: { userId: authUser, legacyCookieSuperAdmin: false } }
    : { ok: false, reason: 'NO_PRINCIPAL' })),
}));
const mockEnqueue = jest.fn(async () => 'enqueued');
jest.mock('../../scheduler/schedulerService', () => ({ enqueueScheduledPostAt: (...a: unknown[]) => (mockEnqueue as (...x: unknown[]) => Promise<string>)(...a) }));
const mockPublishLegacyNow = jest.fn(async () => undefined);
const mockUpdateLegacy = jest.fn(async () => undefined);
jest.mock('../../services/structuredPlanScheduler', () => ({
  getLegacyScheduledPostById: jest.fn(async (i: { userId: string; id: string }) =>
    posts.find((p) => p.id === i.id && p.user_id === i.userId) ?? null),
  publishLegacyScheduledPostNow: (...a: unknown[]) => (mockPublishLegacyNow as (...x: unknown[]) => Promise<undefined>)(...a),
  updateLegacyScheduledPost: (...a: unknown[]) => (mockUpdateLegacy as (...x: unknown[]) => Promise<undefined>)(...a),
  cancelLegacyScheduledPost: jest.fn(async () => undefined),
}));
jest.mock('../../services/userContextService', () => ({ enforceCompanyAccess: jest.fn(async () => ({ companyId: COMPANY })) }));
jest.mock('../../services/creator/creatorPublishResolution', () => ({
  resolvePublishMedia: jest.fn(async () => ({ mediaUrls: [], totalRefs: 0, resolvedCount: 0, usedFallback: false })),
}));
jest.mock('../../services/creator/media', () => ({ runSharedMediaPreEnqueue: jest.fn(async () => ({ ran: false })) }));
jest.mock('../../services/earnCreditsService', () => ({ grantEarnCredit: jest.fn(async () => ({ granted: false })) }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../middleware/withIdempotency', () => ({ withIdempotency: (h: unknown) => h }));
// The multi-row thread branch (shadow mode) — only reached when `nodes` is sent.
jest.mock('../../../lib/thread/threadRuntimeMode', () => ({
  getThreadRuntimeMode: () => 'shadow',
  isMultiRowWriteEnabled: () => true,
  isLegacyJoinedWriteSkipped: () => false,
  checkEnforceGate: () => ({ allowed: true }),
}));
const mockReplaceChildren = jest.fn(async () => undefined);
jest.mock('../../../lib/thread/threadNodePersistence', () => ({
  insertThreadAtomic: jest.fn(async () => ({ rootId: 'new-root', childIds: [] })),
  replaceThreadChildren: (...a: unknown[]) => (mockReplaceChildren as (...x: unknown[]) => Promise<undefined>)(...a),
  ThreadInsertError: class ThreadInsertError extends Error {},
}));

import schedulePostHandler from '../../../pages/api/schedule/posts/[id]';
import activityScheduleHandler from '../../../pages/api/activity-workspace/schedule';

function mockRes() {
  const res: { statusCode: number; body: Row | null; status: (c: number) => typeof res; json: (b: Row) => typeof res; setHeader: () => typeof res } = {
    statusCode: 0, body: null,
    status: (c: number) => { res.statusCode = c; return res; },
    json: (b: Row) => { res.body = b; return res; },
    setHeader: () => res,
  };
  return res;
}
async function callSchedulePost(method: 'POST' | 'PUT', id: string, body: Row = {}) {
  const res = mockRes();
  await (schedulePostHandler as unknown as (rq: Row, rs: typeof res) => Promise<void>)(
    { method, query: { id }, body, headers: {} }, res);
  return res;
}
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
async function callActivitySchedule(body: Row) {
  const res = mockRes();
  await (activityScheduleHandler as unknown as (rq: Row, rs: typeof res) => Promise<void>)({
    method: 'POST', url: '/api/activity-workspace/schedule', headers: {}, query: {},
    body: { platform: 'linkedin', content: 'hello world', scheduledDate: tomorrow, campaignId: CAMPAIGN, ...body },
  }, res);
  return res;
}
const post = (over: Row): Row => ({
  id: 'post-1', user_id: OWNER, campaign_id: CAMPAIGN, platform: 'linkedin', title: 'Launch post',
  status: 'failed', error_code: 'PUBLISH_OUTCOME_UNCERTAIN', platform_post_id: null,
  social_account_id: 'acct-1', scheduled_for: new Date().toISOString(), ...over,
});
const postWrites = () => writes.filter((w) => w.table === 'scheduled_posts');

beforeEach(() => {
  jest.clearAllMocks();
  authUser = OWNER;
  posts = [];
  writes.length = 0;
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('F2 — POST /api/schedule/posts/[id] ("publish now")', () => {
  it.each(['PUBLISH_OUTCOME_UNCERTAIN', 'PUBLISH_CALL_STARTED'])('refuses a failed post carrying %s: 409, nothing re-queued', async (code) => {
    posts = [post({ error_code: code })];
    const res = await callSchedulePost('POST', 'post-1');
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ code: 'PUBLISH_OUTCOME_UNCERTAIN', requires: 'reconciliation' });
    expect(mockPublishLegacyNow).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('also refuses an uncertain post an older build already moved to scheduled', async () => {
    posts = [post({ status: 'scheduled' })];
    expect((await callSchedulePost('POST', 'post-1')).statusCode).toBe(409);
    expect(mockPublishLegacyNow).not.toHaveBeenCalled();
  });

  it('an ordinary failed post (or one reconciled not_published) still re-queues', async () => {
    for (const code of ['LINKEDIN_RATE_LIMIT', 'PUBLISH_RECONCILED_NOT_PUBLISHED', null]) {
      jest.clearAllMocks();
      posts = [post({ error_code: code })];
      const res = await callSchedulePost('POST', 'post-1');
      expect(res.statusCode).toBe(200);
      expect(mockPublishLegacyNow).toHaveBeenCalledTimes(1);
    }
  });

  it("another user's uncertain post is still a 404 — no state disclosed", async () => {
    posts = [post({ user_id: OTHER })];
    const res = await callSchedulePost('POST', 'post-1');
    expect(res.statusCode).toBe(404);
    expect(res.body?.code).toBeUndefined();
    expect(mockPublishLegacyNow).not.toHaveBeenCalled();
  });
});

describe('F3 — PUT /api/schedule/posts/[id]', () => {
  it('a status change on an uncertain post is refused: 409, no update, no enqueue', async () => {
    posts = [post({})];
    const res = await callSchedulePost('PUT', 'post-1', { status: 'scheduled' });
    expect(res.statusCode).toBe(409);
    expect(res.body?.code).toBe('PUBLISH_OUTCOME_UNCERTAIN');
    expect(mockUpdateLegacy).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('a content-only edit of an uncertain post is not a re-queue and still works', async () => {
    posts = [post({})];
    const res = await callSchedulePost('PUT', 'post-1', { content: 'fixed typo' });
    expect(res.statusCode).toBe(200);
    expect(mockUpdateLegacy).toHaveBeenCalledTimes(1);
    expect(mockEnqueue).not.toHaveBeenCalled(); // still 'failed' — nothing to enqueue
  });

  it('a status change on an ordinary post is unchanged', async () => {
    posts = [post({ error_code: 'LINKEDIN_RATE_LIMIT' })];
    expect((await callSchedulePost('PUT', 'post-1', { status: 'scheduled' })).statusCode).toBe(200);
    expect(mockUpdateLegacy).toHaveBeenCalledTimes(1);
  });
});

describe('F5 — POST /api/activity-workspace/schedule re-scheduling an existing row', () => {
  it('dedup by campaign+platform+title onto an uncertain post: 409, nothing written or enqueued', async () => {
    posts = [post({})];
    const res = await callActivitySchedule({ title: 'Launch post' });
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ code: 'PUBLISH_OUTCOME_UNCERTAIN', scheduled_post_id: 'post-1' });
    expect(postWrites()).toEqual([]);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('dedup by executionId onto an uncertain post: 409, nothing written', async () => {
    posts = [post({ title: 'something else', repurpose_parent_execution_id: 'exec-1' })];
    const res = await callActivitySchedule({ executionId: 'exec-1' });
    expect(res.statusCode).toBe(409);
    expect(postWrites()).toEqual([]);
  });

  it('dedup onto an ordinary row still updates it in place', async () => {
    posts = [post({ status: 'failed', error_code: 'LINKEDIN_RATE_LIMIT' })];
    const res = await callActivitySchedule({ title: 'Launch post' });
    expect(res.statusCode).toBe(200);
    const updates = postWrites().filter((w) => w.op === 'update');
    expect(updates).toHaveLength(1);
    expect(updates[0].filters.id).toBe('post-1');
  });

  it("another user's uncertain row is never matched (owner-scoped lookup): a new row is inserted", async () => {
    posts = [post({ user_id: OTHER })];
    const res = await callActivitySchedule({ title: 'Launch post' });
    expect(res.statusCode).toBe(200);
    expect(postWrites().filter((w) => w.op === 'update')).toEqual([]);
    expect(postWrites().filter((w) => w.op === 'insert')).toHaveLength(1);
  });
});

describe('F5 — re-scheduling an existing THREAD (root updated in place, children replaced)', () => {
  const thread = (childOver: Row): void => {
    posts = [
      // An unpublished root: a thread with a PUBLISHED node is refused
      // outright (Closure-004 — see publishThreadReschedule.test.ts).
      post({ id: 't0', title: 'Thread', is_thread_start: true, status: 'scheduled', error_code: null, platform_post_id: null, parent_post_id: null }),
      post({ id: 't1', title: null, is_thread_start: false, parent_post_id: 't0', status: 'failed', error_code: 'LINKEDIN_RATE_LIMIT', ...childOver }),
    ];
  };
  const nodes = [{ position: 0, content: 'first' }, { position: 1, content: 'second' }];

  it('a node with an uncertain outcome: 409, the root is not rewritten and the children are not replaced', async () => {
    thread({ error_code: 'PUBLISH_OUTCOME_UNCERTAIN' });
    const res = await callActivitySchedule({ title: 'Thread', nodes });
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ code: 'PUBLISH_OUTCOME_UNCERTAIN', scheduled_post_id: 't1' });
    expect(postWrites().filter((w) => w.op === 'update')).toEqual([]);
    expect(mockReplaceChildren).not.toHaveBeenCalled();
  });

  it('no uncertain node: the existing root is updated and its children replaced, as before', async () => {
    thread({});
    const res = await callActivitySchedule({ title: 'Thread', nodes });
    expect(res.statusCode).toBe(200);
    expect(postWrites().some((w) => w.op === 'update' && w.filters.id === 't0')).toBe(true);
    expect(mockReplaceChildren).toHaveBeenCalledTimes(1);
  });
});
