/**
 * Closure-002 R3 — a thread node whose platform call may have reached the
 * platform is never published again automatically.
 *
 * Drives the REAL thread orchestrator (publishThread / resumeThreadPublish),
 * the REAL publish worker (processPublishJob → thread delegation), the REAL
 * stuck-publishing sweeper route and the REAL reconciliation service over one
 * in-memory, Postgres-shaped store. The platform adapter is the only stubbed
 * boundary that matters: every call into it is counted, per node.
 *
 * Before this change a node only skipped the platform when it already had a
 * platform_post_id. A node interrupted after its call (platform_post_id still
 * null) was swept to 'failed' and then published again — by BullMQ's stalled
 * re-delivery with nobody involved, or by an operator's resume.
 */
export {};

type Row = Record<string, unknown>;
type DbError = { code: string; message: string };
type Result = { data: unknown; error: DbError | null };

const store: Record<string, Row[]> = {};

type Filters = {
  eq: Record<string, unknown>;
  in: Record<string, unknown[]>;
  is: Record<string, unknown>;
  lt: Record<string, unknown>;
  contains: Record<string, Row>;
};

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

/** Fails the next scheduled_posts update whose payload matches. */
let postUpdateFault: ((payload: Row) => DbError | null) | null = null;

function buildChain(table: string) {
  if (!store[table]) store[table] = [];
  const f: Filters = { eq: {}, in: {}, is: {}, lt: {}, contains: {} };
  let updatePayload: Row | null = null;
  let insertRows: Row[] | null = null;
  let orderBy: string | null = null;

  const settle = (): Promise<Result> => serialised((): Result => {
    const rows = store[table];
    if (insertRows) {
      const created = insertRows.map((r, i) => ({
        id: r.id ?? `${table}-${rows.length + i + 1}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...r,
      }));
      rows.push(...created);
      return { data: created, error: null };
    }
    if (updatePayload && table === 'scheduled_posts' && postUpdateFault) {
      const fault = postUpdateFault(updatePayload);
      if (fault) { postUpdateFault = null; return { data: null, error: fault }; }
    }
    let hit = rows.filter((r) => rowMatches(r, f));
    if (orderBy) {
      const key = orderBy;
      hit = [...hit].sort((a, b) => Number(a[key] ?? 0) - Number(b[key] ?? 0));
    }
    if (updatePayload) {
      const payload = updatePayload;
      hit.forEach((r) => Object.assign(r, payload));
    }
    return { data: hit.map((r) => ({ ...r })), error: null };
  });

  const chain = {
    select: () => chain,
    insert: (r: Row | Row[]) => { insertRows = Array.isArray(r) ? r : [r]; return chain; },
    update: (p: Row) => { updatePayload = p; return chain; },
    eq: (k: string, v: unknown) => { f.eq[k] = v; return chain; },
    in: (k: string, v: unknown[]) => { f.in[k] = v; return chain; },
    is: (k: string, v: unknown) => { f.is[k] = v; return chain; },
    lt: (k: string, v: unknown) => { f.lt[k] = v; return chain; },
    lte: () => chain,
    contains: (k: string, v: Row) => { f.contains[k] = v; return chain; },
    order: (k: string) => { orderBy = k === 'thread_position' ? k : null; return chain; },
    limit: () => chain,
    single: async (): Promise<Result> => {
      const r = await settle();
      if (r.error) return r;
      const list = r.data as Row[];
      return list[0] ? { data: list[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
    },
    maybeSingle: async (): Promise<Result> => {
      const r = await settle();
      if (r.error) return r;
      return { data: (r.data as Row[])[0] ?? null, error: null };
    },
    then: <A, B = never>(ok: (r: Result) => A, err?: (e: unknown) => B) => settle().then(ok, err),
  };
  return chain;
}

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => buildChain(table),
    rpc: async () => ({ data: null, error: { message: 'rpc missing' } }),
  },
}));

// ─── Platform boundary ───────────────────────────────────────────────────────

const platformCalls: Array<{ rowId: string; replyTo: string | undefined }> = [];
/** Per-row adapter outcome; default success. */
const outcomeFor = new Map<string, Row | 'throw'>();
/** Runs while a node's platform call is in flight. */
let duringCall: ((rowId: string) => Promise<void>) | null = null;

jest.mock('../../adapters/platformAdapter', () => ({
  publishToPlatform: jest.fn(async (rowId: string, _account: string, opts?: { replyToPlatformPostId?: string }) => {
    platformCalls.push({ rowId, replyTo: opts?.replyToPlatformPostId });
    if (duringCall) await duringCall(rowId);
    const o = outcomeFor.get(rowId);
    if (o === 'throw') throw new Error('ECONNRESET');
    if (o) return o;
    return { success: true, platform_post_id: `tw_${rowId}_${platformCalls.length}`, post_url: `https://x.test/${rowId}` };
  }),
}));

jest.mock('../../services/publishNowService', () => {
  const actual = jest.requireActual('../../services/publishNowService');
  return { ...actual, refreshScheduledPostMediaFromRefs: jest.fn(async () => undefined) };
});
jest.mock('../../services/publishReadinessValidator', () => ({
  validatePublishReadiness: jest.fn(() => ({ ok: true, warnings: [] })),
}));
jest.mock('../../services/mediaReferenceResolver', () => ({
  refreshDurableMediaBeforePublish: jest.fn(async () => undefined),
}));
jest.mock('../../services/creator/publishingOrganizationResolver', () => ({
  resolvePublishingOrganization: jest.fn(async () => null),
}));
jest.mock('../../services/creator/creatorPublishResolution', () => ({
  resolvePublishMedia: jest.fn(async () => ({ mediaUrls: [], resolvedCount: 0 })),
}));
jest.mock('../../services/creatorQueueReliabilityService', () => ({ recordPublishFailure: jest.fn(async () => undefined) }));
jest.mock('../../services/errorRecoveryService', () => ({
  categorizeError: jest.fn((_p: string, err: { code?: string; message?: string } | undefined) => ({
    code: err?.code ?? 'PROCESSING_ERROR',
    user_message: err?.message ?? String(err),
  })),
}));
jest.mock('../../services/analyticsService', () => ({ recordPostAnalytics: jest.fn(async () => undefined) }));
jest.mock('../../services/analyticsNormalizationService', () => ({ schedulePostPolls: jest.fn(async () => undefined) }));
jest.mock('../../services/activityLogger', () => ({ logActivity: jest.fn(async () => undefined) }));
jest.mock('../../services/userNotificationService', () => ({ createUserNotification: jest.fn(async () => undefined) }));
jest.mock('../../services/CampaignCompletionService', () => ({ checkAndCompleteCampaignIfEligible: jest.fn(async () => undefined) }));
jest.mock('../../security/audit/SecurityAuditService', () => ({ logSecurityEvent: jest.fn(async () => undefined) }));
jest.mock('../../services/creator/strategyAttributionResolver', () => ({
  resolveStrategyAttributionForScheduledPost: jest.fn(async () => null),
}));
jest.mock('../../services/creator/variantExperimentLifecycle', () => ({ notifyExperimentAssetPublished: jest.fn(() => undefined) }));
jest.mock('../../services/executionGovernor', () => ({ acquire: jest.fn(() => ({ ok: true, release: () => undefined })) }));
jest.mock('../../queue/bullmqClient', () => ({
  getQueue: () => ({ name: 'publish', add: async () => undefined, getJob: async () => null }),
  getEngagementPollingQueue: () => ({ add: async () => undefined }),
}));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

import type { Job } from 'bullmq';
import { publishThread, resumeThreadPublish } from '../../services/threadRuntime/threadPublishOrchestrator';
import { processPublishJob } from '../../queue/jobProcessors/publishProcessor';
import { reconcileUncertainPublish } from '../../services/publishOutcomeReconciliation';
import sweepStuckPublishing from '../../../pages/api/cron/sweep-stuck-publishing';

// ─── Fixtures ───────────────────────────────────────────────────────────────

const USER = '00000000-0000-4000-8000-0000000000a1';
const ACCOUNT = '00000000-0000-4000-8000-0000000000b1';
const STALE = (): string => new Date(Date.now() - 40 * 60 * 1000).toISOString();

/** A three-node X thread: root t0 (position 0) + children t1, t2. */
function seedThread(overrides: Record<string, Row> = {}): void {
  const base = (id: string, position: number, extra: Row): Row => ({
    id,
    user_id: USER,
    social_account_id: ACCOUNT,
    campaign_id: null,
    platform: 'twitter',
    content_type: 'thread',
    content: `node ${position}`,
    media_urls: [],
    scheduled_for: new Date(Date.now() - 60_000).toISOString(),
    status: position === 0 ? 'scheduled' : 'draft',
    platform_post_id: null,
    error_code: null,
    error_message: null,
    is_thread_start: position === 0,
    parent_post_id: position === 0 ? null : 't0',
    thread_position: position,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...extra,
    ...(overrides[id] ?? {}),
  });
  store.scheduled_posts.push(base('t0', 0, {}), base('t1', 1, {}), base('t2', 2, {}));
}
function seedThreadJob(id: string, overrides: Row = {}): void {
  store.queue_jobs.push({
    id, scheduled_post_id: 't0', job_type: 'publish', status: 'pending', attempts: 0, max_attempts: 3,
    retry_state: null, metadata: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    ...overrides,
  });
}
function delivery(id: string, attemptsMade = 0): Job<{ scheduled_post_id: string; social_account_id: string; user_id: string }> {
  return {
    id,
    data: { scheduled_post_id: 't0', social_account_id: ACCOUNT, user_id: USER },
    attemptsMade,
    opts: { attempts: 3 },
  } as unknown as Job<{ scheduled_post_id: string; social_account_id: string; user_id: string }>;
}
const node = (id: string): Row => store.scheduled_posts.find((r) => r.id === id) as Row;
const qjob = (id: string): Row => store.queue_jobs.find((r) => r.id === id) as Row;
const callsFor = (id: string): number => platformCalls.filter((c) => c.rowId === id).length;

async function runSweeper(): Promise<Row> {
  const res: { statusCode: number; body: Row | null; status: (c: number) => typeof res; json: (b: Row) => typeof res; setHeader: () => void } = {
    statusCode: 0, body: null,
    status: (c: number) => { res.statusCode = c; return res; },
    json: (b: Row) => { res.body = b; return res; },
    setHeader: () => undefined,
  };
  await (sweepStuckPublishing as unknown as (rq: Row, rs: typeof res) => Promise<void>)(
    { method: 'POST', headers: { authorization: 'Bearer thread-test-secret' } }, res);
  return res.body as Row;
}

const ORIGINAL_SECRET = process.env.CRON_SECRET;
beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  for (const t of ['scheduled_posts', 'queue_jobs', 'queue_job_logs', 'campaigns', 'daily_content_plans', 'worker_dead_letter_queue']) store[t] = [];
  writeLock = Promise.resolve();
  platformCalls.length = 0;
  outcomeFor.clear();
  duringCall = null;
  postUpdateFault = null;
  process.env.CRON_SECRET = 'thread-test-secret';
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL_SECRET;
});

// ─── Crash timing ───────────────────────────────────────────────────────────

describe('R3 — a crash at each point of a node publish', () => {
  test('crash BEFORE any node was claimed (job processing, every node untouched): the stall re-delivery publishes each node once', async () => {
    seedThread();
    seedThreadJob('qj-1', { status: 'processing', updated_at: STALE(), metadata: {} });

    await processPublishJob(delivery('qj-1'));
    expect(platformCalls.map((c) => c.rowId)).toEqual(['t0', 't1', 't2']);
    expect(platformCalls[1].replyTo).toMatch(/^tw_t0_/);
    for (const id of ['t0', 't1', 't2']) expect(node(id).status).toBe('published');
    expect(qjob('qj-1').status).toBe('completed');
  });

  test('crash AFTER the marker was persisted but before the call: indistinguishable from a crash during it — no automatic call', async () => {
    // The worker's own authorization only admits a root that is scheduled /
    // publishing / failed, so a queue re-delivery reaches the orchestrator
    // through the root: the interrupted node here is the root itself.
    seedThread({ t0: { status: 'publishing', error_code: 'PUBLISH_CALL_STARTED', updated_at: STALE() } });
    seedThreadJob('qj-1', { status: 'processing', updated_at: STALE() });

    await runSweeper();
    expect(node('t0')).toMatchObject({ status: 'failed', error_code: 'PUBLISH_OUTCOME_UNCERTAIN' });

    await expect(processPublishJob(delivery('qj-1'))).resolves.toBeUndefined();
    expect(platformCalls).toHaveLength(0);
    expect(qjob('qj-1')).toMatchObject({ status: 'failed', error_code: 'PUBLISH_OUTCOME_UNCERTAIN', retry_state: 'exhausted' });
    expect(node('t1').status).toBe('blocked');
  });

  test('the platform ACCEPTED the node, then the worker crashed before saving it: sweep + re-delivery never call again', async () => {
    seedThread();
    seedThreadJob('qj-1');
    // The "crash": the success write never lands (the process died there).
    postUpdateFault = (payload) => (payload.status === 'published' ? { code: '08006', message: 'terminating connection' } : null);
    // The root publishes; the crash hits its success write.
    await expect(processPublishJob(delivery('qj-1'))).rejects.toThrow('terminating connection');
    expect(callsFor('t0')).toBe(1);
    expect(node('t0')).toMatchObject({ status: 'publishing', error_code: 'PUBLISH_CALL_STARTED', platform_post_id: null });

    // BullMQ retries straight away (before any sweep): the node is still in flight.
    await processPublishJob(delivery('qj-1', 1));
    expect(callsFor('t0')).toBe(1);

    // 10+ minutes later the sweeper labels it; the 30–60 min stall re-delivery arrives.
    node('t0').updated_at = STALE();
    await runSweeper();
    expect(node('t0')).toMatchObject({ status: 'failed', error_code: 'PUBLISH_OUTCOME_UNCERTAIN' });
    qjob('qj-1').status = 'processing';
    qjob('qj-1').updated_at = STALE();
    await processPublishJob(delivery('qj-1', 2));

    expect(platformCalls).toHaveLength(1);
    expect(node('t1').status).toBe('blocked'); // parked behind the uncertain root, never published
  });

  test('the PREVIOUS sweeper (status only) left PUBLISH_CALL_STARTED on a failed node: still no call', async () => {
    seedThread({
      t0: { status: 'failed', error_code: 'PUBLISH_CALL_STARTED', error_message: 'Stuck in publishing state for >= 600s — swept' },
    });
    seedThreadJob('qj-1', { status: 'failed', retry_state: 'awaiting_retry' });

    await processPublishJob(delivery('qj-1', 1));
    expect(platformCalls).toHaveLength(0);
    expect(node('t0').error_code).toBe('PUBLISH_OUTCOME_UNCERTAIN');
    expect(String(node('t0').error_message)).toContain('previous: Stuck in publishing state');
  });

  test('a pre-change failed node with NO code (old orchestrator / old sweeper) is treated as uncertain', async () => {
    seedThread({
      t0: { status: 'published', platform_post_id: 'tw_root' },
      t1: { status: 'failed', error_code: null, error_message: 'Stuck in publishing state for >= 600s — swept' },
    });

    const r = await resumeThreadPublish({ root_scheduled_post_id: 't0' });
    expect(platformCalls).toHaveLength(0);
    expect(r).toMatchObject({ status: 'FAILED', uncertain: true });
    expect(node('t1').error_code).toBe('PUBLISH_OUTCOME_UNCERTAIN');
  });
});

// ─── Operator resume ────────────────────────────────────────────────────────

describe('R3 — super-admin resume consults the same durable state', () => {
  test('resume of a thread with an uncertain node: zero calls, the run reports uncertain', async () => {
    seedThread({
      t0: { status: 'published', platform_post_id: 'tw_root' },
      t1: { status: 'failed', error_code: 'PUBLISH_OUTCOME_UNCERTAIN' },
    });
    const r = await resumeThreadPublish({ root_scheduled_post_id: 't0' });
    expect(platformCalls).toHaveLength(0);
    expect(r).toMatchObject({ status: 'FAILED', uncertain: true, failed_at_position: 1, published_count: 1 });
    expect(node('t2').status).toBe('blocked'); // downstream parked, not published
  });

  test('resume while a node is still publishing (live run or unswept crash): zero calls and the rest is left alone', async () => {
    seedThread({
      t0: { status: 'published', platform_post_id: 'tw_root' },
      t1: { status: 'publishing', error_code: 'PUBLISH_CALL_STARTED' },
    });
    const r = await resumeThreadPublish({ root_scheduled_post_id: 't0' });
    expect(platformCalls).toHaveLength(0);
    expect(r).toMatchObject({ uncertain: true });
    expect(node('t1').status).toBe('publishing');
    expect(node('t2').status).toBe('draft'); // a live run's own CAS must still succeed
  });

  test('only ONE node is uncertain: published siblings are untouched, nothing after it runs, and after reconciliation resume finishes the thread', async () => {
    seedThread({
      t0: { status: 'published', platform_post_id: 'tw_root' },
      t1: { status: 'failed', error_code: 'PUBLISH_OUTCOME_UNCERTAIN' },
    });
    await resumeThreadPublish({ root_scheduled_post_id: 't0' });
    expect(platformCalls).toHaveLength(0);
    expect(node('t0')).toMatchObject({ status: 'published', platform_post_id: 'tw_root' });

    // The operator checked X: t1 is NOT there.
    await expect(reconcileUncertainPublish({
      scheduledPostId: 't1', resolution: 'not_published', actorUserId: USER, note: 'not on the timeline',
    })).resolves.toMatchObject({ status: 'reconciled' });

    const r = await resumeThreadPublish({ root_scheduled_post_id: 't0' });
    expect(r).toMatchObject({ status: 'PUBLISHED' });
    expect(platformCalls.map((c) => c.rowId)).toEqual(['t1', 't2']);
    expect(platformCalls[0].replyTo).toBe('tw_root');
    expect(callsFor('t0')).toBe(0);
  });

  test("reconciled 'published': the recorded id becomes the reply target and the node is never called", async () => {
    seedThread({
      t0: { status: 'published', platform_post_id: 'tw_root' },
      t1: { status: 'failed', error_code: 'PUBLISH_OUTCOME_UNCERTAIN' },
    });
    await reconcileUncertainPublish({
      scheduledPostId: 't1', resolution: 'published', platformPostId: 'tw_found', actorUserId: USER, note: 'found it',
    });
    await resumeThreadPublish({ root_scheduled_post_id: 't0' });
    expect(platformCalls.map((c) => c.rowId)).toEqual(['t2']);
    expect(platformCalls[0].replyTo).toBe('tw_found');
  });
});

// ─── R5 on thread nodes ─────────────────────────────────────────────────────

describe('R3/R5 — adapter outcomes on a thread node', () => {
  test('an ambiguous node failure is recorded uncertain; the queue job ends without a BullMQ retry; later deliveries call nothing', async () => {
    seedThread();
    seedThreadJob('qj-1');
    outcomeFor.set('t1', { success: false, error: { code: 'TWITTER_API_ERROR', message: 'Request failed with status code 503', retryable: true } });

    await expect(processPublishJob(delivery('qj-1'))).resolves.toBeUndefined();
    expect(node('t0').status).toBe('published');
    expect(node('t1')).toMatchObject({ status: 'failed', error_code: 'PUBLISH_OUTCOME_UNCERTAIN' });
    expect(qjob('qj-1')).toMatchObject({ status: 'failed', error_code: 'PUBLISH_OUTCOME_UNCERTAIN', retry_state: 'exhausted' });

    await processPublishJob(delivery('qj-1', 1));
    expect(platformCalls.map((c) => c.rowId)).toEqual(['t0', 't1']);
  });

  test('an adapter throw on a node is uncertain too', async () => {
    seedThread();
    outcomeFor.set('t0', 'throw');
    const r = await publishThread({ root_scheduled_post_id: 't0', social_account_id: ACCOUNT, user_id: USER });
    expect(r).toMatchObject({ uncertain: true });
    expect(node('t0').error_code).toBe('PUBLISH_OUTCOME_UNCERTAIN');
  });

  test('a success without an id on a node is uncertain (never "published", never retried)', async () => {
    seedThread();
    outcomeFor.set('t0', { success: true });
    const r = await publishThread({ root_scheduled_post_id: 't0', social_account_id: ACCOUNT, user_id: USER });
    expect(r).toMatchObject({ uncertain: true });
    expect(node('t0')).toMatchObject({ status: 'failed', error_code: 'PUBLISH_OUTCOME_UNCERTAIN', platform_post_id: null });
  });

  test('a CONFIRMED rejection on the root stays an ordinary failure WITH its code, and the BullMQ retry publishes the thread', async () => {
    seedThread();
    seedThreadJob('qj-1');
    outcomeFor.set('t0', { success: false, error: { code: 'TWITTER_RATE_LIMIT', message: 'Too Many Requests', retryable: true } });

    await expect(processPublishJob(delivery('qj-1'))).rejects.toThrow('Too Many Requests');
    expect(node('t0')).toMatchObject({ status: 'failed', error_code: 'TWITTER_RATE_LIMIT' });
    expect(qjob('qj-1').retry_state).toBe('awaiting_retry');

    outcomeFor.delete('t0');
    await processPublishJob(delivery('qj-1', 1));
    expect(platformCalls.map((c) => c.rowId)).toEqual(['t0', 't0', 't1', 't2']);
    for (const id of ['t0', 't1', 't2']) expect(node(id).status).toBe('published');
  });

  test('a CONFIRMED rejection on a child stays an ordinary failure WITH its code, and resume republishes only that node onward', async () => {
    seedThread();
    outcomeFor.set('t1', { success: false, error: { code: 'TWITTER_RATE_LIMIT', message: 'Too Many Requests', retryable: true } });
    const first = await publishThread({ root_scheduled_post_id: 't0', social_account_id: ACCOUNT, user_id: USER });
    expect(first.uncertain).toBeUndefined();
    expect(node('t1')).toMatchObject({ status: 'failed', error_code: 'TWITTER_RATE_LIMIT' });

    outcomeFor.delete('t1');
    await resumeThreadPublish({ root_scheduled_post_id: 't0' });
    expect(platformCalls.map((c) => c.rowId)).toEqual(['t0', 't1', 't1', 't2']);
    expect(node('t2').status).toBe('published');
  });

  test('every node call is preceded by PUBLISH_CALL_STARTED on that node; success clears it', async () => {
    seedThread();
    const seen: Row[] = [];
    duringCall = async (rowId) => { seen.push({ id: rowId, ...node(rowId) }); };
    await publishThread({ root_scheduled_post_id: 't0', social_account_id: ACCOUNT, user_id: USER });
    expect(seen.map((s) => [s.id, s.status, s.error_code])).toEqual([
      ['t0', 'publishing', 'PUBLISH_CALL_STARTED'],
      ['t1', 'publishing', 'PUBLISH_CALL_STARTED'],
      ['t2', 'publishing', 'PUBLISH_CALL_STARTED'],
    ]);
    for (const id of ['t0', 't1', 't2']) expect(node(id).error_code).toBeNull();
  });

  test('the node marker write fails: no call for that node, and it is given back as a retryable not-attempted failure', async () => {
    seedThread();
    postUpdateFault = (payload) => (payload.error_code === 'PUBLISH_CALL_STARTED' ? { code: '08006', message: 'connection terminated' } : null);
    const r = await publishThread({ root_scheduled_post_id: 't0', social_account_id: ACCOUNT, user_id: USER });
    expect(platformCalls).toHaveLength(0);
    expect(r.uncertain).toBeUndefined();
    expect(node('t0')).toMatchObject({ status: 'failed', error_code: 'PUBLISH_NOT_ATTEMPTED' });

    await publishThread({ root_scheduled_post_id: 't0', social_account_id: ACCOUNT, user_id: USER });
    expect(platformCalls.map((c) => c.rowId)).toEqual(['t0', 't1', 't2']);
  });
});

// ─── Duplicate and concurrent delivery ──────────────────────────────────────

describe('R3 — duplicate and concurrent delivery of the same thread', () => {
  test('two concurrent runs of the same thread: every node is called exactly once', async () => {
    seedThread();
    await Promise.all([
      publishThread({ root_scheduled_post_id: 't0', social_account_id: ACCOUNT, user_id: USER }),
      publishThread({ root_scheduled_post_id: 't0', social_account_id: ACCOUNT, user_id: USER }),
    ]);
    for (const id of ['t0', 't1', 't2']) expect(callsFor(id)).toBeLessThanOrEqual(1);
    expect(callsFor('t0')).toBe(1);
  });

  test('a duplicate delivery arriving while a node is mid-call does not call it again', async () => {
    seedThread();
    duringCall = async (rowId) => {
      if (rowId !== 't1') return;
      duringCall = null;
      await resumeThreadPublish({ root_scheduled_post_id: 't0' }); // lands mid-call
    };
    await publishThread({ root_scheduled_post_id: 't0', social_account_id: ACCOUNT, user_id: USER });
    expect(platformCalls.map((c) => c.rowId)).toEqual(['t0', 't1', 't2']);
    for (const id of ['t0', 't1', 't2']) expect(node(id).status).toBe('published');
  });
});

// ─── Closure-003 — the sweeper judges a stuck row by what it proves ─────────

describe('Closure-003 — sweeper: pre-call claims vs possibly-started calls', () => {
  const singlePost = (over: Row): void => {
    store.scheduled_posts.push({
      id: 'sp-1', user_id: USER, social_account_id: ACCOUNT, campaign_id: null, platform: 'twitter',
      content_type: 'tweet', content: 'single', media_urls: [], scheduled_for: new Date(Date.now() - 60_000).toISOString(),
      platform_post_id: null, error_message: null, is_thread_start: false, parent_post_id: null, thread_position: null,
      created_at: new Date().toISOString(), updated_at: STALE(), ...over,
    });
  };
  const singleJob = (over: Row = {}): void => {
    store.queue_jobs.push({
      id: 'qj-s', scheduled_post_id: 'sp-1', job_type: 'publish', status: 'pending', attempts: 0, max_attempts: 3,
      retry_state: null, metadata: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...over,
    });
  };
  const singleDelivery = (attemptsMade = 0) => ({
    id: 'qj-s', data: { scheduled_post_id: 'sp-1', social_account_id: ACCOUNT, user_id: USER }, attemptsMade, opts: { attempts: 3 },
  }) as unknown as Parameters<typeof processPublishJob>[0];

  test('direct publish-now died after its marker (PUBLISH_CALL_STARTED): sweep → uncertain → a queue delivery calls nothing', async () => {
    singlePost({ status: 'publishing', error_code: 'PUBLISH_CALL_STARTED' });
    singleJob();
    await runSweeper();
    expect(node('sp-1')).toMatchObject({ status: 'failed', error_code: 'PUBLISH_OUTCOME_UNCERTAIN' });

    await processPublishJob(singleDelivery());
    expect(callsFor('sp-1')).toBe(0);
    expect(qjob('qj-s')).toMatchObject({ status: 'failed', error_code: 'PUBLISH_OUTCOME_UNCERTAIN' });
  });

  test('a legacy stuck row with no claim token is labelled uncertain (nothing proves its call did not start)', async () => {
    singlePost({ status: 'publishing', error_code: null });
    await runSweeper();
    expect(node('sp-1')).toMatchObject({ status: 'failed', error_code: 'PUBLISH_OUTCOME_UNCERTAIN' });
  });

  test('a stuck PRE-CALL claim is swept to a retryable PUBLISH_NOT_ATTEMPTED, and the next delivery publishes once', async () => {
    singlePost({ status: 'publishing', error_code: 'PUBLISH_CLAIMED:dead-holder' });
    singleJob();
    const body = await runSweeper();
    expect(body).toMatchObject({ swept: 1 });
    expect(node('sp-1')).toMatchObject({ status: 'failed', error_code: 'PUBLISH_NOT_ATTEMPTED' });

    await processPublishJob(singleDelivery());
    expect(callsFor('sp-1')).toBe(1);
    expect(node('sp-1').status).toBe('published');
  });

  test('the sweep fences a node holder that is still alive before its call: it never calls; resume then publishes once', async () => {
    seedThread();
    const pn = jest.requireMock('../../services/publishNowService') as { refreshScheduledPostMediaFromRefs: jest.Mock };
    pn.refreshScheduledPostMediaFromRefs.mockImplementationOnce(async () => {
      // The run holds t0 with a pre-call claim and stalls past the threshold.
      expect(String(node('t0').error_code)).toMatch(/^PUBLISH_CLAIMED:/);
      node('t0').updated_at = STALE();
      await runSweeper();
      expect(node('t0')).toMatchObject({ status: 'failed', error_code: 'PUBLISH_NOT_ATTEMPTED' });
    });

    const r = await publishThread({ root_scheduled_post_id: 't0', social_account_id: ACCOUNT, user_id: USER });
    expect(callsFor('t0')).toBe(0); // its marker write no longer matches its token
    expect(r.uncertain).toBeUndefined();

    await resumeThreadPublish({ root_scheduled_post_id: 't0' });
    expect(platformCalls.map((c) => c.rowId)).toEqual(['t0', 't1', 't2']);
  });

  test('a sweep racing a holder that has just recorded its call start does not overwrite it', async () => {
    seedThread();
    duringCall = async (rowId) => {
      if (rowId !== 't0') return;
      duringCall = null;
      node('t0').updated_at = STALE();
      await runSweeper(); // row says PUBLISH_CALL_STARTED → uncertain, by evidence
    };
    await publishThread({ root_scheduled_post_id: 't0', social_account_id: ACCOUNT, user_id: USER });
    // The holder's success write is CAS on 'publishing' and loses to the sweep:
    // the node is recorded uncertain (never 'published' by inference), and
    // nothing calls the platform for it again.
    expect(node('t0')).toMatchObject({ status: 'failed', error_code: 'PUBLISH_OUTCOME_UNCERTAIN' });
    await resumeThreadPublish({ root_scheduled_post_id: 't0' });
    expect(callsFor('t0')).toBe(1);
  });
});
