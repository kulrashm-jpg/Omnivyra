/**
 * Publish-retry reliability — durable cancellation and retry state.
 *
 * Drives the REAL publish worker (`processPublishJob`, through the real
 * `runJob` runner and the real `backend/db/queries` writers), the REAL cancel
 * helper, the REAL duplicate guards and the REAL manual-retry route over one
 * in-memory, Postgres-shaped store. Nothing is published; the platform adapter
 * is the only stubbed boundary that matters.
 *
 * The store models the properties the design depends on:
 *   - a conditional UPDATE reports exactly the rows it changed, evaluated at
 *     write time against the current row (the loser of a race matches zero);
 *   - writes serialise, so an await-interleaved test sees row-at-a-time
 *     semantics;
 *   - the partial unique index uidx_queue_jobs_live_job_per_post (23505 on a
 *     second pending/processing row for a post);
 *   - SCHEMA VERSIONS: with `schema.migrated = false` the queue_jobs table has
 *     no retry_state column — an update naming it fails PGRST204 and a filter
 *     or select naming it fails 42703, exactly as PostgREST does — so the
 *     pre-migration fallbacks are exercised against the real failure shape.
 *
 * BullMQ is modelled as a registry of job ids: `remove()` can be made to throw
 * (an active, locked job) or the job can be absent (still in the in-memory
 * overflow buffer), which is how a cancelled row's job survives cancellation.
 */

type Row = Record<string, unknown>;
type DbError = { code: string; message: string };
type Result = { data: unknown; error: DbError | null };

const store: Record<string, Row[]> = {};
const schema = { migrated: true };

/** Runs inside the serialised write, BEFORE the predicate is evaluated. */
let beforeQueueJobUpdate: ((payload: Row) => void) | null = null;
/** Returns an error to fail a queue_jobs write/read with, or null to proceed. */
let queueJobFault: ((op: 'select' | 'update', payload: Row | null, filters: Filters) => DbError | null) | null = null;

type Filters = {
  eq: Record<string, unknown>;
  in: Record<string, unknown[]>;
  is: Record<string, unknown>;
  lte: Record<string, unknown>;
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
  for (const [k, v] of Object.entries(f.lte)) {
    if (row[k] == null || String(row[k]) > String(v)) return false;
  }
  for (const [k, criteria] of Object.entries(f.contains)) {
    const col = row[k];
    if (col == null || typeof col !== 'object') return false;
    if (!Object.entries(criteria).every(([ck, cv]) => (col as Row)[ck] === cv)) return false;
  }
  return true;
}

const LIVE = ['pending', 'processing'];

function missingColumnError(op: 'select' | 'update'): DbError {
  return op === 'update'
    ? { code: 'PGRST204', message: "Could not find the 'retry_state' column of 'queue_jobs' in the schema cache" }
    : { code: '42703', message: 'column queue_jobs.retry_state does not exist' };
}

interface Chain {
  select: (cols?: string) => Chain;
  insert: (rows: Row | Row[]) => Chain;
  update: (payload: Row) => Chain;
  eq: (k: string, v: unknown) => Chain;
  in: (k: string, v: unknown[]) => Chain;
  is: (k: string, v: unknown) => Chain;
  lte: (k: string, v: unknown) => Chain;
  lt: (k: string, v: unknown) => Chain;
  contains: (k: string, v: Row) => Chain;
  order: () => Chain;
  limit: () => Chain;
  single: () => Promise<Result>;
  maybeSingle: () => Promise<Result>;
  then: <A, B = never>(ok: (r: Result) => A, err?: (e: unknown) => B) => Promise<A | B>;
}

function buildChain(table: string): Chain {
  if (!store[table]) store[table] = [];
  const f: Filters = { eq: {}, in: {}, is: {}, lte: {}, contains: {} };
  let selectCols = '';
  let updatePayload: Row | null = null;
  let insertRows: Row[] | null = null;

  const namesRetryState = (): boolean =>
    selectCols.includes('retry_state') ||
    'retry_state' in f.eq || 'retry_state' in f.in || 'retry_state' in f.is;

  const settle = (): Promise<Result> => serialised((): Result => {
    const rows = store[table];
    if (insertRows) {
      const created: Row[] = [];
      for (const incoming of insertRows) {
        if (
          table === 'queue_jobs' &&
          LIVE.includes(String(incoming.status)) &&
          rows.some((r) => r.scheduled_post_id === incoming.scheduled_post_id && LIVE.includes(String(r.status)))
        ) {
          return {
            data: null,
            error: {
              code: '23505',
              message: 'duplicate key value violates unique constraint "uidx_queue_jobs_live_job_per_post"',
            },
          };
        }
        const row: Row = {
          id: incoming.id ?? `${table}-${rows.length + created.length + 1}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...(table === 'queue_jobs' && schema.migrated ? { retry_state: null } : {}),
          ...incoming,
        };
        created.push(row);
      }
      rows.push(...created);
      return { data: created, error: null };
    }

    if (table === 'queue_jobs') {
      const op = updatePayload ? 'update' : 'select';
      if (!schema.migrated) {
        if (updatePayload && 'retry_state' in updatePayload) return { data: null, error: missingColumnError('update') };
        if (namesRetryState()) return { data: null, error: missingColumnError('select') };
      }
      const fault = queueJobFault?.(op, updatePayload, f) ?? null;
      if (fault) return { data: null, error: fault };
      if (updatePayload && beforeQueueJobUpdate) {
        const hook = beforeQueueJobUpdate;
        beforeQueueJobUpdate = null;
        hook(updatePayload);
      }
    }

    const hit = rows.filter((r) => rowMatches(r, f));
    if (updatePayload) {
      const payload = updatePayload;
      hit.forEach((r) => Object.assign(r, payload));
    }
    return { data: hit.map((r) => ({ ...r })), error: null };
  });

  const chain: Chain = {
    select: (cols?: string) => { selectCols = cols ?? '*'; return chain; },
    insert: (r: Row | Row[]) => { insertRows = Array.isArray(r) ? r : [r]; return chain; },
    update: (p: Row) => { updatePayload = p; return chain; },
    eq: (k: string, v: unknown) => { f.eq[k] = v; return chain; },
    in: (k: string, v: unknown[]) => { f.in[k] = v; return chain; },
    is: (k: string, v: unknown) => { f.is[k] = v; return chain; },
    lte: (k: string, v: unknown) => { f.lte[k] = v; return chain; },
    lt: () => chain,
    contains: (k: string, v: Row) => { f.contains[k] = v; return chain; },
    order: () => chain,
    limit: () => chain,
    single: async () => {
      const r = await settle();
      if (r.error) return r;
      const list = r.data as Row[];
      return list[0] ? { data: list[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
    },
    maybeSingle: async () => {
      const r = await settle();
      if (r.error) return r;
      const list = r.data as Row[];
      if (list.length > 1) return { data: null, error: { code: 'PGRST116', message: 'multiple rows returned' } };
      return { data: list[0] ?? null, error: null };
    },
    then: (ok, err) => settle().then(ok, err),
  };
  return chain;
}

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => buildChain(table),
    rpc: async () => ({ data: null, error: { message: 'rpc missing' } }),
  },
}));

// ─── BullMQ ─────────────────────────────────────────────────────────────────

/** Job ids BullMQ currently holds. A job absent here is still in overflow. */
const bullJobs = new Set<string>();
const bullAdds: Array<{ name: string; data: Row; opts: Row }> = [];
const bullRemoved: string[] = [];
/** Job ids whose remove() throws — an active job holding its lock. */
const lockedJobs = new Set<string>();

jest.mock('../../queue/bullmqClient', () => ({
  getQueue: () => ({
    name: 'publish',
    getJobCounts: async () => ({ waiting: 0, active: 0, delayed: 0, prioritized: 0 }),
    add: async (name: string, data: Row, opts: Row) => {
      bullAdds.push({ name, data, opts });
      bullJobs.add(String(opts.jobId));
      return { id: opts.jobId };
    },
    addBulk: async (jobs: Array<{ name: string; data: Row; opts: Row }>) => {
      for (const j of jobs) {
        bullAdds.push(j);
        bullJobs.add(String(j.opts.jobId));
      }
      return jobs.map((j) => ({ id: j.opts.jobId }));
    },
    getJob: async (id: string) => {
      if (!bullJobs.has(id)) return null;
      return {
        id,
        remove: async () => {
          if (lockedJobs.has(id)) throw new Error(`Job ${id} could not be removed because it is locked by another worker`);
          bullJobs.delete(id);
          bullRemoved.push(id);
        },
      };
    },
  }),
  getEngagementPollingQueue: () => ({ add: async () => undefined }),
}));

// ─── Platform boundary + peripheral collaborators ───────────────────────────

const platformCalls: string[] = [];
let platformOutcome: 'success' | 'failure' = 'success';
/** Runs while the platform call is in flight (after the job claim). */
let duringPlatformCall: (() => Promise<void>) | null = null;

jest.mock('../../adapters/platformAdapter', () => ({
  publishToPlatform: jest.fn(async (scheduledPostId: string) => {
    platformCalls.push(scheduledPostId);
    if (duringPlatformCall) {
      const hook = duringPlatformCall;
      duringPlatformCall = null;
      await hook();
    }
    if (platformOutcome === 'failure') {
      // A real adapter code for an explicit 429 rejection (linkedinAdapter): a
      // CONFIRMED "nothing was created" failure, which retries. (Was the
      // made-up 'RATE_LIMITED', which no adapter emits — an unknown code is now
      // an uncertain outcome; see backend/queue/publishOutcome.ts.)
      return { success: false, error: { code: 'LINKEDIN_RATE_LIMIT', message: 'slow down', retryable: true } };
    }
    return {
      success: true,
      platform_post_id: `plat_${scheduledPostId}_${platformCalls.length}`,
      post_url: `https://example.test/${scheduledPostId}`,
      published_at: new Date(),
    };
  }),
}));
jest.mock('../../services/threadRuntime/threadPublishOrchestrator', () => ({
  publishThread: jest.fn(async () => ({ status: 'PUBLISHED', root_id: 'x', total_nodes: 1, published_count: 1 })),
}));
jest.mock('../../services/publishReadinessValidator', () => ({
  validatePublishReadiness: jest.fn(() => ({ ok: true, warnings: [] })),
}));
jest.mock('../../services/mediaReferenceResolver', () => ({
  refreshDurableMediaBeforePublish: jest.fn(async () => undefined),
}));
jest.mock('../../services/publishNowService', () => {
  const actual = jest.requireActual('../../services/publishNowService');
  return { ...actual, refreshScheduledPostMediaFromRefs: jest.fn(async () => undefined) };
});
jest.mock('../../services/creator/publishingOrganizationResolver', () => ({
  resolvePublishingOrganization: jest.fn(async () => null),
}));
jest.mock('../../services/creator/creatorPublishResolution', () => ({
  resolvePublishMedia: jest.fn(async () => ({ mediaUrls: [], resolvedCount: 0 })),
}));
jest.mock('../../services/creatorQueueReliabilityService', () => ({
  recordPublishFailure: jest.fn(async () => undefined),
}));
jest.mock('../../services/errorRecoveryService', () => ({
  categorizeError: jest.fn((_platform: string, err: { code?: string; message?: string } | undefined) => ({
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
jest.mock('../../services/creator/variantExperimentLifecycle', () => ({
  notifyExperimentAssetPublished: jest.fn(() => undefined),
}));
jest.mock('../../services/executionGovernor', () => ({
  acquire: jest.fn(() => ({ ok: true, release: () => undefined })),
}));

const USER = '00000000-0000-4000-8000-0000000000a1';
const ACCOUNT = '00000000-0000-4000-8000-0000000000b1';

jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: jest.fn(async () => ({ user: { id: '00000000-0000-4000-8000-0000000000a1' }, error: null })),
}));

import type { Job } from 'bullmq';
import { processPublishJob } from '../../queue/jobProcessors/publishProcessor';
import {
  cancelScheduledPostQueueEntry,
  enqueueScheduledPostAt,
  atomicCancelAndReEnqueueScheduledPost,
  findDuePostsAndEnqueue,
} from '../../scheduler/schedulerService';
import retryRoute from '../../../pages/api/scheduler/retry';

// ─── Fixtures ───────────────────────────────────────────────────────────────

function seedPost(id: string, overrides: Row = {}): Row {
  const row: Row = {
    id,
    user_id: USER,
    social_account_id: ACCOUNT,
    campaign_id: null,
    platform: 'linkedin',
    content_type: 'post',
    content: 'body',
    media_urls: [],
    scheduled_for: new Date(Date.now() - 60_000).toISOString(),
    status: 'scheduled',
    platform_post_id: null,
    is_thread_start: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
  store.scheduled_posts.push(row);
  return row;
}

/** Seeds a queue_jobs row; BullMQ holds its job unless `inBull: false`. */
function seedJob(id: string, scheduledPostId: string, overrides: Row = {}, inBull = true): Row {
  const row: Row = {
    id,
    scheduled_post_id: scheduledPostId,
    job_type: 'publish',
    status: 'pending',
    attempts: 0,
    max_attempts: 3,
    scheduled_for: new Date(Date.now() - 60_000).toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...(schema.migrated ? { retry_state: null } : {}),
    ...overrides,
  };
  store.queue_jobs.push(row);
  if (inBull) bullJobs.add(id);
  return row;
}

/** One BullMQ delivery of `id`; `attemptsMade` = failed deliveries before it. */
function delivery(id: string, scheduledPostId: string, attemptsMade = 0): Job<{ scheduled_post_id: string; social_account_id: string; user_id: string }> {
  return {
    id,
    data: { scheduled_post_id: scheduledPostId, social_account_id: ACCOUNT, user_id: USER },
    attemptsMade,
    opts: { attempts: 3 },
  } as unknown as Job<{ scheduled_post_id: string; social_account_id: string; user_id: string }>;
}

const post = (id: string): Row => store.scheduled_posts.find((r) => r.id === id) as Row;
const qjob = (id: string): Row => store.queue_jobs.find((r) => r.id === id) as Row;
const publishesFor = (id: string): number => platformCalls.filter((p) => p === id).length;
const jobsFor = (postId: string): Row[] => store.queue_jobs.filter((r) => r.scheduled_post_id === postId);
/** Rows that can still lead to a publish: pending, processing, or awaiting a BullMQ retry. */
const liveJobsFor = (postId: string): Row[] =>
  jobsFor(postId).filter(
    (r) => LIVE.includes(String(r.status)) || (r.status === 'failed' && r.retry_state === 'awaiting_retry'),
  );
const FUTURE = (): string => new Date(Date.now() + 10 * 60 * 1000).toISOString();

type RouteRes = {
  statusCode: number;
  body: Row | null;
  status: (code: number) => RouteRes;
  json: (body: Row) => RouteRes;
  setHeader: (name: string, value: string) => void;
};
function createRes(): RouteRes {
  const res: RouteRes = {
    statusCode: 200,
    body: null,
    status: (code: number) => { res.statusCode = code; return res; },
    json: (body: Row) => { res.body = body; return res; },
    setHeader: () => undefined,
  };
  return res;
}
async function callRetry(scheduledPostId: string): Promise<RouteRes> {
  const res = createRes();
  const req = { method: 'POST', headers: {}, query: {}, body: { scheduled_post_id: scheduledPostId } };
  await (retryRoute as unknown as (rq: typeof req, rs: RouteRes) => Promise<void>)(req, res);
  return res;
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  for (const t of ['scheduled_posts', 'queue_jobs', 'queue_job_logs', 'campaigns', 'worker_dead_letter_queue']) store[t] = [];
  schema.migrated = true;
  beforeQueueJobUpdate = null;
  queueJobFault = null;
  writeLock = Promise.resolve();
  bullJobs.clear();
  bullAdds.length = 0;
  bullRemoved.length = 0;
  lockedJobs.clear();
  platformCalls.length = 0;
  platformOutcome = 'success';
  duringPlatformCall = null;
});

// ─── Step 1 — database cancellation is authoritative in the processor ──────

describe('Step 1 — the processor obeys database cancellation', () => {
  test('a cancelled job whose BullMQ job survived job.remove() is delivered and does NOT publish', async () => {
    seedPost('sp-1');
    seedJob('qj-1', 'sp-1');
    lockedJobs.add('qj-1'); // remove() throws: BullMQ is holding the job

    const cancel = await cancelScheduledPostQueueEntry('sp-1', { reason: 'user_unscheduled' });
    expect(cancel.db_cancelled).toBe(1);
    expect(cancel.queue_removed).toBe(0);
    expect(cancel.errors.some((e) => e.startsWith('bullmq remove(qj-1)'))).toBe(true);
    expect(bullJobs.has('qj-1')).toBe(true); // the executor survived

    await expect(processPublishJob(delivery('qj-1', 'sp-1'))).resolves.toBeUndefined();

    expect(publishesFor('sp-1')).toBe(0);
    expect(qjob('qj-1').status).toBe('cancelled');
    expect(post('sp-1').status).toBe('scheduled');
  });

  test('a cancelled job still in the overflow buffer (no BullMQ job yet) does not publish once drained', async () => {
    seedPost('sp-1');
    seedJob('qj-1', 'sp-1', {}, /* inBull */ false);

    const cancel = await cancelScheduledPostQueueEntry('sp-1', { reason: 'user_unscheduled' });
    expect(cancel.db_cancelled).toBe(1);
    expect(cancel.queue_removed).toBe(0); // nothing to remove — getJob() was null

    // The drain re-adds the job under the SAME id (see the identity tests
    // below); its delivery reads the cancelled row.
    await processPublishJob(delivery('qj-1', 'sp-1'));
    expect(publishesFor('sp-1')).toBe(0);
    expect(qjob('qj-1').status).toBe('cancelled');
  });

  test('a cancel landing between the job read and the claim stops the publish (CAS, not unconditional write)', async () => {
    seedPost('sp-1');
    seedJob('qj-1', 'sp-1');
    // The first queue_jobs UPDATE of this delivery is the claim. A cancel
    // commits immediately before it is evaluated.
    beforeQueueJobUpdate = () => { qjob('qj-1').status = 'cancelled'; };

    await processPublishJob(delivery('qj-1', 'sp-1'));

    expect(publishesFor('sp-1')).toBe(0);
    expect(qjob('qj-1').status).toBe('cancelled');
    expect(post('sp-1').status).toBe('scheduled');
  });

  test('a cancel landing mid-publish is not overwritten by the failure write, and the retry does not run', async () => {
    seedPost('sp-1');
    seedJob('qj-1', 'sp-1');
    platformOutcome = 'failure';
    duringPlatformCall = async () => {
      await cancelScheduledPostQueueEntry('sp-1', { reason: 'user_unscheduled' });
    };

    await expect(processPublishJob(delivery('qj-1', 'sp-1', 0))).rejects.toThrow('slow down');
    expect(publishesFor('sp-1')).toBe(1); // the in-flight call cannot be recalled
    expect(qjob('qj-1').status).toBe('cancelled');
    expect(qjob('qj-1').retry_state).toBeNull(); // the retry-state write requires 'failed'

    // BullMQ's backoff re-delivery of the same job id.
    platformOutcome = 'success';
    await processPublishJob(delivery('qj-1', 'sp-1', 1));
    expect(publishesFor('sp-1')).toBe(1);
    expect(qjob('qj-1').status).toBe('cancelled');
  });

  test('a cancelled delivery ends quietly before any post check — no throw, so BullMQ does not retry it', async () => {
    store.campaigns.push({ id: 'c-1', status: 'paused' });
    seedPost('sp-1', { campaign_id: 'c-1' }); // would now be BLOCKED (campaign not active)
    seedJob('qj-1', 'sp-1', { status: 'cancelled' });

    await expect(processPublishJob(delivery('qj-1', 'sp-1', 0))).resolves.toBeUndefined();
    expect(publishesFor('sp-1')).toBe(0);
    expect(qjob('qj-1').status).toBe('cancelled');
  });

  test('an exhausted delivery ends quietly before any post check — no throw, no further retry', async () => {
    store.campaigns.push({ id: 'c-1', status: 'paused' });
    seedPost('sp-1', { campaign_id: 'c-1' });
    seedJob('qj-1', 'sp-1', { status: 'failed', retry_state: 'exhausted' });

    await expect(processPublishJob(delivery('qj-1', 'sp-1', 2))).resolves.toBeUndefined();
    expect(publishesFor('sp-1')).toBe(0);
    expect(qjob('qj-1').retry_state).toBe('exhausted');
  });

  test('a completed job delivered again does not publish again', async () => {
    seedPost('sp-1');
    seedJob('qj-1', 'sp-1');

    await processPublishJob(delivery('qj-1', 'sp-1'));
    expect(qjob('qj-1').status).toBe('completed');
    await processPublishJob(delivery('qj-1', 'sp-1'));

    expect(publishesFor('sp-1')).toBe(1);
    expect(qjob('qj-1').status).toBe('completed');
  });

  test('two concurrent re-deliveries of a stale processing row: only one wins the job claim', async () => {
    seedPost('sp-1');
    seedJob('qj-1', 'sp-1', {
      status: 'processing',
      updated_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(), // past the 5-minute window
    });

    await Promise.all([
      processPublishJob(delivery('qj-1', 'sp-1', 0)),
      processPublishJob(delivery('qj-1', 'sp-1', 0)),
    ]);

    expect(publishesFor('sp-1')).toBe(1);
    expect(qjob('qj-1').status).toBe('completed');
  });
});

// ─── Step 2 — durable retry state ───────────────────────────────────────────

describe('Step 2 — queue_jobs.retry_state records whether BullMQ will retry', () => {
  test('a NON-final failure leaves failed + awaiting_retry, and the backoff delivery runs and clears it', async () => {
    seedPost('sp-1');
    seedJob('qj-1', 'sp-1');
    platformOutcome = 'failure';

    await expect(processPublishJob(delivery('qj-1', 'sp-1', 0))).rejects.toThrow();
    expect(qjob('qj-1').status).toBe('failed');
    expect(qjob('qj-1').retry_state).toBe('awaiting_retry');

    platformOutcome = 'success';
    await processPublishJob(delivery('qj-1', 'sp-1', 1));
    expect(publishesFor('sp-1')).toBe(2);
    expect(qjob('qj-1').status).toBe('completed');
    expect(qjob('qj-1').retry_state).toBeNull();
  });

  test('the FINAL failure leaves failed + exhausted, and a later delivery of it does not publish', async () => {
    seedPost('sp-1');
    seedJob('qj-1', 'sp-1');
    platformOutcome = 'failure';

    await expect(processPublishJob(delivery('qj-1', 'sp-1', 2))).rejects.toThrow(); // attempt 3 of 3
    expect(qjob('qj-1').status).toBe('failed');
    expect(qjob('qj-1').retry_state).toBe('exhausted');

    // A stalled re-delivery after a crash between this write and BullMQ's own
    // failure record.
    platformOutcome = 'success';
    await processPublishJob(delivery('qj-1', 'sp-1', 2));
    expect(publishesFor('sp-1')).toBe(1);
    expect(qjob('qj-1').retry_state).toBe('exhausted');
  });

  test('an unexpected throw (not a handled platform failure) also records the retry state', async () => {
    seedPost('sp-1');
    seedJob('qj-1', 'sp-1');
    // Thrown after the claim but BEFORE the platform call (nothing was sent).
    // A throw from the platform call itself is an uncertain outcome instead —
    // see "Closure-002 R5" below.
    const media = jest.requireMock('../../services/mediaReferenceResolver') as { refreshDurableMediaBeforePublish: jest.Mock };
    media.refreshDurableMediaBeforePublish.mockImplementationOnce(async () => { throw new Error('socket hang up'); });

    await expect(processPublishJob(delivery('qj-1', 'sp-1', 0))).rejects.toThrow('socket hang up');
    expect(qjob('qj-1').status).toBe('failed');
    expect(qjob('qj-1').retry_state).toBe('awaiting_retry');
    expect(post('sp-1').status).toBe('scheduled'); // claim restored, as before
  });

  test('worker interruption: the retry-state write is lost — the row stays unknown (NULL), the original error propagates, and the row is NOT terminal', async () => {
    seedPost('sp-1');
    seedJob('qj-1', 'sp-1');
    platformOutcome = 'failure';
    queueJobFault = (op, payload) =>
      op === 'update' && payload !== null && 'retry_state' in payload && payload.retry_state !== null
        ? { code: '08006', message: 'connection terminated' }
        : null;

    await expect(processPublishJob(delivery('qj-1', 'sp-1', 0))).rejects.toThrow('slow down');
    expect(qjob('qj-1').status).toBe('failed');
    expect(qjob('qj-1').retry_state).toBeNull();

    // Unknown is not terminal: cancellation still retires it...
    const cancel = await cancelScheduledPostQueueEntry('sp-1', { reason: 'user_unscheduled' });
    expect(cancel.db_cancelled).toBe(1);
    expect(qjob('qj-1').status).toBe('cancelled');
    expect(qjob('qj-1').error_message).toBe('slow down'); // failure record preserved
  });

  test('worker interruption: an unknown (NULL) failed row is still run when BullMQ delivers it', async () => {
    seedPost('sp-1', { status: 'failed' });
    seedJob('qj-1', 'sp-1', { status: 'failed', retry_state: null });

    await processPublishJob(delivery('qj-1', 'sp-1', 1));
    expect(publishesFor('sp-1')).toBe(1);
    expect(qjob('qj-1').status).toBe('completed');
  });

  test('worker interruption: the claim write fails — nothing is published and the delivery fails for BullMQ to retry', async () => {
    seedPost('sp-1');
    seedJob('qj-1', 'sp-1');
    let failed = false;
    queueJobFault = (op, payload) => {
      if (!failed && op === 'update' && payload?.status === 'processing') {
        failed = true;
        return { code: '08006', message: 'connection terminated' };
      }
      return null;
    };

    await expect(processPublishJob(delivery('qj-1', 'sp-1', 0))).rejects.toThrow('connection terminated');
    expect(publishesFor('sp-1')).toBe(0);
    expect(post('sp-1').status).toBe('scheduled');
  });

  test('a pressure rejection (row never marked failed) records nothing — the row stays pending', async () => {
    seedPost('sp-1');
    seedJob('qj-1', 'sp-1');
    const governor = jest.requireMock('../../services/executionGovernor') as { acquire: jest.Mock };
    governor.acquire.mockImplementationOnce(() => ({ ok: false, reason: 'CONCURRENCY_LIMIT', key: 'k' }));

    await expect(processPublishJob(delivery('qj-1', 'sp-1', 2))).rejects.toThrow('PUBLISH_PRESSURE_REJECTED');
    expect(publishesFor('sp-1')).toBe(0);
    expect(qjob('qj-1').status).toBe('pending');
    expect(qjob('qj-1').retry_state).toBeNull();
  });

  test('a pressure rejection of a row already awaiting retry updates its state from the same attempt count', async () => {
    seedPost('sp-1');
    seedJob('qj-1', 'sp-1', { status: 'failed', retry_state: 'awaiting_retry' });
    const governor = jest.requireMock('../../services/executionGovernor') as { acquire: jest.Mock };
    governor.acquire.mockImplementationOnce(() => ({ ok: false, reason: 'CONCURRENCY_LIMIT', key: 'k' }));

    // The final attempt is spent on a rejection: nothing will deliver it again.
    await expect(processPublishJob(delivery('qj-1', 'sp-1', 2))).rejects.toThrow('PUBLISH_PRESSURE_REJECTED');
    expect(qjob('qj-1').status).toBe('failed');
    expect(qjob('qj-1').retry_state).toBe('exhausted');
  });
});

// ─── Step 3 — cancel / retry / reschedule see jobs awaiting retry ───────────

describe('Step 3 — cancellation covers jobs awaiting retry', () => {
  test('cancel retires awaiting_retry and unknown failed rows, removes their BullMQ jobs, and leaves exhausted rows alone', async () => {
    seedPost('sp-1');
    seedJob('qj-await', 'sp-1', { status: 'failed', retry_state: 'awaiting_retry', error_message: 'RATE_LIMITED' });
    seedJob('qj-null', 'sp-1', { status: 'failed', retry_state: null, error_message: 'OLD' });
    seedJob('qj-done', 'sp-1', { status: 'failed', retry_state: 'exhausted', error_message: 'GAVE_UP' });
    seedJob('qj-other', 'sp-2', { status: 'failed', retry_state: 'awaiting_retry' });

    const cancel = await cancelScheduledPostQueueEntry('sp-1', { reason: 'user_unscheduled' });

    expect(cancel.db_cancelled).toBe(2);
    expect(cancel.errors).toEqual([]);
    expect(qjob('qj-await').status).toBe('cancelled');
    expect(qjob('qj-null').status).toBe('cancelled');
    expect(qjob('qj-done').status).toBe('failed');
    expect(qjob('qj-other').status).toBe('failed');
    expect(qjob('qj-await').error_message).toBe('RATE_LIMITED');
    expect(bullRemoved.sort()).toEqual(['qj-await', 'qj-null']);

    // The surviving backoff delivery (had remove() failed) would now skip.
    await processPublishJob(delivery('qj-await', 'sp-1', 1));
    expect(publishesFor('sp-1')).toBe(0);
  });

  test('cancel still retires pending/processing rows with the reason, as before', async () => {
    seedPost('sp-1');
    seedJob('qj-1', 'sp-1');
    const cancel = await cancelScheduledPostQueueEntry('sp-1', { reason: 'user_unscheduled' });
    expect(cancel.db_cancelled).toBe(1);
    expect(qjob('qj-1').status).toBe('cancelled');
    expect(qjob('qj-1').error_message).toBe('user_unscheduled');
  });
});

describe('Step 3 — duplicate prevention counts jobs awaiting retry as live', () => {
  test('enqueueScheduledPostAt refuses a second job beside one awaiting retry', async () => {
    seedPost('sp-1');
    seedJob('qj-1', 'sp-1', { status: 'failed', retry_state: 'awaiting_retry' });

    expect(await enqueueScheduledPostAt('sp-1', USER, ACCOUNT, FUTURE())).toBe('duplicate');
    expect(jobsFor('sp-1')).toHaveLength(1);
    expect(bullAdds).toHaveLength(0);
  });

  test('enqueueScheduledPostAt still enqueues beside an exhausted or unknown failed row', async () => {
    seedPost('sp-1');
    seedJob('qj-1', 'sp-1', { status: 'failed', retry_state: 'exhausted' });
    seedJob('qj-2', 'sp-1', { status: 'failed', retry_state: null });

    expect(await enqueueScheduledPostAt('sp-1', USER, ACCOUNT, FUTURE())).toBe('enqueued');
    expect(liveJobsFor('sp-1')).toHaveLength(1);
  });

  test('an unreadable awaiting-retry check fails closed (throws, no insert, no BullMQ add)', async () => {
    seedPost('sp-1');
    queueJobFault = (op, _payload, f) =>
      op === 'select' && f.eq.retry_state === 'awaiting_retry' ? { code: '08006', message: 'connection reset' } : null;

    await expect(enqueueScheduledPostAt('sp-1', USER, ACCOUNT, FUTURE())).rejects.toThrow('awaiting-retry check');
    expect(jobsFor('sp-1')).toHaveLength(0);
    expect(bullAdds).toHaveLength(0);
  });

  test('the safety-net cron skips a due post whose job is awaiting retry', async () => {
    seedPost('sp-1', { scheduled_for: new Date(Date.now() - 60_000).toISOString() });
    seedPost('sp-2', { scheduled_for: new Date(Date.now() - 60_000).toISOString() });
    seedJob('qj-1', 'sp-1', { status: 'failed', retry_state: 'awaiting_retry' });

    const result = await findDuePostsAndEnqueue();

    expect(result.found).toBe(2);
    expect(result.skipped).toBe(1);
    expect(liveJobsFor('sp-1')).toHaveLength(1);
    expect(jobsFor('sp-2')).toHaveLength(1);
  });
});

describe('Step 3 — manual retry with an existing backoff job', () => {
  test('retry retires the backoff job before creating the replacement; exactly one live job and one publish', async () => {
    seedPost('sp-1', { status: 'failed' });
    seedJob('qj-old', 'sp-1', { status: 'failed', retry_state: 'awaiting_retry' });

    const res = await callRetry('sp-1');

    expect(res.statusCode).toBe(200);
    expect(res.body?.enqueue).toBe('enqueued');
    expect(qjob('qj-old').status).toBe('cancelled');
    expect(bullRemoved).toEqual(['qj-old']);
    expect(liveJobsFor('sp-1')).toHaveLength(1);
    const replacement = liveJobsFor('sp-1')[0];
    expect(bullAdds.map((a) => a.opts.jobId)).toEqual([replacement.id]);

    // Even if the old backoff job had survived removal, its delivery skips.
    await processPublishJob(delivery('qj-old', 'sp-1', 1));
    await processPublishJob(delivery(String(replacement.id), 'sp-1', 0));
    expect(publishesFor('sp-1')).toBe(1);
  });

  test('retry where the old job cannot be read: nothing is reset or enqueued (503)', async () => {
    seedPost('sp-1', { status: 'failed' });
    seedJob('qj-old', 'sp-1', { status: 'failed', retry_state: 'awaiting_retry' });
    queueJobFault = (op, _payload, f) =>
      op === 'select' && f.eq.status === 'failed' ? { code: '08006', message: 'connection reset' } : null;

    const res = await callRetry('sp-1');

    expect(res.statusCode).toBe(503);
    expect(res.body?.code).toBe('PRIOR_JOB_CANCEL_FAILED');
    expect(post('sp-1').status).toBe('failed');
    expect(jobsFor('sp-1')).toHaveLength(1);
    expect(bullAdds).toHaveLength(0);
  });

  test('retry does not overwrite a post a delivery claimed after the status check (409)', async () => {
    seedPost('sp-1', { status: 'failed' });
    // The post moves to 'publishing' while the cancel runs.
    beforeQueueJobUpdate = () => { post('sp-1').status = 'publishing'; };
    seedJob('qj-old', 'sp-1', { status: 'failed', retry_state: 'awaiting_retry' });

    const res = await callRetry('sp-1');

    expect(res.statusCode).toBe(409);
    expect(post('sp-1').status).toBe('publishing');
    expect(bullAdds).toHaveLength(0);
  });
});

describe('Step 3 — reschedule with an existing backoff job', () => {
  test('atomic reschedule retires the backoff job and enqueues exactly one job at the new time', async () => {
    seedPost('sp-1');
    seedJob('qj-old', 'sp-1', { status: 'failed', retry_state: 'awaiting_retry' });
    const newTime = FUTURE();

    const result = await atomicCancelAndReEnqueueScheduledPost({
      scheduledPostId: 'sp-1', userId: USER, socialAccountId: ACCOUNT, newScheduledFor: newTime,
    });

    expect(result.ok).toBe(true);
    expect(result.enqueue).toBe('enqueued');
    expect(qjob('qj-old').status).toBe('cancelled');
    expect(liveJobsFor('sp-1')).toHaveLength(1);
    expect(liveJobsFor('sp-1')[0].scheduled_for).toBe(newTime);
  });

  test('atomic reschedule refuses to enqueue when the backoff job could not be cancelled (no false success)', async () => {
    seedPost('sp-1');
    seedJob('qj-old', 'sp-1', { status: 'failed', retry_state: 'awaiting_retry' });
    queueJobFault = (op, payload) =>
      op === 'update' && payload?.status === 'cancelled' ? { code: '08006', message: 'connection reset' } : null;

    const result = await atomicCancelAndReEnqueueScheduledPost({
      scheduledPostId: 'sp-1', userId: USER, socialAccountId: ACCOUNT, newScheduledFor: FUTURE(),
    });

    expect(result.ok).toBe(false);
    expect(result.enqueue).toBe('failed');
    expect(qjob('qj-old').status).toBe('failed');
    expect(jobsFor('sp-1')).toHaveLength(1);
    expect(bullAdds).toHaveLength(0);
  });
});

// ─── Enqueue identity ───────────────────────────────────────────────────────

describe('enqueue identity — the BullMQ job id IS the queue_jobs row id', () => {
  test('enqueueScheduledPostAt adds the BullMQ job under the queue_jobs id it inserted', async () => {
    seedPost('sp-1');
    expect(await enqueueScheduledPostAt('sp-1', USER, ACCOUNT, FUTURE())).toBe('enqueued');
    const [row] = jobsFor('sp-1');
    expect(bullAdds).toHaveLength(1);
    expect(bullAdds[0].opts.jobId).toBe(row.id);
  });

  test('the safety-net cron adds each job under its queue_jobs id', async () => {
    seedPost('sp-1');
    seedPost('sp-2');
    const bulkAdds: Array<{ opts: Row }> = [];
    const queueModule = jest.requireMock('../../queue/bullmqClient') as { getQueue: () => Row };
    const original = queueModule.getQueue;
    queueModule.getQueue = () => ({
      ...original(),
      addBulk: async (jobs: Array<{ opts: Row }>) => { bulkAdds.push(...jobs); return jobs; },
    });
    try {
      await findDuePostsAndEnqueue();
    } finally {
      queueModule.getQueue = original;
    }
    const ids = store.queue_jobs.map((r) => r.id).sort();
    expect(bulkAdds.map((j) => j.opts.jobId).sort()).toEqual(ids);
  });
});

// ─── Mixed versions around the migration ────────────────────────────────────

describe('mixed versions — code running before migration 20261202000000 is applied', () => {
  beforeEach(() => { schema.migrated = false; });

  test('a failure still fails cleanly; the state write is skipped (column missing) and the retry still runs', async () => {
    seedPost('sp-1');
    seedJob('qj-1', 'sp-1');
    expect('retry_state' in qjob('qj-1')).toBe(false);
    platformOutcome = 'failure';

    await expect(processPublishJob(delivery('qj-1', 'sp-1', 0))).rejects.toThrow('slow down');
    expect(qjob('qj-1').status).toBe('failed');
    expect('retry_state' in qjob('qj-1')).toBe(false);

    platformOutcome = 'success';
    await processPublishJob(delivery('qj-1', 'sp-1', 1));
    expect(publishesFor('sp-1')).toBe(2);
    expect(qjob('qj-1').status).toBe('completed');
  });

  test('cancellation is still authoritative without the column', async () => {
    seedPost('sp-1');
    seedJob('qj-1', 'sp-1');
    lockedJobs.add('qj-1');
    await cancelScheduledPostQueueEntry('sp-1', { reason: 'user_unscheduled' });
    await processPublishJob(delivery('qj-1', 'sp-1'));
    expect(publishesFor('sp-1')).toBe(0);
  });

  test('cancel falls back to retiring every failed row (none can be shown terminal)', async () => {
    seedPost('sp-1');
    seedJob('qj-1', 'sp-1', { status: 'failed' });
    seedJob('qj-2', 'sp-1', { status: 'failed' });

    const cancel = await cancelScheduledPostQueueEntry('sp-1', { reason: 'user_unscheduled' });

    expect(cancel.errors).toEqual([]);
    expect(cancel.db_cancelled).toBe(2);
    expect(jobsFor('sp-1').map((r) => r.status)).toEqual(['cancelled', 'cancelled']);
  });

  test('duplicate guards fall back to the pre-migration live set (pending/processing only)', async () => {
    seedPost('sp-1');
    seedJob('qj-1', 'sp-1', { status: 'failed' });
    expect(await enqueueScheduledPostAt('sp-1', USER, ACCOUNT, FUTURE())).toBe('enqueued');

    seedPost('sp-2');
    seedJob('qj-2', 'sp-2', { status: 'pending' });
    expect(await enqueueScheduledPostAt('sp-2', USER, ACCOUNT, FUTURE())).toBe('duplicate');
  });

  test('the safety-net cron runs without the column', async () => {
    seedPost('sp-1');
    seedJob('qj-1', 'sp-1', { status: 'failed' });
    const result = await findDuePostsAndEnqueue();
    expect(result.found).toBe(1);
    expect(liveJobsFor('sp-1')).toHaveLength(1);
  });

  test('manual retry works without the column', async () => {
    seedPost('sp-1', { status: 'failed' });
    seedJob('qj-old', 'sp-1', { status: 'failed' });
    const res = await callRetry('sp-1');
    expect(res.statusCode).toBe(200);
    expect(qjob('qj-old').status).toBe('cancelled');
    expect(liveJobsFor('sp-1')).toHaveLength(1);
  });
});

describe('mixed versions — rows written by the previous worker after the migration', () => {
  test('a legacy failed row (NULL retry_state) is never treated as terminal', async () => {
    seedPost('sp-1');
    seedJob('qj-legacy', 'sp-1', { status: 'failed', retry_state: null });

    // Not live for the duplicate guards (its pre-migration behaviour)...
    expect(await enqueueScheduledPostAt('sp-1', USER, ACCOUNT, FUTURE())).toBe('enqueued');
    // ...but retired by cancellation, because it may still hold a retry.
    const cancel = await cancelScheduledPostQueueEntry('sp-1', { reason: 'user_unscheduled' });
    expect(qjob('qj-legacy').status).toBe('cancelled');
    expect(cancel.db_cancelled).toBe(2); // the legacy row + the new pending job
  });

  test('a processing row with a stale awaiting_retry (old worker claimed it) is cleared by the next claim', async () => {
    seedPost('sp-1');
    seedJob('qj-1', 'sp-1', { status: 'pending', retry_state: 'awaiting_retry' });
    await processPublishJob(delivery('qj-1', 'sp-1', 1));
    expect(publishesFor('sp-1')).toBe(1);
    expect(qjob('qj-1').retry_state).toBeNull();
  });
});

// ─── Workstream C — uncertain publish outcome (duplicate-publication guard) ──
//
// A worker that dies AFTER the platform request is sent leaves an outcome the
// database cannot know: the post may already be live. These tests pin that a
// stalled re-delivery of such a job never calls the platform again, while a
// death BEFORE the call (no marker) and a KNOWN failure still retry normally.

const STALE = (): string => new Date(Date.now() - 40 * 60 * 1000).toISOString(); // BullMQ stall re-delivery: 30–60 min
const MARKER = (): Row => ({ platform_call: { started_at: new Date(Date.now() - 41 * 60 * 1000).toISOString() } });
const isMarkerWrite = (payload: Row | null): boolean =>
  !!payload && !!payload.metadata && !!(payload.metadata as Row).platform_call;

/** A job whose previous attempt died: still 'processing', older than the replay window. */
function seedDiedAttempt(postOverrides: Row, withMarker: boolean): void {
  seedPost('sp-1', { status: 'publishing', updated_at: STALE(), ...postOverrides });
  seedJob('qj-1', 'sp-1', { status: 'processing', updated_at: STALE(), metadata: withMarker ? MARKER() : {} });
}

describe('Workstream C — termination before vs. after the platform call', () => {
  test('died BEFORE the platform call (no marker): the re-delivery publishes once', async () => {
    // The previous attempt died holding a FENCED pre-call claim (no
    // PUBLISH_CALL_STARTED): provably no call. An old row with no claim token
    // proves nothing and is never taken over — see Closure-003 below.
    seedDiedAttempt({ error_code: 'PUBLISH_CLAIMED:dead-attempt' }, false);
    await processPublishJob(delivery('qj-1', 'sp-1', 0));
    expect(publishesFor('sp-1')).toBe(1);
    expect(qjob('qj-1').status).toBe('completed');
    expect(post('sp-1').status).toBe('published');
  });

  test('died DURING the call or after the platform accepted it (marker, post still publishing): NO republish, uncertainty recorded', async () => {
    seedDiedAttempt({}, true);
    await processPublishJob(delivery('qj-1', 'sp-1', 0));
    expect(publishesFor('sp-1')).toBe(0);
    expect(qjob('qj-1')).toMatchObject({ status: 'failed', retry_state: 'exhausted', error_code: 'PUBLISH_OUTCOME_UNCERTAIN' });
    expect(post('sp-1')).toMatchObject({ status: 'failed', error_code: 'PUBLISH_OUTCOME_UNCERTAIN' });
    expect(String(post('sp-1').error_message)).toContain('check the platform before retrying');
  });

  test('the post was already swept by the CURRENT sweeper (failed, no error_code): still uncertain, no republish', async () => {
    seedDiedAttempt({ status: 'failed', error_code: null, error_message: 'Stuck in publishing state for >= 600s — swept' }, true);
    await processPublishJob(delivery('qj-1', 'sp-1', 0));
    expect(publishesFor('sp-1')).toBe(0);
    expect(qjob('qj-1').error_code).toBe('PUBLISH_OUTCOME_UNCERTAIN');
    expect(post('sp-1')).toMatchObject({ status: 'failed', error_code: 'PUBLISH_OUTCOME_UNCERTAIN' });
  });

  test('the post was swept by the UPDATED sweeper (failed + PUBLISH_OUTCOME_UNCERTAIN): no republish', async () => {
    seedDiedAttempt({ status: 'failed', error_code: 'PUBLISH_OUTCOME_UNCERTAIN' }, true);
    await processPublishJob(delivery('qj-1', 'sp-1', 0));
    expect(publishesFor('sp-1')).toBe(0);
    expect(qjob('qj-1').status).toBe('failed');
  });

  test('a KNOWN platform failure was persisted (failed WITH a platform error_code): the re-delivery retries normally', async () => {
    seedDiedAttempt({ status: 'failed', error_code: 'RATE_LIMITED', error_message: 'slow down' }, true);
    await processPublishJob(delivery('qj-1', 'sp-1', 0));
    expect(publishesFor('sp-1')).toBe(1);
    expect(post('sp-1').status).toBe('published');
  });

  test('died AFTER the result was saved (platform_post_id present): completed, no republish', async () => {
    seedDiedAttempt({ status: 'published', platform_post_id: 'plat_existing' }, true);
    await processPublishJob(delivery('qj-1', 'sp-1', 0));
    expect(publishesFor('sp-1')).toBe(0);
    expect(qjob('qj-1').status).toBe('completed');
    expect(post('sp-1').platform_post_id).toBe('plat_existing');
  });
});

describe('Workstream C — repeated and concurrent delivery', () => {
  test('a later delivery of an uncertain job never publishes', async () => {
    seedDiedAttempt({}, true);
    await processPublishJob(delivery('qj-1', 'sp-1', 0));
    await processPublishJob(delivery('qj-1', 'sp-1', 1));
    await processPublishJob(delivery('qj-1', 'sp-1', 2));
    expect(publishesFor('sp-1')).toBe(0);
    expect(qjob('qj-1').error_code).toBe('PUBLISH_OUTCOME_UNCERTAIN');
  });

  test('two concurrent stale re-deliveries: zero publishes, the job ends failed', async () => {
    seedDiedAttempt({}, true);
    await Promise.all([
      processPublishJob(delivery('qj-1', 'sp-1', 0)),
      processPublishJob(delivery('qj-1', 'sp-1', 0)),
    ]);
    expect(publishesFor('sp-1')).toBe(0);
    expect(qjob('qj-1')).toMatchObject({ status: 'failed', error_code: 'PUBLISH_OUTCOME_UNCERTAIN' });
  });

  test('mixed version (retry_state column absent): the uncertain row is still never re-run', async () => {
    schema.migrated = false;
    seedPost('sp-1', { status: 'publishing', updated_at: STALE() });
    seedJob('qj-1', 'sp-1', { status: 'processing', updated_at: STALE(), metadata: MARKER() });
    expect('retry_state' in qjob('qj-1')).toBe(false);
    await processPublishJob(delivery('qj-1', 'sp-1', 0));
    expect(qjob('qj-1')).toMatchObject({ status: 'failed', error_code: 'PUBLISH_OUTCOME_UNCERTAIN' });
    // A crash-time re-delivery finds 'failed' with no retry state — the
    // uncertain code alone keeps it from being claimed and republished.
    await processPublishJob(delivery('qj-1', 'sp-1', 1));
    expect(publishesFor('sp-1')).toBe(0);
  });
});

describe('Workstream C — the per-attempt platform-call marker', () => {
  test('the processing claim clears a marker left by an earlier attempt; the marker is set after the claim, before the call', async () => {
    seedPost('sp-1', { status: 'failed', error_code: 'RATE_LIMITED' });
    seedJob('qj-1', 'sp-1', { status: 'failed', retry_state: 'awaiting_retry', metadata: { other: 'kept', ...MARKER() } });
    const updates: Row[] = [];
    queueJobFault = (op, payload) => { if (op === 'update' && payload) updates.push({ ...payload }); return null; };

    await processPublishJob(delivery('qj-1', 'sp-1', 1));

    const claim = updates.find((u) => u.status === 'processing') as Row;
    expect(claim.metadata).toEqual({ other: 'kept' });
    const markerWrite = updates.find((u) => u.status === undefined && isMarkerWrite(u)) as Row;
    expect(markerWrite).toBeDefined();
    expect((markerWrite.metadata as Row).other).toBe('kept');
    expect(updates.indexOf(markerWrite)).toBeGreaterThan(updates.indexOf(claim));
    expect(publishesFor('sp-1')).toBe(1);
  });

  test('a cancel that lands between the claim and the marker: the platform is NOT called and the post claim is released', async () => {
    seedPost('sp-1');
    seedJob('qj-1', 'sp-1');
    queueJobFault = (op, payload) => {
      if (op === 'update' && isMarkerWrite(payload)) qjob('qj-1').status = 'cancelled';
      return null;
    };
    await expect(processPublishJob(delivery('qj-1', 'sp-1', 0))).rejects.toThrow('PUBLISH_ABORTED_JOB_NOT_PROCESSING');
    expect(publishesFor('sp-1')).toBe(0);
    expect(qjob('qj-1').status).toBe('cancelled');
    expect(post('sp-1').status).toBe('scheduled');
  });

  test('a marker write that FAILS: the platform is never called (a death during the call would otherwise be undetectable)', async () => {
    seedPost('sp-1');
    seedJob('qj-1', 'sp-1');
    queueJobFault = (op, payload) =>
      op === 'update' && isMarkerWrite(payload) ? { code: '08006', message: 'connection terminated' } : null;
    await expect(processPublishJob(delivery('qj-1', 'sp-1', 0))).rejects.toThrow('connection terminated');
    expect(publishesFor('sp-1')).toBe(0);
    expect(post('sp-1').status).toBe('scheduled');
  });
});

// ─── Closure-002 R5 — ambiguous adapter outcomes never retry automatically ───
//
// No adapter makes post creation idempotent, so after a request that may have
// reached the platform, a retry can publish twice. Only a CONFIRMED rejection
// or pre-send failure retries; everything else is PUBLISH_OUTCOME_UNCERTAIN:
// post and job failed with that code, the job exhausted, the delivery ends
// WITHOUT a throw (so BullMQ does not retry), and every later delivery — of
// this job or any other job for the post — refuses to call the platform.

import * as queriesModule from '../../db/queries';
import { reconcileUncertainPublish } from '../../services/publishOutcomeReconciliation';

const adapterMock = (): { publishToPlatform: jest.Mock } =>
  jest.requireMock('../../adapters/platformAdapter') as { publishToPlatform: jest.Mock };
/** Next platform call returns `result` (and is counted like any other call). */
function nextPlatformResult(result: Row): void {
  adapterMock().publishToPlatform.mockImplementationOnce(async (scheduledPostId: string) => {
    platformCalls.push(scheduledPostId);
    return result;
  });
}
/** Next platform call throws — the outcome is unknown. */
function nextPlatformThrow(message: string): void {
  adapterMock().publishToPlatform.mockImplementationOnce(async (scheduledPostId: string) => {
    platformCalls.push(scheduledPostId);
    throw new Error(message);
  });
}
function expectUncertain(postId: string, jobId: string): void {
  expect(post(postId)).toMatchObject({ status: 'failed', error_code: 'PUBLISH_OUTCOME_UNCERTAIN', platform_post_id: null });
  expect(qjob(jobId)).toMatchObject({ status: 'failed', error_code: 'PUBLISH_OUTCOME_UNCERTAIN' });
  if (schema.migrated) expect(qjob(jobId).retry_state).toBe('exhausted');
}

describe('Closure-002 R5 — confirmed failures still retry', () => {
  test('a pre-send failure (delivery: not_sent) is retryable: failed + awaiting_retry, and the backoff delivery publishes', async () => {
    seedPost('sp-1');
    seedJob('qj-1', 'sp-1');
    nextPlatformResult({ success: false, error: { code: 'PUBLISH_ERROR', message: 'Social account not found', retryable: true, delivery: 'not_sent' } });

    await expect(processPublishJob(delivery('qj-1', 'sp-1', 0))).rejects.toThrow('Social account not found');
    expect(post('sp-1')).toMatchObject({ status: 'failed', error_code: 'PUBLISH_ERROR' });
    expect(qjob('qj-1')).toMatchObject({ status: 'failed', retry_state: 'awaiting_retry' });

    await processPublishJob(delivery('qj-1', 'sp-1', 1));
    expect(publishesFor('sp-1')).toBe(2);
    expect(post('sp-1').status).toBe('published');
    expect(post('sp-1').error_code).toBeNull();
  });

  test('a confirmed rejection (explicit 429) retries; the code lands in the same update as the status', async () => {
    seedPost('sp-1');
    seedJob('qj-1', 'sp-1');
    const spy = jest.spyOn(queriesModule, 'updateScheduledPostOnFailure');
    nextPlatformResult({ success: false, error: { code: 'LINKEDIN_RATE_LIMIT', message: 'throttled', retryable: true } });

    await expect(processPublishJob(delivery('qj-1', 'sp-1', 0))).rejects.toThrow('throttled');
    expect(spy).toHaveBeenCalledWith('sp-1', 'throttled', undefined, 'LINKEDIN_RATE_LIMIT');
    spy.mockRestore();
    expect(qjob('qj-1').retry_state).toBe('awaiting_retry');

    await processPublishJob(delivery('qj-1', 'sp-1', 1));
    expect(publishesFor('sp-1')).toBe(2);
    expect(post('sp-1').status).toBe('published');
  });
});

describe('Closure-002 R5 — ambiguous outcomes are recorded uncertain and never retried', () => {
  const ambiguous: Array<[string, () => void]> = [
    ['the platform accepted the post but the response was lost (network error)', () =>
      nextPlatformResult({ success: false, error: { code: 'LINKEDIN_NETWORK_ERROR', message: 'socket hang up', retryable: true } })],
    ['a timeout after the request may have reached the platform', () =>
      nextPlatformResult({ success: false, error: { code: 'LINKEDIN_API_ERROR', message: 'timeout of 30000ms exceeded', retryable: true } })],
    ['a 5xx (generic *_API_ERROR, retryable: true)', () =>
      nextPlatformResult({ success: false, error: { code: 'TWITTER_API_ERROR', message: 'Request failed with status code 503', retryable: true } })],
    ['an adapter exception with unknown outcome (throws out of the adapter)', () => nextPlatformThrow('ECONNRESET')],
    ['an escaped throw AFTER dispatch (PUBLISH_ERROR without not_sent)', () =>
      nextPlatformResult({ success: false, error: { code: 'PUBLISH_ERROR', message: 'Cannot read properties of undefined', retryable: true } })],
    ['a success without a post id (malformed adapter outcome)', () =>
      nextPlatformResult({ success: true, platform_post_id: undefined })],
    ['an unknown code', () =>
      nextPlatformResult({ success: false, error: { code: 'SOMETHING_NEW', message: '?', retryable: false } })],
    ['no error object at all', () => nextPlatformResult({ success: false })],
  ];

  test.each(ambiguous)('%s: one call, uncertain, the delivery resolves (no BullMQ retry)', async (_label, arrange) => {
    seedPost('sp-1');
    seedJob('qj-1', 'sp-1');
    arrange();

    await expect(processPublishJob(delivery('qj-1', 'sp-1', 0))).resolves.toBeUndefined();
    expect(publishesFor('sp-1')).toBe(1);
    expectUncertain('sp-1', 'qj-1');
    expect(String(post('sp-1').error_message)).toContain('check the platform');
  });

  test('repeated BullMQ attempts after an uncertain result never call the platform again', async () => {
    seedPost('sp-1');
    seedJob('qj-1', 'sp-1');
    nextPlatformResult({ success: false, error: { code: 'LINKEDIN_NETWORK_ERROR', message: 'reset', retryable: true } });
    await processPublishJob(delivery('qj-1', 'sp-1', 0));

    await processPublishJob(delivery('qj-1', 'sp-1', 1));
    await processPublishJob(delivery('qj-1', 'sp-1', 2));
    expect(publishesFor('sp-1')).toBe(1);
    expectUncertain('sp-1', 'qj-1');
  });

  test('mixed version (retry_state column absent): still recorded uncertain and never re-run', async () => {
    schema.migrated = false;
    seedPost('sp-1');
    seedJob('qj-1', 'sp-1');
    nextPlatformThrow('socket hang up');

    await expect(processPublishJob(delivery('qj-1', 'sp-1', 0))).resolves.toBeUndefined();
    await processPublishJob(delivery('qj-1', 'sp-1', 1));
    expect(publishesFor('sp-1')).toBe(1);
    expectUncertain('sp-1', 'qj-1');
  });

  test('ANOTHER job for the same post (fresh, e.g. the safety-net cron) refuses an uncertain post', async () => {
    seedPost('sp-1', { status: 'failed', error_code: 'PUBLISH_OUTCOME_UNCERTAIN' });
    seedJob('qj-2', 'sp-1'); // pending, no marker of its own

    await expect(processPublishJob(delivery('qj-2', 'sp-1', 0))).resolves.toBeUndefined();
    expect(publishesFor('sp-1')).toBe(0);
    expect(qjob('qj-2')).toMatchObject({ status: 'failed', error_code: 'PUBLISH_OUTCOME_UNCERTAIN' });
  });

  test('sweeper → re-delivery after an ambiguous outcome: no second call', async () => {
    // Ambiguous attempt, then (as in production) the swept/labelled post and a
    // stalled re-delivery of the same job id.
    seedPost('sp-1');
    seedJob('qj-1', 'sp-1');
    nextPlatformResult({ success: false, error: { code: 'FACEBOOK_API_ERROR', message: 'socket hang up', retryable: true } });
    await processPublishJob(delivery('qj-1', 'sp-1', 0));
    qjob('qj-1').status = 'processing'; // a stall re-delivery of a job BullMQ still held
    qjob('qj-1').updated_at = new Date(Date.now() - 40 * 60 * 1000).toISOString();

    await processPublishJob(delivery('qj-1', 'sp-1', 0));
    expect(publishesFor('sp-1')).toBe(1);
    expect(post('sp-1').error_code).toBe('PUBLISH_OUTCOME_UNCERTAIN');
  });

  test('the post carries PUBLISH_CALL_STARTED during the call and loses it once the outcome is saved', async () => {
    seedPost('sp-1');
    seedJob('qj-1', 'sp-1');
    let duringCall: Row | null = null;
    duringPlatformCall = async () => { duringCall = { ...post('sp-1') }; };

    await processPublishJob(delivery('qj-1', 'sp-1', 0));
    expect(duringCall).toMatchObject({ status: 'publishing', error_code: 'PUBLISH_CALL_STARTED' });
    expect(post('sp-1')).toMatchObject({ status: 'published', error_code: null });
  });

  test('the previous sweeper left PUBLISH_CALL_STARTED on a failed post: no call, relabelled uncertain', async () => {
    seedPost('sp-1', { status: 'failed', error_code: 'PUBLISH_CALL_STARTED', error_message: 'Stuck in publishing state for >= 600s — swept' });
    seedJob('qj-2', 'sp-1');

    await processPublishJob(delivery('qj-2', 'sp-1', 0));
    expect(publishesFor('sp-1')).toBe(0);
    expect(post('sp-1').error_code).toBe('PUBLISH_OUTCOME_UNCERTAIN');
  });

  test('a stale publishing post whose call started elsewhere is NOT taken over by another job', async () => {
    seedPost('sp-1', {
      status: 'publishing', error_code: 'PUBLISH_CALL_STARTED',
      updated_at: new Date(Date.now() - 8 * 60 * 1000).toISOString(), // past the 5-minute stale-claim window
    });
    seedJob('qj-2', 'sp-1');

    await processPublishJob(delivery('qj-2', 'sp-1', 0));
    expect(publishesFor('sp-1')).toBe(0);
    expect(post('sp-1')).toMatchObject({ status: 'publishing', error_code: 'PUBLISH_CALL_STARTED' });
    expect(qjob('qj-2').status).toBe('completed');
  });

  test('the platform accepted the post but saving the id failed: uncertain (id kept in the message), no retry', async () => {
    seedPost('sp-1');
    seedJob('qj-1', 'sp-1');
    const spy = jest.spyOn(queriesModule, 'updateScheduledPostOnPublish').mockRejectedValueOnce(new Error('connection terminated'));

    await expect(processPublishJob(delivery('qj-1', 'sp-1', 0))).resolves.toBeUndefined();
    spy.mockRestore();
    expect(publishesFor('sp-1')).toBe(1);
    expectUncertain('sp-1', 'qj-1');
    expect(String(post('sp-1').error_message)).toContain('plat_sp-1_1');

    await processPublishJob(delivery('qj-1', 'sp-1', 1));
    expect(publishesFor('sp-1')).toBe(1);
  });

  test('the post-level marker write fails: the platform is never called, and the claim is given back', async () => {
    seedPost('sp-1');
    seedJob('qj-1', 'sp-1');
    const spy = jest.spyOn(queriesModule, 'markScheduledPostPlatformCallStarted').mockRejectedValueOnce(new Error('connection terminated'));

    await expect(processPublishJob(delivery('qj-1', 'sp-1', 0))).rejects.toThrow('connection terminated');
    spy.mockRestore();
    expect(publishesFor('sp-1')).toBe(0);
    expect(post('sp-1').status).toBe('scheduled');
  });
});

describe('Closure-002 — reconciliation, then an explicitly authorized retry', () => {
  async function uncertainPost(): Promise<void> {
    seedPost('sp-1');
    seedJob('qj-1', 'sp-1');
    nextPlatformResult({ success: false, error: { code: 'LINKEDIN_NETWORK_ERROR', message: 'reset', retryable: true } });
    await processPublishJob(delivery('qj-1', 'sp-1', 0));
    expect(post('sp-1').error_code).toBe('PUBLISH_OUTCOME_UNCERTAIN');
  }

  test("'not_published' makes the post an ordinary failure; the operator's retry publishes it exactly once more", async () => {
    await uncertainPost();
    const r = await reconcileUncertainPublish({
      scheduledPostId: 'sp-1', resolution: 'not_published', actorUserId: USER, note: 'checked LinkedIn: no post',
    });
    expect(r).toMatchObject({ status: 'reconciled', previous_error_code: 'PUBLISH_OUTCOME_UNCERTAIN' });
    expect(post('sp-1')).toMatchObject({ status: 'failed', error_code: 'PUBLISH_RECONCILED_NOT_PUBLISHED' });
    expect(String(post('sp-1').error_message)).toContain('checked LinkedIn: no post');

    // Nothing retries on its own: the old job is exhausted.
    await processPublishJob(delivery('qj-1', 'sp-1', 1));
    expect(publishesFor('sp-1')).toBe(1);

    const res = await callRetry('sp-1');
    expect(res.statusCode).toBe(200);
    const replacement = liveJobsFor('sp-1')[0];
    await processPublishJob(delivery(String(replacement.id), 'sp-1', 0));
    expect(publishesFor('sp-1')).toBe(2);
    expect(post('sp-1').status).toBe('published');
  });

  test('mixed version: after reconciling not_published, a stale re-delivery of the OLD uncertain job still never publishes — only the explicit retry does', async () => {
    // Without the retry_state column nothing marks the old job exhausted; its
    // own PUBLISH_OUTCOME_UNCERTAIN code is the only thing that keeps the
    // claim from running it once the post itself is retryable again.
    schema.migrated = false;
    seedPost('sp-1');
    seedJob('qj-1', 'sp-1');
    nextPlatformResult({ success: false, error: { code: 'LINKEDIN_NETWORK_ERROR', message: 'reset', retryable: true } });
    await processPublishJob(delivery('qj-1', 'sp-1', 0));
    expect(qjob('qj-1')).toMatchObject({ status: 'failed', error_code: 'PUBLISH_OUTCOME_UNCERTAIN' });
    expect('retry_state' in qjob('qj-1')).toBe(false);

    await reconcileUncertainPublish({
      scheduledPostId: 'sp-1', resolution: 'not_published', actorUserId: USER, note: 'checked: absent',
    });
    await processPublishJob(delivery('qj-1', 'sp-1', 1)); // BullMQ re-delivery of the old job
    expect(publishesFor('sp-1')).toBe(1);
    expect(post('sp-1').error_code).toBe('PUBLISH_RECONCILED_NOT_PUBLISHED');
  });

  test("'published' records the platform id; nothing publishes again", async () => {
    await uncertainPost();
    const r = await reconcileUncertainPublish({
      scheduledPostId: 'sp-1', resolution: 'published', platformPostId: 'urn:li:share:42',
      postUrl: 'https://linkedin.test/42', actorUserId: USER, note: 'found it live',
    });
    expect(r).toMatchObject({ status: 'reconciled', resolution: 'published' });
    expect(post('sp-1')).toMatchObject({ status: 'published', platform_post_id: 'urn:li:share:42', error_code: null });

    const res = await callRetry('sp-1');
    expect(res.statusCode).not.toBe(200);
    expect(publishesFor('sp-1')).toBe(1);
  });

  test('reconciliation is refused for a post that is not uncertain, and needs a note (and an id for published)', async () => {
    seedPost('sp-1', { status: 'failed', error_code: 'LINKEDIN_RATE_LIMIT' });
    await expect(reconcileUncertainPublish({
      scheduledPostId: 'sp-1', resolution: 'not_published', actorUserId: USER, note: 'x',
    })).resolves.toMatchObject({ status: 'not_uncertain' });

    seedPost('sp-2', { status: 'failed', error_code: 'PUBLISH_OUTCOME_UNCERTAIN' });
    await expect(reconcileUncertainPublish({
      scheduledPostId: 'sp-2', resolution: 'not_published', actorUserId: USER, note: '  ',
    })).resolves.toMatchObject({ status: 'invalid' });
    await expect(reconcileUncertainPublish({
      scheduledPostId: 'sp-2', resolution: 'published', actorUserId: USER, note: 'live',
    })).resolves.toMatchObject({ status: 'invalid' });
    expect(post('sp-2').error_code).toBe('PUBLISH_OUTCOME_UNCERTAIN');
  });

  test('a concurrent change between the read and the write is reported, never overwritten', async () => {
    seedPost('sp-1', { status: 'failed', error_code: 'PUBLISH_OUTCOME_UNCERTAIN' });
    const spy = jest.spyOn(queriesModule, 'getScheduledPost').mockImplementationOnce(async () => {
      const snapshot = { ...post('sp-1') };
      post('sp-1').error_code = 'PUBLISH_RECONCILED_NOT_PUBLISHED'; // another operator won
      return snapshot as unknown as Awaited<ReturnType<typeof queriesModule.getScheduledPost>>;
    });
    const r = await reconcileUncertainPublish({
      scheduledPostId: 'sp-1', resolution: 'published', platformPostId: 'p', actorUserId: USER, note: 'n',
    });
    spy.mockRestore();
    expect(r).toEqual({ status: 'changed' });
    expect(post('sp-1').status).toBe('failed');
  });
});

// ─── Closure-003 — manual retry (R1) and the queue against direct claims (R4) ─

describe('Closure-003 R1 — manual retry refuses an uncertain post', () => {
  test.each(['PUBLISH_OUTCOME_UNCERTAIN', 'PUBLISH_CALL_STARTED'])(
    '%s: 409 PUBLISH_OUTCOME_UNCERTAIN, and nothing is cancelled, reset or enqueued',
    async (code) => {
      seedPost('sp-1', { status: 'failed', error_code: code, error_message: 'may be live' });
      seedJob('qj-old', 'sp-1', { status: 'failed', error_code: 'PUBLISH_OUTCOME_UNCERTAIN', retry_state: 'exhausted' });
      const postBefore = { ...post('sp-1') };
      const jobBefore = { ...qjob('qj-old') };

      const res = await callRetry('sp-1');
      expect(res.statusCode).toBe(409);
      expect(res.body).toMatchObject({ code: 'PUBLISH_OUTCOME_UNCERTAIN', requires: 'reconciliation' });
      expect(String(res.body?.error)).toMatch(/reconcil/i);
      expect(post('sp-1')).toEqual(postBefore);
      expect(qjob('qj-old')).toEqual(jobBefore);
      expect(jobsFor('sp-1')).toHaveLength(1);
      expect(bullAdds).toHaveLength(0);
      expect(publishesFor('sp-1')).toBe(0);
    },
  );

  test('mixed version (retry_state column absent): still refused', async () => {
    schema.migrated = false;
    seedPost('sp-1', { status: 'failed', error_code: 'PUBLISH_OUTCOME_UNCERTAIN' });
    expect((await callRetry('sp-1')).statusCode).toBe(409);
    expect(bullAdds).toHaveLength(0);
  });

  test("another user's uncertain post: still 404, no state disclosed", async () => {
    seedPost('sp-1', { status: 'failed', error_code: 'PUBLISH_OUTCOME_UNCERTAIN', user_id: '00000000-0000-4000-8000-0000000000ff' });
    const res = await callRetry('sp-1');
    expect(res.statusCode).toBe(404);
    expect(res.body?.code).toBe('NOT_FOUND');
  });

  test('the post becomes uncertain between the read and the reset: the reset matches nothing (409), nothing enqueued', async () => {
    seedPost('sp-1', { status: 'failed', error_code: 'LINKEDIN_RATE_LIMIT' });
    seedJob('qj-old', 'sp-1', { status: 'failed', retry_state: 'awaiting_retry' });
    // Lands inside the queue cancel that precedes the reset.
    beforeQueueJobUpdate = () => { post('sp-1').error_code = 'PUBLISH_OUTCOME_UNCERTAIN'; };

    const res = await callRetry('sp-1');
    expect(res.statusCode).toBe(409);
    expect(res.body?.code).toBe('NOT_RETRYABLE');
    expect(post('sp-1')).toMatchObject({ status: 'failed', error_code: 'PUBLISH_OUTCOME_UNCERTAIN' });
    expect(bullAdds).toHaveLength(0);
  });

  test('an ordinary failure (including a safe pre-send failure) still retries and publishes once', async () => {
    seedPost('sp-1', { status: 'failed', error_code: 'PUBLISH_ERROR' });
    const res = await callRetry('sp-1');
    expect(res.statusCode).toBe(200);
    const replacement = liveJobsFor('sp-1')[0];
    await processPublishJob(delivery(String(replacement.id), 'sp-1', 0));
    expect(publishesFor('sp-1')).toBe(1);
    expect(post('sp-1').status).toBe('published');
  });
});

describe('Closure-003 R4 — the queue never takes over a claim whose call may be in flight', () => {
  const TEN_MIN_AGO = (): string => new Date(Date.now() - 10 * 60 * 1000).toISOString();

  test.each([
    ['a live direct-publish call (PUBLISH_CALL_STARTED, fresh)', { error_code: 'PUBLISH_CALL_STARTED' }],
    ['a direct-publish call that looks stale (PUBLISH_CALL_STARTED, 10 min old)', { error_code: 'PUBLISH_CALL_STARTED', updated_at: 'STALE' }],
    ['a live pre-call claim (PUBLISH_CLAIMED, fresh)', { error_code: 'PUBLISH_CLAIMED:direct-1' }],
    ['a legacy publishing row with no token (looks stale)', { error_code: null, updated_at: 'STALE' }],
  ])('%s: no call, the post is left exactly as it is', async (_label, over) => {
    const overrides: Row = { status: 'publishing', ...over };
    if (overrides.updated_at === 'STALE') overrides.updated_at = TEN_MIN_AGO();
    seedPost('sp-1', overrides);
    seedJob('qj-1', 'sp-1');
    const before = { ...post('sp-1') };

    await expect(processPublishJob(delivery('qj-1', 'sp-1', 0))).resolves.toBeUndefined();
    expect(publishesFor('sp-1')).toBe(0);
    expect(post('sp-1')).toEqual(before);
    expect(qjob('qj-1').status).toBe('completed');
  });

  test('a stale PRE-CALL claim is taken over (fenced) and published once', async () => {
    seedPost('sp-1', { status: 'publishing', error_code: 'PUBLISH_CLAIMED:dead', updated_at: TEN_MIN_AGO() });
    seedJob('qj-1', 'sp-1');
    await processPublishJob(delivery('qj-1', 'sp-1', 0));
    expect(publishesFor('sp-1')).toBe(1);
    expect(post('sp-1')).toMatchObject({ status: 'published', error_code: null });
  });

  test('the post becomes uncertain between the read and the post claim: no call, the job ends uncertain', async () => {
    seedPost('sp-1', { status: 'failed', error_code: 'LINKEDIN_RATE_LIMIT' });
    seedJob('qj-1', 'sp-1', { status: 'failed', retry_state: 'awaiting_retry' });
    // Lands inside the JOB claim, which precedes the POST claim.
    beforeQueueJobUpdate = () => { post('sp-1').error_code = 'PUBLISH_OUTCOME_UNCERTAIN'; };

    await expect(processPublishJob(delivery('qj-1', 'sp-1', 1))).resolves.toBeUndefined();
    expect(publishesFor('sp-1')).toBe(0);
    expect(qjob('qj-1')).toMatchObject({ status: 'failed', error_code: 'PUBLISH_OUTCOME_UNCERTAIN', retry_state: 'exhausted' });
    expect(post('sp-1').error_code).toBe('PUBLISH_OUTCOME_UNCERTAIN');
  });

  test('the worker claim records a token; a pre-call throw restores status AND the original code', async () => {
    seedPost('sp-1', { status: 'failed', error_code: 'LINKEDIN_RATE_LIMIT' });
    seedJob('qj-1', 'sp-1', { status: 'failed', retry_state: 'awaiting_retry' });
    const media = jest.requireMock('../../services/mediaReferenceResolver') as { refreshDurableMediaBeforePublish: jest.Mock };
    let duringPrep: string | null = null;
    media.refreshDurableMediaBeforePublish.mockImplementationOnce(async () => {
      duringPrep = String(post('sp-1').error_code);
      throw new Error('boom');
    });

    await expect(processPublishJob(delivery('qj-1', 'sp-1', 1))).rejects.toThrow('boom');
    expect(duringPrep).toMatch(/^PUBLISH_CLAIMED:/);
    expect(post('sp-1')).toMatchObject({ status: 'failed', error_code: 'LINKEDIN_RATE_LIMIT' });
    expect(publishesFor('sp-1')).toBe(0);
  });

  test('the worker claim was taken over before its call: the superseded worker does not call (fence)', async () => {
    seedPost('sp-1');
    seedJob('qj-1', 'sp-1');
    const media = jest.requireMock('../../services/mediaReferenceResolver') as { refreshDurableMediaBeforePublish: jest.Mock };
    media.refreshDurableMediaBeforePublish.mockImplementationOnce(async () => {
      // Another execution replaced this worker's claim token meanwhile.
      post('sp-1').error_code = 'PUBLISH_CLAIMED:someone-else';
    });

    await expect(processPublishJob(delivery('qj-1', 'sp-1', 0))).rejects.toThrow('PUBLISH_ABORTED_POST_NOT_HELD');
    expect(publishesFor('sp-1')).toBe(0);
    expect(post('sp-1')).toMatchObject({ status: 'publishing', error_code: 'PUBLISH_CLAIMED:someone-else' });
  });
});
