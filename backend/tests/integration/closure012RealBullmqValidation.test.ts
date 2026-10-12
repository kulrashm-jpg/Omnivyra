/**
 * Closure-012 — Section C of docs/security/CLOSURE_011_INTEGRATION_VALIDATION.md
 * against a REAL BullMQ (real Redis), with the database and the publishing
 * provider faked.
 *
 * OPT-IN: runs only with OMNIVYRA_REAL_BULLMQ_VALIDATION=1. Otherwise every
 * test is skipped (ordinary regression never needs Redis).
 *
 * ENVIRONMENT BOUNDARY — hard-coded, never read from env:
 *   - Redis 127.0.0.1:6379 (loopback only), logical DB 15, key prefix
 *     `c12val-<random>`; the suite ABORTS unless DB 15 is empty first, and
 *     obliterates its own keys afterwards (asserting DB 15 is empty again).
 *   - No database (an in-memory queue_jobs / dead-letter fake), no provider,
 *     no network beyond loopback Redis.
 *
 * What this proves: real BullMQ job states (delayed / active / locked /
 * removed / completed) seen by the queue-safety code. What it does NOT prove:
 * Postgres/PostgREST/RLS behaviour, real provider outcomes, or anything about
 * production.
 */
import { randomUUID } from 'crypto';
import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';

const ENABLED = process.env.OMNIVYRA_REAL_BULLMQ_VALIDATION === '1';
const REDIS = { host: '127.0.0.1', port: 6379, db: 15, maxRetriesPerRequest: null as null };
const PREFIX = `c12val-${randomUUID().slice(0, 8)}`;

// ── Real queue, with fault injection (a Redis error on remove / add) ─────────
let mockRealQueue: Queue | null = null;
const mockFailRemoveFor = new Set<string>();
let mockFailNextAdd = false;
function mockQueueFacade(): Queue {
  const q = mockRealQueue as Queue;
  return new Proxy(q, {
    get(target, prop, receiver) {
      if (prop === 'add') {
        return async (...args: Parameters<Queue['add']>) => {
          if (mockFailNextAdd) { mockFailNextAdd = false; throw new Error('injected: redis add failed'); }
          return target.add(...args);
        };
      }
      if (prop === 'getJob') {
        return async (id: string) => {
          const job = await target.getJob(id);
          if (!job || !mockFailRemoveFor.has(id)) return job;
          return new Proxy(job, {
            get(j, p, r) {
              if (p === 'remove') return async () => { throw new Error('injected: redis remove failed'); };
              return Reflect.get(j, p, r);
            },
          });
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as Queue;
}
jest.mock('../../queue/bullmqClient', () => ({
  getQueue: () => mockQueueFacade(),
  getPostingQueue: () => mockQueueFacade(),
  getAiHeavyQueue: () => mockQueueFacade(),
  getEngagementPollingQueue: () => mockQueueFacade(),
  getLeadThreadRecomputeQueue: () => mockQueueFacade(),
  getConversationMemoryRebuildQueue: () => mockQueueFacade(),
  makeStableJobId: (prefix: string) => `${prefix}-stable`,
}));
jest.mock('../../queue/boltQueue', () => ({ getBoltQueue: () => mockQueueFacade() }));
jest.mock('../../queue/contentGenerationQueues', () => ({ CONTENT_QUEUE_CONFIG: {}, getContentQueue: () => mockQueueFacade() }));
jest.mock('../../observability/traceKit', () => ({ withTraceMeta: (p: unknown) => p }));

// ── In-memory database: write-time predicate evaluation, copies out ─────────
type Row = Record<string, unknown>;
const mockTables: Record<string, Row[]> = {};
const LIVE = ['pending', 'processing'];
function mockBuilder(table: string) {
  const filters: Array<{ k: string; op: string; v: unknown }> = [];
  let op: 'select' | 'update' | 'insert' | 'delete' = 'select';
  let payload: Row = {};
  let limitN: number | null = null;
  const get = (r: Row, k: string) => (k.includes('->')
    ? k.split('->').slice(1).reduce((v: unknown, p) => (v && typeof v === 'object' ? (v as Row)[p] : undefined), r[k.split('->')[0]])
    : r[k]);
  const match = (r: Row) => filters.every(({ k, op: o, v }) => {
    const a = get(r, k);
    if (o === 'eq') return a === v;
    if (o === 'neq') return a !== v;
    if (o === 'in') return (v as unknown[]).includes(a);
    if (o === 'is') return (a ?? null) === v;
    return true;
  });
  const rows = () => (mockTables[table] ??= []);
  const run = () => {
    if (op === 'insert') {
      const list = (Array.isArray(payload) ? payload : [payload]).map((p: Row) => ({ id: randomUUID(), ...p }));
      rows().push(...list);
      return { data: list.map((r) => ({ ...r })), error: null };
    }
    let hit = rows().filter(match);
    if (op === 'update') { hit.forEach((r) => Object.assign(r, payload)); return { data: hit.map((r) => ({ ...r })), error: null }; }
    if (op === 'delete') { mockTables[table] = rows().filter((r) => !hit.includes(r)); return { data: hit, error: null }; }
    if (limitN != null) hit = hit.slice(0, limitN);
    return { data: hit.map((r) => ({ ...r })), error: null };
  };
  const b: Record<string, unknown> = {};
  for (const m of ['eq', 'neq', 'in', 'is']) b[m] = (k: string, v: unknown) => { filters.push({ k, op: m, v }); return b; };
  for (const m of ['select', 'order', 'gte', 'lte', 'lt', 'gt', 'not', 'or']) b[m] = () => b;
  b.limit = (n: number) => { limitN = n; return b; };
  b.update = (p: Row) => { op = 'update'; payload = p; return b; };
  b.insert = (p: Row) => { op = 'insert'; payload = p; return b; };
  b.delete = () => { op = 'delete'; return b; };
  b.maybeSingle = async () => { const r = run(); return { data: (r.data as Row[])[0] ?? null, error: null }; };
  b.single = async () => { const r = run(); const d = (r.data as Row[])[0]; return d ? { data: d, error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } }; };
  b.then = (ok: (v: unknown) => unknown, err: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, err);
  return b;
}
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => mockBuilder(t) }));
jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: (t: string) => mockBuilder(t), rpc: async () => ({ data: true, error: null }) },
}));
jest.mock('../../db/queries', () => ({
  // The live-row unique index (migration 20261009000000) simulated: a second
  // pending/processing row for the same post is rejected with 23505.
  createQueueJob: async (p: Row) => {
    const live = (mockTables.queue_jobs ??= []).some((r) => r.scheduled_post_id === p.scheduled_post_id && LIVE.includes(String(r.status)));
    if (live) throw new Error('duplicate key value violates unique constraint "uidx_queue_jobs_live_job_per_post"');
    const id = randomUUID();
    mockTables.queue_jobs.push({ id, metadata: null, ...p });
    return id;
  },
}));
jest.mock('../../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../../services/creatorOperationalTelemetryService', () => ({ emitCreatorEvent: jest.fn(), CREATOR_EVENTS: new Proxy({}, { get: (_t, k) => String(k) }) }));
jest.mock('../../services/creatorAuditTrailService', () => ({ recordAuditEntry: jest.fn() }));

import {
  atomicCancelAndReEnqueueScheduledPost,
  cancelScheduledPostQueueEntry,
} from '../../scheduler/schedulerPostQueueControl';
import { sweepQueueDrift } from '../../services/creatorQueueReliabilityService';
import { replayDeadLetterEntry, PUBLISH_REDRIVE_UNSUPPORTED } from '../../services/jobInspection';

const d = ENABLED ? describe : describe.skip;
const FUTURE = (h = 2) => new Date(Date.now() + h * 3_600_000).toISOString();
let admin: IORedis;
const workers: Worker[] = [];
const holds: Array<() => void> = [];

/** A queue_jobs row + its REAL delayed BullMQ job under the row's id. */
async function liveJob(postId: string, status: 'pending' | 'processing' = 'pending', metadata: Row | null = null) {
  const id = randomUUID();
  (mockTables.queue_jobs ??= []).push({ id, scheduled_post_id: postId, job_type: 'publish', status, scheduled_for: FUTURE(1), metadata });
  await (mockRealQueue as Queue).add('publish', { scheduled_post_id: postId }, { jobId: id, delay: 3_600_000 });
  return id;
}
/** A real worker that takes the next job and HOLDS it (active + locked) until released. */
async function holdNextJobActive(): Promise<string> {
  let resolveTaken!: (id: string) => void;
  const taken = new Promise<string>((r) => { resolveTaken = r; });
  const w = new Worker('publish', async (job: Job) => {
    resolveTaken(String(job.id));
    await new Promise<void>((release) => holds.push(release));
  }, { connection: REDIS, prefix: PREFIX, autorun: true, lockDuration: 60_000 });
  workers.push(w);
  return taken;
}
const state = async (id: string) => {
  const job = await (mockRealQueue as Queue).getJob(id);
  return job ? job.getState() : 'missing';
};
const row = (id: string) => (mockTables.queue_jobs ?? []).find((r) => r.id === id) as Row;
const liveRows = (postId: string) => (mockTables.queue_jobs ?? []).filter((r) => r.scheduled_post_id === postId && LIVE.includes(String(r.status)));

d('Closure-012 Section C — real BullMQ (loopback Redis DB 15, isolated prefix)', () => {
  beforeAll(async () => {
    admin = new IORedis({ ...REDIS, lazyConnect: true });
    await admin.connect();
    // Boundary: refuse to run against anything but an EMPTY loopback DB 15.
    const size = await admin.dbsize();
    if (size !== 0) throw new Error(`boundary: Redis DB 15 is not empty (${size} keys) — refusing to run`);
    mockRealQueue = new Queue('publish', { connection: REDIS, prefix: PREFIX });
    await mockRealQueue.waitUntilReady();
  }, 30_000);

  afterEach(async () => {
    holds.splice(0).forEach((release) => release());
    await Promise.all(workers.splice(0).map((w) => w.close()));
    mockFailRemoveFor.clear();
    mockFailNextAdd = false;
    for (const k of Object.keys(mockTables)) delete mockTables[k];
    await (mockRealQueue as Queue).obliterate({ force: true });
  }, 30_000);

  afterAll(async () => {
    await (mockRealQueue as Queue).obliterate({ force: true });
    await (mockRealQueue as Queue).close();
    const leftover = await admin.keys(`${PREFIX}:*`);
    if (leftover.length) await admin.del(...leftover);
    const size = await admin.dbsize();
    await admin.quit();
    // Cleanup evidence: DB 15 is empty again.
    expect(size).toBe(0);
  }, 30_000);

  it('C1 — re-enqueue fails after the cancel REMOVED the real delayed job: no restore, no live row, no orphan job', async () => {
    const old = await liveJob('sp-c1');
    expect(await state(old)).toBe('delayed');
    mockFailNextAdd = true;
    const r = await atomicCancelAndReEnqueueScheduledPost({ scheduledPostId: 'sp-c1', userId: 'u', socialAccountId: 'sa', newScheduledFor: FUTURE(3) });
    expect(r).toMatchObject({ ok: false, enqueue: 'failed', rollback: 'skipped', rollback_reason: 'bullmq_job_removed' });
    expect(await state(old)).toBe('missing');            // real BullMQ: removed
    expect(row(old).status).toBe('cancelled');            // DB: cancelled, not restored to a phantom 'pending'
    expect(liveRows('sp-c1')).toEqual([]);                // the failed enqueue's own row was retired too
    expect(await (mockRealQueue as Queue).getJobCountByTypes('delayed', 'waiting', 'active')).toBe(0);
  });

  it('C2 — the old job SURVIVES (remove fails) and is still delayed: restored to pending, its real job still runnable', async () => {
    const old = await liveJob('sp-c2');
    mockFailRemoveFor.add(old);
    mockFailNextAdd = true;
    const r = await atomicCancelAndReEnqueueScheduledPost({ scheduledPostId: 'sp-c2', userId: 'u', socialAccountId: 'sa', newScheduledFor: FUTURE(3) });
    expect(r).toMatchObject({ ok: false, rollback: 'restored' });
    expect(await state(old)).toBe('delayed');
    expect(row(old).status).toBe('pending');
    expect(liveRows('sp-c2').map((x) => x.id)).toEqual([old]);
  });

  it('C2b — a job ACTIVE in a real worker is LOCKED: real remove() fails, and a processing row is never restored', async () => {
    const id = await liveJob('sp-c2b', 'processing');
    await (await (mockRealQueue as Queue).getJob(id))!.promote();
    const taken = await holdNextJobActive();
    expect(taken).toBe(id);
    expect(await state(id)).toBe('active');
    mockFailNextAdd = true;
    const r = await atomicCancelAndReEnqueueScheduledPost({ scheduledPostId: 'sp-c2b', userId: 'u', socialAccountId: 'sa', newScheduledFor: FUTURE(3) });
    expect(r.cancel.errors.join(' ')).toMatch(/bullmq remove/i);   // real BullMQ refused to remove a locked job
    expect(r).toMatchObject({ ok: false, rollback: 'skipped', rollback_reason: 'prior_job_was_processing' });
    expect(row(id).status).toBe('cancelled');
    expect(await state(id)).toBe('active');
  }, 30_000);

  it('C3 — a processing row whose platform call STARTED is left to its worker: not cancelled, its real job not touched', async () => {
    const id = await liveJob('sp-c3', 'processing', { platform_call: { started_at: new Date().toISOString() } });
    await (await (mockRealQueue as Queue).getJob(id))!.promote();
    await holdNextJobActive();
    const r = await cancelScheduledPostQueueEntry('sp-c3', { reason: 'user_unscheduled' });
    expect(r).toMatchObject({ db_cancelled: 0, queue_removed: 0, call_started_not_cancelled: [id] });
    expect(row(id).status).toBe('processing');
    expect(await state(id)).toBe('active');
  }, 30_000);

  it('C3b — a processing row whose call has NOT started is cancelled (the worker aborts before any call)', async () => {
    const id = await liveJob('sp-c3b', 'processing', null);
    const r = await cancelScheduledPostQueueEntry('sp-c3b', { reason: 'user_unscheduled' });
    expect(r.db_cancelled).toBe(1);
    expect(row(id).status).toBe('cancelled');
    expect(await state(id)).toBe('missing');
  });

  it('C3c — a stale job whose row already COMPLETED is not touched (DB or BullMQ)', async () => {
    const id = await liveJob('sp-c3c', 'pending');
    row(id).status = 'completed';
    const r = await cancelScheduledPostQueueEntry('sp-c3c', { reason: 'user_unscheduled' });
    expect(r).toMatchObject({ db_cancelled: 0, queue_removed: 0 });
    expect(row(id).status).toBe('completed');
    expect(await state(id)).toBe('delayed');
  });

  it('C5 — DLQ re-drive of a publish entry is refused: the dead letter is kept, nothing reaches the real queue', async () => {
    mockTables.worker_dead_letter_queue = [{
      id: 'dl-1', worker_name: 'publish', job_payload: { scheduled_post_id: 'sp-c5', social_account_id: 'sa', user_id: 'u' },
      failure_reason: 'boom', attempt_count: 3, last_attempt_at: new Date().toISOString(), created_at: new Date().toISOString(),
    }];
    await expect(replayDeadLetterEntry('dl-1')).rejects.toThrow(PUBLISH_REDRIVE_UNSUPPORTED);
    expect(mockTables.worker_dead_letter_queue).toHaveLength(1);
    expect(await (mockRealQueue as Queue).getJobCountByTypes('delayed', 'waiting', 'active', 'completed', 'failed')).toBe(0);
  });

  it('C6 — drift sweep: a pending row with NO real job is cancelled; one with a real delayed job is left alone', async () => {
    const orphan = randomUUID();
    mockTables.queue_jobs = [{ id: orphan, scheduled_post_id: 'sp-c6a', status: 'pending', updated_at: new Date().toISOString() }];
    const healthy = await liveJob('sp-c6b');
    const r = await sweepQueueDrift({ maxScan: 100 });
    expect(r).toMatchObject({ drift_found: 1, drift_cancelled: 1, peer_unknown: 0 });
    expect(row(orphan)).toMatchObject({ status: 'cancelled', error_message: 'drift_self_heal' });
    expect(row(healthy).status).toBe('pending');
    expect(await state(healthy)).toBe('delayed');
  });

  it('C8 — two concurrent reschedules of one post to DIFFERENT times: one live row, its real job is that row, and only the request whose time it carries may report success', async () => {
    await liveJob('sp-c8');
    const tA = FUTURE(3);
    const tB = FUTURE(5);
    const [a, b] = await Promise.all([
      atomicCancelAndReEnqueueScheduledPost({ scheduledPostId: 'sp-c8', userId: 'u', socialAccountId: 'sa', newScheduledFor: tA }),
      atomicCancelAndReEnqueueScheduledPost({ scheduledPostId: 'sp-c8', userId: 'u', socialAccountId: 'sa', newScheduledFor: tB }),
    ]);
    const live = liveRows('sp-c8');
    expect(live).toHaveLength(1);
    const liveJobs = await (mockRealQueue as Queue).getJobs(['delayed', 'waiting', 'active']);
    expect(liveJobs.map((j) => j.id)).toEqual([live[0].id]);
    const liveAt = new Date(String(live[0].scheduled_for)).getTime();
    if (a.ok) expect(liveAt).toBe(new Date(tA).getTime());
    if (b.ok) expect(liveAt).toBe(new Date(tB).getTime());
    expect(a.ok && b.ok).toBe(false);
  }, 30_000);
});
