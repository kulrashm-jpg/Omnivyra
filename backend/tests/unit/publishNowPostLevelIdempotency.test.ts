/**
 * Post-level publish idempotency on the DIRECT publish path — drives the REAL
 * service entrypoint (`publishNow`) over an in-memory Postgres-shaped fake.
 *
 * `publishNow` is the second of the platform's two publish paths, and the one
 * the queue's job-level idempotency cannot see:
 *
 *   1. scheduler → queue_jobs → BullMQ → publishProcessor
 *   2. pages/api/cron/process-scheduled-posts.ts → publishNow   (NO queue_jobs
 *      row at all), and pages/api/social/publish.ts → publishNow (manual
 *      "publish now")
 *
 * Before this boundary, path 2 had the same unguarded read-then-act on
 * `platform_post_id` as path 1, and took no claim — so a cron execution and a
 * queue execution, or two consecutive cron ticks, could both publish one post.
 *
 * The fake models the ONE property the boundary depends on: a conditional
 * UPDATE reports how many rows it actually changed, and concurrent updates on
 * the same row serialise so the loser re-evaluates its predicate against the
 * winner's committed version (Postgres READ COMMITTED). That is what makes the
 * database — not the caller — pick the winner.
 *
 * Deliberately NOT a helper-level test: every assertion goes through
 * `publishNow`, so deleting the claim from the call path fails these tests even
 * if the helper itself still exists.
 */

// ─── In-memory Postgres-shaped store ────────────────────────────────────────

type Row = Record<string, any>;

const store: Record<string, Row[]> = {
  scheduled_posts: [],
  campaigns: [],
  daily_content_plans: [],
  companies: [],
};

/** Serialises writes so an `await`-interleaved test still sees row-at-a-time
 *  semantics, the way Postgres would. */
let writeLock: Promise<unknown> = Promise.resolve();
function serialised<T>(fn: () => T): Promise<T> {
  const next = writeLock.then(fn, fn);
  writeLock = next.catch(() => undefined);
  return next;
}

function matches(row: Row, state: any): boolean {
  for (const [k, v] of Object.entries(state.eq)) {
    if (row[k] !== v) return false;
  }
  for (const [k, vals] of Object.entries(state.in)) {
    if (!(vals as any[]).includes(row[k])) return false;
  }
  for (const [k, v] of Object.entries(state.lt)) {
    if (row[k] == null || !(row[k] < (v as any))) return false;
  }
  for (const [k, v] of Object.entries(state.lte)) {
    if (row[k] == null || !(row[k] <= (v as any))) return false;
  }
  for (const [k, v] of Object.entries(state.is)) {
    if ((row[k] ?? null) !== v) return false;
  }
  return true;
}

function buildChain(table: string) {
  const state: any = { eq: {}, in: {}, lt: {}, lte: {}, is: {}, update: null, insert: null, del: false };
  if (!store[table]) store[table] = [];

  const settle = (): Promise<{ data: any; error: null }> => serialised(() => {
    const rows = store[table];
    if (state.insert) {
      const incoming = Array.isArray(state.insert) ? state.insert : [state.insert];
      const created = incoming.map((r: Row) => ({
        id: r.id ?? `gen-${Math.random().toString(36).slice(2, 10)}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...r,
      }));
      rows.push(...created);
      return { data: created, error: null };
    }
    // Predicate is evaluated HERE, at write time, against current row state —
    // this is what makes the loser of a race match zero rows.
    const hit = rows.filter((r) => matches(r, state));
    if (state.del) {
      store[table] = rows.filter((r) => !hit.includes(r));
      return { data: hit, error: null };
    }
    if (state.update) {
      hit.forEach((r) => Object.assign(r, state.update));
    }
    return { data: hit, error: null };
  });

  const self: any = {
    select: (..._a: any[]) => self,
    insert: (rows: any) => { state.insert = rows; return self; },
    update: (data: any) => { state.update = data; return self; },
    delete: () => { state.del = true; return self; },
    eq: (f: string, v: any) => { state.eq[f] = v; return self; },
    in: (f: string, v: any[]) => { state.in[f] = v; return self; },
    lt: (f: string, v: any) => { state.lt[f] = v; return self; },
    lte: (f: string, v: any) => { state.lte[f] = v; return self; },
    is: (f: string, v: any) => { state.is[f] = v; return self; },
    order: () => self,
    limit: () => self,
    single: async () => {
      const { data } = await settle();
      const first = Array.isArray(data) ? data[0] : data;
      return first ? { data: first, error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
    },
    maybeSingle: async () => {
      const { data } = await settle();
      const first = Array.isArray(data) ? data[0] : data;
      return { data: first ?? null, error: null };
    },
    then: (onOk: any, onErr?: any) => settle().then(onOk, onErr),
  };
  return self;
}

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => buildChain(table),
    rpc: async () => ({ data: null, error: { message: 'rpc missing' } }),
  },
}));

// ─── Platform boundary + peripheral collaborators ───────────────────────────

const platformCalls: string[] = [];
let platformOutcome: 'success' | 'failure' = 'success';

jest.mock('../../adapters/platformAdapter', () => ({
  publishToPlatform: jest.fn(async (scheduledPostId: string) => {
    platformCalls.push(scheduledPostId);
    // Latency is what opens the TOCTOU window a naive guard leaves open, and
    // what makes a real publish outlive a single 60s cron tick.
    await new Promise((r) => setTimeout(r, 15));
    if (platformOutcome === 'failure') {
      return { success: false, error: { code: 'RATE_LIMITED', message: 'slow down', retryable: true } };
    }
    return {
      success: true,
      platform_post_id: `plat_${scheduledPostId}_${platformCalls.length}`,
      post_url: `https://example.test/${scheduledPostId}`,
      published_at: new Date(),
    };
  }),
}));

const threadCalls: string[] = [];
jest.mock('../../services/threadRuntime/threadPublishOrchestrator', () => ({
  publishThread: jest.fn(async ({ root_scheduled_post_id }: any) => {
    threadCalls.push(root_scheduled_post_id);
    return { status: 'PUBLISHED', message: 'thread published', timestamp: new Date().toISOString() };
  }),
}));

// Validators: stubbed to PASS so the suite measures the claim, not content
// rules. Each has its own dedicated coverage elsewhere.
jest.mock('../../services/publishReadinessValidator', () => ({
  validatePublishReadiness: jest.fn(() => ({ ok: true, warnings: [] })),
}));
jest.mock('../../services/platformContentValidator', () => ({
  validatePlatformContentCompatibility: jest.fn(() => ({ ok: true })),
}));
jest.mock('../../services/creatorPublishValidation', () => ({
  validateCreatorPublishSemanticsLive: jest.fn(async () => ({ ok: true, warnings: [] })),
}));
jest.mock('../../services/mediaUploadValidationService', () => ({
  validateMediaUpload: jest.fn(async () => ({ valid: true })),
}));
jest.mock('../../services/mediaReferenceResolver', () => ({
  refreshDurableMediaBeforePublish: jest.fn(async () => undefined),
}));
// Stubbed for module-load reasons as much as behavioural ones: the real
// modules transitively import the creator asset renderers / bullmqClient,
// which import `config/` and hard-fail at import time without a populated
// .env.test. Nothing in the claim boundary touches them.
jest.mock('../../services/creator/creatorPublishResolution', () => ({
  resolvePublishMedia: jest.fn(async () => ({ mediaUrls: [], resolvedCount: 0 })),
}));
jest.mock('../../services/creator/publishingOrganizationResolver', () => ({
  resolvePublishingOrganization: jest.fn(async () => null),
}));
jest.mock('../../services/creatorQueueReliabilityService', () => ({
  recordPublishFailure: jest.fn(async () => undefined),
}));
jest.mock('../../services/creatorOperationalTelemetryService', () => ({
  emitCreatorEvent: jest.fn(() => undefined),
  CREATOR_EVENTS: new Proxy({}, { get: (_t, k) => String(k) }),
}));
jest.mock('../../services/creatorAuditTrailService', () => ({
  recordAuditEntry: jest.fn(() => undefined),
}));
jest.mock('../../services/creator/strategyAttributionResolver', () => ({
  resolveStrategyAttributionForScheduledPost: jest.fn(async () => null),
}));
jest.mock('../../services/creator/variantExperimentLifecycle', () => ({
  notifyExperimentAssetPublished: jest.fn(() => undefined),
}));
jest.mock('../../services/errorRecoveryService', () => ({
  categorizeError: jest.fn((_platform: string, err: any) => ({
    code: err?.code ?? 'PROCESSING_ERROR',
    message: err?.message ?? String(err),
    user_message: err?.message ?? String(err),
  })),
}));
jest.mock('../../services/analyticsService', () => ({ recordPostAnalytics: jest.fn(async () => undefined) }));
jest.mock('../../services/activityLogger', () => ({ logActivity: jest.fn(async () => undefined) }));
jest.mock('../../services/CampaignCompletionService', () => ({ checkAndCompleteCampaignIfEligible: jest.fn(async () => undefined) }));
jest.mock('../../services/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../../lib/shared/observability', () => ({ logPipelineEvent: jest.fn(() => undefined) }));

import { publishNow } from '../../services/publishNowService';
import { RELEASABLE_POST_STATUSES } from '../../../lib/campaign/publishAuthorization';

// ─── Fixtures ───────────────────────────────────────────────────────────────

const USER = '00000000-0000-0000-0000-0000000000u1';
const ACCOUNT = '00000000-0000-0000-0000-0000000000a1';

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
    post_url: null,
    published_at: null,
    is_thread_start: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
  store.scheduled_posts.push(row);
  return row;
}

const post = (id: string) => store.scheduled_posts.find((r) => r.id === id)!;
const publishesFor = (id: string) => platformCalls.filter((p) => p === id).length;

/** Publish through the service exactly as both real callers do. */
const run = (id: string, source?: string) =>
  publishNow({ scheduled_post_id: id, social_account_id: ACCOUNT, user_id: USER, publish_source: source });

/**
 * The cron safety net's due-post SELECT, copied verbatim in predicate from
 * pages/api/cron/process-scheduled-posts.ts:
 *   .eq('status','scheduled').lte('scheduled_for', now)
 * Used to prove what tick N+1 can still see while tick N is in flight.
 */
const cronWouldSelect = (now = new Date().toISOString()) =>
  store.scheduled_posts.filter((r) => r.status === 'scheduled' && r.scheduled_for <= now).map((r) => r.id);

beforeEach(() => {
  Object.keys(store).forEach((k) => { store[k] = []; });
  platformCalls.length = 0;
  threadCalls.length = 0;
  platformOutcome = 'success';
  writeLock = Promise.resolve();
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('publishNow — post-level publish claim (direct path: cron + manual)', () => {
  test('the first execution claims and publishes', async () => {
    seedPost('sp-1');

    const result = await run('sp-1', 'scheduler');

    expect(result.status).toBe('PUBLISHED');
    expect(publishesFor('sp-1')).toBe(1);
    expect(post('sp-1').status).toBe('published');
    expect(post('sp-1').platform_post_id).toBeTruthy();
  });

  test('a second concurrent execution matches ZERO rows and does NOT publish', async () => {
    seedPost('sp-1');

    // Two executions for ONE post — e.g. the cron safety net and the queue
    // worker landing on the same due row. Nothing outside the claim separates
    // them: both read platform_post_id as null.
    const [a, b] = await Promise.all([run('sp-1', 'scheduler'), run('sp-1', 'api')]);

    expect(publishesFor('sp-1')).toBe(1);
    expect(post('sp-1').status).toBe('published');

    const outcomes = [a.status, b.status].sort();
    expect(outcomes).toEqual(['FAILED', 'PUBLISHED']);
    const loser = [a, b].find((r) => r.status === 'FAILED')!;
    expect(loser.message).toMatch(/Duplicate publish suppressed/i);
  });

  test('a second execution arriving while the first still holds the claim is suppressed', async () => {
    // Sequential, not racing: the first execution is mid-flight (row already
    // 'publishing', freshly stamped). This is the state a naive
    // platform_post_id check cannot see, because platform_post_id is still null.
    seedPost('sp-1', { status: 'publishing', updated_at: new Date().toISOString(), platform_post_id: null });

    const result = await run('sp-1');

    expect(publishesFor('sp-1')).toBe(0);
    expect(result.status).toBe('FAILED');
    expect(result.message).toMatch(/Duplicate publish suppressed/i);
    // The holder's claim is untouched.
    expect(post('sp-1').status).toBe('publishing');
  });

  test('cron tick N+1 cannot re-select a post that tick N is still publishing', async () => {
    // THE cron × cron race. The cron runJob idempotencyKey is minute-bucketed
    // (`cron:process-scheduled-posts:<post>:<minuteBucket>`), so it collapses
    // nothing across ticks — only the row's own status can. Before the claim,
    // an in-flight publish left the row at status='scheduled' with
    // platform_post_id still null, so the next tick re-selected and re-published it.
    seedPost('sp-1');
    expect(cronWouldSelect()).toEqual(['sp-1']); // tick N sees it

    const inFlight = run('sp-1', 'scheduler');
    // Advance to the point the platform call is in flight — strictly after the
    // claim committed, and strictly before the terminal write.
    while (publishesFor('sp-1') === 0) await new Promise((r) => setTimeout(r, 1));

    expect(cronWouldSelect()).toEqual([]); // tick N+1 no longer sees it
    expect(post('sp-1').status).toBe('publishing');

    await inFlight;
    expect(publishesFor('sp-1')).toBe(1);
    expect(post('sp-1').status).toBe('published');
  });

  test('a same-post replay after completion is still collapsed', async () => {
    seedPost('sp-1');

    await run('sp-1');
    const replay = await run('sp-1'); // identical re-delivery

    expect(publishesFor('sp-1')).toBe(1);
    expect(replay.status).toBe('PUBLISHED');
    expect(replay.external_post_id).toBe(post('sp-1').platform_post_id);
  });

  test('two DIFFERENT posts both publish — no false collision', async () => {
    seedPost('sp-1');
    seedPost('sp-2');

    const [a, b] = await Promise.all([run('sp-1'), run('sp-2')]);

    expect(a.status).toBe('PUBLISHED');
    expect(b.status).toBe('PUBLISHED');
    expect(publishesFor('sp-1')).toBe(1);
    expect(publishesFor('sp-2')).toBe(1);
    expect(post('sp-1').status).toBe('published');
    expect(post('sp-2').status).toBe('published');
    expect(post('sp-1').platform_post_id).not.toBe(post('sp-2').platform_post_id);
  });

  test('a failed publish releases the claim, and the retry publishes', async () => {
    seedPost('sp-1');

    platformOutcome = 'failure';
    const first = await run('sp-1');
    expect(first.status).toBe('FAILED');
    // The claim must NOT survive the failure, or the retry would be blocked.
    expect(post('sp-1').status).toBe('failed');

    platformOutcome = 'success';
    const retry = await run('sp-1');

    expect(retry.status).toBe('PUBLISHED');
    expect(publishesFor('sp-1')).toBe(2); // the failed attempt + the retry
    expect(post('sp-1').status).toBe('published');
  });

  test('an unexpected throw CAS-restores the pre-claim status, so nothing is stranded', async () => {
    seedPost('sp-1');

    const adapter = require('../../adapters/platformAdapter');
    adapter.publishToPlatform.mockImplementationOnce(async () => { throw new Error('socket hang up'); });

    await expect(run('sp-1')).rejects.toThrow('socket hang up');

    // Not left at 'publishing' — a stranded claim would be a permanent block.
    expect(post('sp-1').status).toBe('scheduled');
    expect(cronWouldSelect()).toEqual(['sp-1']); // still on the retry surface

    const retry = await run('sp-1');
    expect(retry.status).toBe('PUBLISHED');
  });

  test('a stale claim from a hard-killed runtime can be reclaimed', async () => {
    seedPost('sp-1', {
      status: 'publishing',
      platform_post_id: null,
      updated_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(), // > 5min window
    });

    const result = await run('sp-1');

    expect(result.status).toBe('PUBLISHED');
    expect(publishesFor('sp-1')).toBe(1);
    expect(post('sp-1').status).toBe('published');
  });

  test('two racing reclaimers of one stale claim still yield exactly one publish', async () => {
    seedPost('sp-1', {
      status: 'publishing',
      platform_post_id: null,
      updated_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    });

    await Promise.all([run('sp-1'), run('sp-1')]);

    expect(publishesFor('sp-1')).toBe(1);
    expect(post('sp-1').status).toBe('published');
  });

  test('an already-published post is skipped without a platform call', async () => {
    seedPost('sp-1', { status: 'published', platform_post_id: 'plat_existing', post_url: 'https://x.test/1' });

    const result = await run('sp-1');

    expect(publishesFor('sp-1')).toBe(0);
    expect(result.status).toBe('PUBLISHED');
    expect(result.external_post_id).toBe('plat_existing');
  });

  test('losing the claim to an execution that has already landed reports PUBLISHED, not FAILED', async () => {
    // The row is held by another execution that finished the platform call and
    // wrote platform_post_id but whose status write we model as still pending
    // ('publishing'). The claim is refused, and the reason must be reported as
    // already-published so the caller does not stamp a spurious failure.
    seedPost('sp-1', {
      status: 'publishing',
      platform_post_id: 'plat_from_the_winner',
      updated_at: new Date().toISOString(),
    });

    const result = await run('sp-1');

    expect(publishesFor('sp-1')).toBe(0);
    expect(result.status).toBe('PUBLISHED');
    expect(result.external_post_id).toBe('plat_from_the_winner');
  });

  test('thread-start behaviour is unchanged: delegated, never pre-claimed', async () => {
    seedPost('sp-root', { is_thread_start: true, status: 'scheduled' });

    const result = await run('sp-root');

    expect(threadCalls).toEqual(['sp-root']);
    expect(publishesFor('sp-root')).toBe(0);
    expect(result.status).toBe('PUBLISHED');
    // The service must NOT have moved the root into 'publishing' — the
    // orchestrator's own per-node claim transitions FROM the root's current
    // status, and 'publishing' -> 'publishing' is not a legal transition.
    expect(post('sp-root').status).toBe('scheduled');
  });
});

describe('publishNow — the MANUAL "publish now" path keeps working', () => {
  test('a user publishing a scheduled post now still publishes', async () => {
    seedPost('sp-1', { status: 'scheduled' });

    const result = await run('sp-1', 'api');

    expect(result.status).toBe('PUBLISHED');
    expect(publishesFor('sp-1')).toBe(1);
  });

  test('a user retrying a FAILED post still publishes', async () => {
    // `failed` is claimable precisely so manual retry keeps working; dropping
    // it would convert every retryable failure into a permanent block.
    seedPost('sp-1', { status: 'failed', error_message: 'earlier boom' });

    const result = await run('sp-1', 'api');

    expect(result.status).toBe('PUBLISHED');
    expect(publishesFor('sp-1')).toBe(1);
    expect(post('sp-1').status).toBe('published');
  });

  test('the claimable set never rejects a manual publish the route would have allowed uncontended', async () => {
    // pages/api/social/publish.ts gates on authorizePostPublish, whose
    // RELEASABLE_POST_STATUSES is the set a manual publish may reach
    // publishNow with. The claim accepts every one of them EXCEPT
    // 'publishing' — which is exactly the contended state it exists to
    // refuse. So a draft never reaches here (the route 409s it), and no
    // uncontended manual publish is newly blocked.
    const releasable = [...RELEASABLE_POST_STATUSES].sort();
    expect(releasable).toEqual(['failed', 'publishing', 'scheduled']);

    for (const status of ['scheduled', 'failed']) {
      Object.keys(store).forEach((k) => { store[k] = []; });
      platformCalls.length = 0;
      seedPost('sp-x', { status });
      const result = await run('sp-x', 'api');
      expect(result.status).toBe('PUBLISHED');
      expect(publishesFor('sp-x')).toBe(1);
    }
  });
});
