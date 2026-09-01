/**
 * Post-level publish idempotency — drives the REAL worker entrypoint
 * (`processPublishJob`) through the real `runJob` runner, the real
 * `authorizePostPublish` gate and the real `backend/db/queries` writers, over
 * an in-memory Postgres-shaped fake.
 *
 * The fake models the ONE property the boundary depends on: a conditional
 * UPDATE reports how many rows it actually changed, and concurrent updates on
 * the same row serialise so the loser re-evaluates its predicate against the
 * winner's committed version (Postgres READ COMMITTED). That is what makes the
 * database — not the worker — pick the winner.
 *
 * Deliberately NOT a helper-level test: every assertion goes through
 * `processPublishJob`, so deleting the guard from the call path fails these
 * tests even if the helper itself still exists.
 */

// ─── In-memory Postgres-shaped store ────────────────────────────────────────

type Row = Record<string, any>;

const store: Record<string, Row[]> = {
  scheduled_posts: [],
  queue_jobs: [],
  queue_job_logs: [],
  campaigns: [],
  daily_content_plans: [],
  worker_dead_letter_queue: [],
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
  for (const [k, v] of Object.entries(state.is)) {
    if ((row[k] ?? null) !== v) return false;
  }
  for (const [k, criteria] of Object.entries(state.contains)) {
    const col = row[k];
    if (col == null || typeof col !== 'object') return false;
    if (!Object.entries(criteria as Row).every(([ck, cv]) => (col as Row)[ck] === cv)) return false;
  }
  return true;
}

function buildChain(table: string) {
  const state: any = { eq: {}, in: {}, lt: {}, is: {}, contains: {}, update: null, insert: null, del: false };
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
    lte: (f: string, v: any) => { state.lt[f] = v; return self; },
    is: (f: string, v: any) => { state.is[f] = v; return self; },
    contains: (f: string, v: any) => { state.contains[f] = v; return self; },
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
    // Latency is what opens the TOCTOU window a naive guard leaves open.
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
    return { status: 'PUBLISHED', root_id: root_scheduled_post_id, total_nodes: 2, published_count: 2 };
  }),
}));

jest.mock('../../services/publishReadinessValidator', () => ({
  validatePublishReadiness: jest.fn(() => ({ ok: true, warnings: [] })),
}));
jest.mock('../../services/mediaReferenceResolver', () => ({
  refreshDurableMediaBeforePublish: jest.fn(async () => undefined),
}));
// The claim helpers now live in publishNowService and are SHARED with the
// worker, so this mock must expose the REAL ones — stubbing them would delete
// the boundary under test. Only the media-refresh side-effect is stubbed.
jest.mock('../../services/publishNowService', () => {
  const actual = jest.requireActual('../../services/publishNowService');
  return {
    ...actual,
    refreshScheduledPostMediaFromRefs: jest.fn(async () => undefined),
  };
});
jest.mock('../../services/creator/publishingOrganizationResolver', () => ({
  resolvePublishingOrganization: jest.fn(async () => null),
}));
// Stubbed for module-load reasons, not behavioural ones: the real module
// transitively imports the creator asset renderers, which import `config/` and
// hard-fail at import time without a populated .env.test. Nothing in the claim
// boundary touches it.
jest.mock('../../services/creator/creatorPublishResolution', () => ({
  resolvePublishMedia: jest.fn(async () => ({ mediaUrls: [], resolvedCount: 0 })),
}));
jest.mock('../../services/creatorQueueReliabilityService', () => ({
  recordPublishFailure: jest.fn(async () => undefined),
}));
jest.mock('../../services/errorRecoveryService', () => ({
  categorizeError: jest.fn((_platform: string, err: any) => ({
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
// The execution governor is a per-tenant rate cap, not an idempotency
// mechanism. Grant every lease so the suite measures the boundary under test.
jest.mock('../../services/executionGovernor', () => ({
  acquire: jest.fn(() => ({ ok: true, release: () => undefined })),
}));

import type { Job } from 'bullmq';
import { processPublishJob } from '../../queue/jobProcessors/publishProcessor';

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
    is_thread_start: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
  store.scheduled_posts.push(row);
  return row;
}

function seedJob(id: string, scheduledPostId: string, overrides: Row = {}): Row {
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
    ...overrides,
  };
  store.queue_jobs.push(row);
  return row;
}

function job(id: string, scheduledPostId: string): Job<any> {
  return {
    id,
    data: { scheduled_post_id: scheduledPostId, social_account_id: ACCOUNT, user_id: USER },
    attemptsMade: 0,
    opts: { attempts: 3 },
  } as unknown as Job<any>;
}

const post = (id: string) => store.scheduled_posts.find((r) => r.id === id)!;
const qjob = (id: string) => store.queue_jobs.find((r) => r.id === id)!;
const publishesFor = (id: string) => platformCalls.filter((p) => p === id).length;

beforeEach(() => {
  Object.keys(store).forEach((k) => { store[k] = []; });
  platformCalls.length = 0;
  threadCalls.length = 0;
  platformOutcome = 'success';
  writeLock = Promise.resolve();
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('publishProcessor — post-level publish claim', () => {
  test('first execution publishes and records the platform post id', async () => {
    seedPost('sp-1');
    seedJob('qj-1', 'sp-1');

    await processPublishJob(job('qj-1', 'sp-1'));

    expect(publishesFor('sp-1')).toBe(1);
    expect(post('sp-1').status).toBe('published');
    expect(post('sp-1').platform_post_id).toBeTruthy();
    expect(qjob('qj-1').status).toBe('completed');
  });

  test('a SECOND job for the same post does not independently publish it', async () => {
    seedPost('sp-1');
    seedJob('qj-a', 'sp-1');
    seedJob('qj-b', 'sp-1');

    // Two distinct jobs, two distinct queue_jobs rows, launched concurrently.
    // Every job-level check passes for BOTH — only the post-level claim can
    // separate them.
    await Promise.all([
      processPublishJob(job('qj-a', 'sp-1')),
      processPublishJob(job('qj-b', 'sp-1')),
    ]);

    expect(publishesFor('sp-1')).toBe(1);
    expect(post('sp-1').status).toBe('published');

    const suppressed = [qjob('qj-a'), qjob('qj-b')].filter((j) => j.result_data?.suppressed === true);
    expect(suppressed).toHaveLength(1);
    expect(suppressed[0].status).toBe('completed');
  });

  test('a second job arriving while the first still holds the claim is suppressed', async () => {
    // Sequential, not racing: the first execution is mid-flight (row already
    // 'publishing', freshly stamped). This is the state a naive
    // platform_post_id check cannot see, because platform_post_id is still null.
    seedPost('sp-1', { status: 'publishing', updated_at: new Date().toISOString(), platform_post_id: null });
    seedJob('qj-late', 'sp-1');

    await processPublishJob(job('qj-late', 'sp-1'));

    expect(publishesFor('sp-1')).toBe(0);
    expect(qjob('qj-late').result_data?.suppressed).toBe(true);
    expect(post('sp-1').status).toBe('publishing');
  });

  test('same-job replay is still collapsed (broker re-delivery)', async () => {
    seedPost('sp-1');
    seedJob('qj-1', 'sp-1');

    await processPublishJob(job('qj-1', 'sp-1'));
    await processPublishJob(job('qj-1', 'sp-1')); // identical re-delivery

    expect(publishesFor('sp-1')).toBe(1);
    expect(qjob('qj-1').status).toBe('completed');
  });

  test('two DIFFERENT posts both publish — no false collision', async () => {
    seedPost('sp-1');
    seedPost('sp-2');
    seedJob('qj-1', 'sp-1');
    seedJob('qj-2', 'sp-2');

    await Promise.all([
      processPublishJob(job('qj-1', 'sp-1')),
      processPublishJob(job('qj-2', 'sp-2')),
    ]);

    expect(publishesFor('sp-1')).toBe(1);
    expect(publishesFor('sp-2')).toBe(1);
    expect(post('sp-1').status).toBe('published');
    expect(post('sp-2').status).toBe('published');
    expect(post('sp-1').platform_post_id).not.toBe(post('sp-2').platform_post_id);
  });

  test('a failed publish releases the claim, and the retry publishes', async () => {
    seedPost('sp-1');
    seedJob('qj-1', 'sp-1');

    platformOutcome = 'failure';
    await expect(processPublishJob(job('qj-1', 'sp-1'))).rejects.toThrow();

    // The claim must NOT survive the failure, or the retry would be blocked.
    expect(post('sp-1').status).toBe('failed');

    platformOutcome = 'success';
    await processPublishJob(job('qj-1', 'sp-1'));

    expect(publishesFor('sp-1')).toBe(2); // the failed attempt + the retry
    expect(post('sp-1').status).toBe('published');
  });

  test('an unexpected throw restores the pre-claim status, so nothing is stranded', async () => {
    seedPost('sp-1');
    seedJob('qj-1', 'sp-1');

    const adapter = require('../../adapters/platformAdapter');
    adapter.publishToPlatform.mockImplementationOnce(async () => { throw new Error('socket hang up'); });

    await expect(processPublishJob(job('qj-1', 'sp-1'))).rejects.toThrow('socket hang up');

    // Not left at 'publishing' — a stranded claim would be a permanent block.
    expect(post('sp-1').status).toBe('scheduled');

    await processPublishJob(job('qj-1', 'sp-1'));
    expect(post('sp-1').status).toBe('published');
  });

  test('a stale claim from a hard-killed worker can be reclaimed', async () => {
    seedPost('sp-1', {
      status: 'publishing',
      platform_post_id: null,
      updated_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(), // > 5min window
    });
    seedJob('qj-1', 'sp-1');

    await processPublishJob(job('qj-1', 'sp-1'));

    expect(publishesFor('sp-1')).toBe(1);
    expect(post('sp-1').status).toBe('published');
  });

  test('a post already published is skipped without a platform call', async () => {
    seedPost('sp-1', { status: 'published', platform_post_id: 'plat_existing' });
    seedJob('qj-1', 'sp-1');

    await processPublishJob(job('qj-1', 'sp-1'));

    expect(publishesFor('sp-1')).toBe(0);
    expect(qjob('qj-1').status).toBe('completed');
  });

  test('thread-start behaviour is unchanged: delegated, never pre-claimed', async () => {
    seedPost('sp-root', { is_thread_start: true, status: 'scheduled' });
    seedJob('qj-1', 'sp-root');

    await processPublishJob(job('qj-1', 'sp-root'));

    expect(threadCalls).toEqual(['sp-root']);
    expect(publishesFor('sp-root')).toBe(0);
    // The processor must NOT have moved the root into 'publishing' — the
    // orchestrator's own per-node claim transitions FROM the root's current
    // status, and 'publishing' -> 'publishing' is not a legal transition.
    expect(post('sp-root').status).toBe('scheduled');
    expect(qjob('qj-1').status).toBe('completed');
  });

  test('a thread root that already published its own node still re-enters the orchestrator', async () => {
    // The deliberate exemption: a set platform_post_id on a thread root means
    // only the ROOT landed; children may still be pending.
    seedPost('sp-root', { is_thread_start: true, status: 'scheduled', platform_post_id: 'plat_root' });
    seedJob('qj-1', 'sp-root');

    await processPublishJob(job('qj-1', 'sp-root'));

    expect(threadCalls).toEqual(['sp-root']);
  });
});
