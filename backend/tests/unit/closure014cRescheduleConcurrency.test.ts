/**
 * Closure-014C (Finding B) — concurrent activity-workspace reschedules must
 * leave the post, the plan row and the single live publish job agreeing on the
 * winning time. Closure-014B reproduced on the real stack (6 concurrent
 * reschedules) a superseded request rewriting the plan with its stale time and
 * a "repeat reschedule" marker; this file also pins the latent variants of the
 * same ordering defect (a stale queue step re-queuing the stale time, a stale
 * plan write) and the dead post-undo (scheduled_posts.updated_at is set by a
 * BEFORE UPDATE trigger, so an undo pinned on the app's own timestamp never
 * matched in Postgres).
 *
 * Real route + real tenant chain (routeAuthHarness); database = the harness
 * fake, with the scheduled_posts trigger SIMULATED (the stored updated_at is
 * database-assigned, never the payload's); queue = a stateful model of
 * atomicCancelAndReEnqueueScheduledPost (cancel every live job, then enqueue;
 * a live job at another time ⇒ 'duplicate', ok:false). Interleavings are forced
 * with barriers. In-memory: proves the route's ordering, fences and
 * convergence — NOT Postgres/BullMQ concurrency (see the 014C report for the
 * real-stack runs).
 */
import { seed, invoke, rows, CAMPAIGN_A, USER_A } from '../helpers/routeAuthHarness';

type Job = { at: string; live: boolean };
const mockJobs: Job[] = [];
let mockAtomicCalls = 0;
let mockAtomicHook: ((n: number, stage: 'before' | 'mid') => Promise<void> | void) | null = null;
let mockAtomicFail = false;
let mockDbTs = 0;
let mockPostReadGate: { n: number; p: Promise<void>; reached: () => void } | null = null;
let mockPostReads = 0;
let mockFailPlanUpdate = false;
let mockOnPlanFail: (() => void) | null = null;

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => {
  const h = jest.requireActual('../helpers/routeAuthHarness');
  const supabase = {
    ...h.fakeSupabase,
    from: (t: string) => {
      const b = h.fakeSupabase.from(t);
      if (t === 'scheduled_posts') {
        const orig = b.maybeSingle;
        b.maybeSingle = async () => {
          const n = ++mockPostReads;
          if (mockPostReadGate && mockPostReadGate.n === n) { mockPostReadGate.reached(); await mockPostReadGate.p; }
          return orig();
        };
      }
      return b;
    },
    storage: { from: () => ({ remove: jest.fn(async () => ({ data: null, error: null })) }) },
  };
  return { supabase, default: supabase, getSupabase: () => supabase, supabaseAdmin: supabase };
});
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => {
    const b = jest.requireActual('../helpers/routeAuthHarness').writeOwnerModule().ownedDbTable(t);
    const update = b.update;
    b.update = (p: Record<string, unknown>) => {
      // Simulated BEFORE UPDATE trigger: updated_at = CURRENT_TIMESTAMP (never the payload's value).
      const payload = t === 'scheduled_posts' ? { ...p, updated_at: `db-ts-${++mockDbTs}` } : p;
      const q = update(payload);
      if (t === 'daily_content_plans' && mockFailPlanUpdate && 'content_status' in p) {
        if (mockOnPlanFail) { const hook = mockOnPlanFail; mockOnPlanFail = null; hook(); }
        q.then = (ok: (v: unknown) => unknown, err: (e: unknown) => unknown) =>
          Promise.resolve({ data: null, error: { message: 'forced plan write failure', code: 'XX000' }, count: 0 }).then(ok, err);
      }
      return q;
    };
    return b;
  },
}));
jest.mock('../../services/supabaseAuthService', () => jest.requireActual('../helpers/routeAuthHarness').authModule());
jest.mock('../../security/IdentityResolver', () => jest.requireActual('../helpers/routeAuthHarness').identityModule());
jest.mock('../../middleware/withIdempotency', () => ({ withIdempotency: (h: unknown) => h }));
jest.mock('../../services/mediaUploadValidationService', () => ({
  validateMediaUpload: jest.fn(async () => ({ valid: true, validated_at: 'now', details: {} })),
}));
jest.mock('../../services/creatorOperationalTelemetryService', () => ({
  emitCreatorEvent: jest.fn(),
  CREATOR_EVENTS: new Proxy({}, { get: (_t, key) => String(key) }),
}));
jest.mock('../../services/creatorAuditTrailService', () => ({ recordAuditEntry: jest.fn() }));
jest.mock('../../services/campaignBlueprintService', () => {
  class BlueprintImmutableError extends Error {}
  class BlueprintExecutionFreezeError extends Error { hoursUntilExecution = 0; freezeWindowHours = 0; }
  class BlueprintMutabilityReadError extends Error {}
  return { assertBlueprintMutable: jest.fn(async () => undefined), BlueprintImmutableError, BlueprintExecutionFreezeError, BlueprintMutabilityReadError };
});
jest.mock('../../scheduler/schedulerService', () => ({
  tryAcquireScheduledPostQueueLock: jest.fn(async () => ({ acquired: true, release: async () => undefined })),
  cancelScheduledPostQueueEntry: jest.fn(async () => ({ db_cancelled: 0, queue_removed: 0, errors: [] })),
  enqueueScheduledPostAt: jest.fn(async () => 'enqueued'),
  atomicCancelAndReEnqueueScheduledPost: jest.fn(async (input: { newScheduledFor: string }) => {
    const n = ++mockAtomicCalls;
    if (mockAtomicHook) await mockAtomicHook(n, 'before');
    if (mockAtomicFail) return { ok: false, locked: true, enqueue: 'failed', cancel: { db_cancelled: 0, queue_removed: 0, errors: [] }, rollback: 'restored', idempotency_key: 'k' };
    for (const j of mockJobs) j.live = false;
    if (mockAtomicHook) await mockAtomicHook(n, 'mid');
    const live = mockJobs.find((j) => j.live);
    if (live) {
      const same = new Date(live.at).getTime() === new Date(input.newScheduledFor).getTime();
      return { ok: same, locked: true, enqueue: 'duplicate', cancel: { db_cancelled: 1, queue_removed: 1, errors: [] }, idempotency_key: 'k' };
    }
    mockJobs.push({ at: input.newScheduledFor, live: true });
    return { ok: true, locked: true, enqueue: 'enqueued', cancel: { db_cancelled: 1, queue_removed: 1, errors: [] }, idempotency_key: 'k' };
  }),
}));

import rescheduleHandler from '../../../pages/api/activity-workspace/[id]/reschedule';

process.env.SUPABASE_URL = 'https://placeholder.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://placeholder.supabase.co';

type Row = Record<string, unknown>;
const PLAN = 'plan-c-0-0000-0000-00000000000c';
const POST = '0a000000-0000-4000-8000-0000000000cc';
const ORIGINAL_AT = '2027-03-10T09:00:00.000Z';
const AT_12 = '2027-03-10T12:00:00.000Z';
const AT_15 = '2027-03-10T15:00:00.000Z';

function world() {
  seed({
    daily_content_plans: [{
      id: PLAN, campaign_id: CAMPAIGN_A, content_type: 'reel', platform: 'instagram', content_status: 'scheduled',
      scheduled_time: '09:00', date: '2027-03-10', execution_id: null, week_number: 1, updated_at: 'plan-v0',
      content: { creator_lifecycle_state: 'scheduled', scheduled_post_id: POST },
    }],
    scheduled_posts: [{
      id: POST, campaign_id: CAMPAIGN_A, user_id: USER_A, social_account_id: 'sa-owner-ig', platform: 'instagram',
      status: 'scheduled', error_code: null, platform_post_id: null, is_thread_start: false, parent_post_id: null,
      scheduled_for: ORIGINAL_AT, media_urls: ['a.mp4'], updated_at: 'db-ts-0',
    }],
  });
  mockJobs.length = 0;
  mockJobs.push({ at: ORIGINAL_AT, live: true });
}
const reschedule = (at: string) => invoke(rescheduleHandler as never, { method: 'POST', query: { id: PLAN }, body: { scheduled_at: at }, as: 'A' });
const post = () => rows('scheduled_posts').find((p) => p.id === POST) as Row;
const planRow = () => rows('daily_content_plans')[0] as Row;
const planContent = (): Row => { const c = planRow().content; return (typeof c === 'string' ? JSON.parse(c) : c) as Row; };
const liveJobs = () => mockJobs.filter((j) => j.live).map((j) => new Date(j.at).toISOString());
const deferred = () => { let open!: () => void; const p = new Promise<void>((r) => { open = r; }); return { p, open }; };
const t = (v: unknown) => new Date(String(v)).toISOString();

/** The invariant: post, plan (content + calendar column) and exactly one live job agree. */
function expectConsistent(at: string) {
  expect(t(post().scheduled_for)).toBe(at);
  expect(t(planContent().scheduled_at)).toBe(at);
  expect(planRow().scheduled_time).toBe(at.slice(11, 16));
  expect(liveJobs()).toEqual([at]);
  expect(planContent()).not.toHaveProperty('reschedule_incomplete');
}

beforeEach(() => {
  mockAtomicCalls = 0;
  mockAtomicHook = null;
  mockAtomicFail = false;
  mockDbTs = 0;
  mockPostReadGate = null;
  mockPostReads = 0;
  mockFailPlanUpdate = false;
  mockOnPlanFail = null;
});

describe('the reported race and its variants (Closure-014B, D-14B-2)', () => {
  it('stale QUEUE step: a reschedule arriving while another is about to re-queue is refused, so no stale time can be queued last', async () => {
    world();
    const reached = deferred(); const release = deferred();
    mockAtomicHook = async (n, stage) => { if (n === 1 && stage === 'before') { reached.open(); await release.p; } };
    const p12 = reschedule(AT_12);
    await reached.p;                       // 12:00 has written post + plan (holding the fence), is about to touch the queue
    const r15 = await reschedule(AT_15);   // 15:00 arrives meanwhile
    release.open();
    const r12 = await p12;
    expect(r15.status).toBe(409);
    expect(r15.body).toMatchObject({ code: 'RESCHEDULE_IN_PROGRESS', partial: false });
    expect(r12.status).toBe(200);
    expectConsistent(AT_12);               // before the fix: 15:00 also "won"; live job 12:00 under a 15:00 post
    expect(post().error_code).toBeNull();  // the fence is cleared
    expect(mockAtomicCalls).toBe(1);       // the refused request never touched the queue
  });

  it('interleaved queue steps (the observed run): no second reschedule can enqueue between another\'s cancel and enqueue', async () => {
    world();
    const reached = deferred(); const release = deferred();
    mockAtomicHook = async (n, stage) => { if (n === 1 && stage === 'mid') { reached.open(); await release.p; } };
    const p12 = reschedule(AT_12);
    await reached.p;                       // 12:00 cancelled the live job, has not enqueued yet
    const r15 = await reschedule(AT_15);
    release.open();
    const r12 = await p12;
    expect(r15.status).toBe(409);
    expect(r15.body).toMatchObject({ code: 'RESCHEDULE_IN_PROGRESS' });
    expect(r12.status).toBe(200);
    expectConsistent(AT_12);               // before the fix: plan content 12:00 + reschedule_incomplete (502) under a 15:00 post
  });

  it('stale PLAN write: a request that read the plan before a newer reschedule committed cannot overwrite it', async () => {
    world();
    const reached = deferred(); const release = deferred();
    mockPostReadGate = { n: 1, p: release.p, reached: reached.open }; // 12:00 has read the plan, not yet the post
    const p12 = reschedule(AT_12);
    await reached.p;
    const r15 = await reschedule(AT_15);
    release.open();
    const r12 = await p12;
    expect(r15.status).toBe(200);
    expect(r12.status).toBe(409);
    expect(r12.body).toMatchObject({ code: 'SCHEDULED_POST_CHANGED_CONCURRENTLY', partial: false });
    expectConsistent(AT_15);               // before the fix: plan and job at 12:00, post at 12:00, 12:00 answered 200
    expect(mockAtomicCalls).toBe(1);       // the loser never touched the queue
  });

  it.each([2, 3, 6])('%i concurrent reschedules: post, plan and the single live job always agree', async (n) => {
    world();
    const times = Array.from({ length: n }, (_, i) => `2027-03-10T${String(10 + i).padStart(2, '0')}:00:00.000Z`);
    const rs = await Promise.all(times.map((at) => reschedule(at)));
    expect(rs.filter((r) => r.status === 200).length).toBeGreaterThanOrEqual(1);
    expect(rs.every((r) => [200, 409].includes(r.status))).toBe(true);
    expectConsistent(t(post().scheduled_for));
    expect(times).toContain(t(post().scheduled_for));
  });
});

describe('the RESCHEDULING fence', () => {
  it('is written with the new time and cleared as the last write of a successful reschedule', async () => {
    world();
    let fenceSeen: unknown = null;
    mockAtomicHook = (n, stage) => { if (stage === 'before') fenceSeen = post().error_code; };
    const r = await reschedule(AT_12);
    expect(r.status).toBe(200);
    expect(String(fenceSeen)).toMatch(/^RESCHEDULING:\d+:/);
    expect(post().error_code).toBeNull();
  });

  it('a fence older than the stale window (a reschedule that died) is taken over', async () => {
    world();
    rows('scheduled_posts')[0].error_code = `RESCHEDULING:${Date.now() - 16 * 60 * 1000}:dead`;
    const r = await reschedule(AT_12);
    expect(r.status).toBe(200);
    expectConsistent(AT_12);
    expect(post().error_code).toBeNull();
  });

  it('a live fence is never taken over: 409 RESCHEDULE_IN_PROGRESS, nothing written', async () => {
    world();
    const fence = `RESCHEDULING:${Date.now()}:alive`;
    rows('scheduled_posts')[0].error_code = fence;
    const r = await reschedule(AT_12);
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: 'RESCHEDULE_IN_PROGRESS' });
    expect(post()).toMatchObject({ scheduled_for: ORIGINAL_AT, error_code: fence });
    expect(mockAtomicCalls).toBe(0);
  });

  it('a queue failure releases the fence (the item is not left blocked)', async () => {
    world();
    mockAtomicFail = true;
    const r = await reschedule(AT_12);
    expect(r.status).toBe(502);
    expect(post().error_code).toBeNull();
  });
});

describe('failure paths', () => {
  it('a plan write that fails after the post write is UNDONE in a database whose trigger owns updated_at', async () => {
    world();
    mockFailPlanUpdate = true;
    const r = await reschedule(AT_12);
    expect(r.status).toBe(500);
    expect(r.body).toMatchObject({ code: 'RESCHEDULE_PLAN_WRITE_FAILED', partial: false }); // before the fix: partial true, post left at 12:00
    expect(t(post().scheduled_for)).toBe(ORIGINAL_AT);
    expect(post().error_code).toBeNull(); // the undo restores the error_code read (and so drops the fence)
    expect(liveJobs()).toEqual([ORIGINAL_AT]);
  });

  it('the undo never clobbers a writer that changed only the status meanwhile (e.g. an unschedule): partial true', async () => {
    world();
    mockFailPlanUpdate = true;
    mockOnPlanFail = () => { const p = rows('scheduled_posts')[0]; p.status = 'cancelled'; p.updated_at = 'db-ts-other'; };
    const r = await reschedule(AT_12);
    expect(r.status).toBe(500);
    expect(r.body).toMatchObject({ code: 'RESCHEDULE_PLAN_WRITE_FAILED', partial: true });
    expect(post()).toMatchObject({ status: 'cancelled' });
    expect(t(post().scheduled_for)).toBe(AT_12); // the other writer's state, untouched by the undo
  });

  it('a queue failure with no competing reschedule still records the durable "repeat" marker on its own version (502)', async () => {
    world();
    mockAtomicFail = true;
    const r = await reschedule(AT_12);
    expect(r.status).toBe(502);
    expect(r.body).toMatchObject({ code: 'QUEUE_REENQUEUE_FAILED', incomplete_recorded: true });
    expect(planContent()).toHaveProperty('reschedule_incomplete');
    expect((planContent().reschedule_incomplete as Row).target_scheduled_at).toBe(AT_12);
  });

  it('the marker never lands on a plan version another writer produced (it reports incomplete_recorded:false)', async () => {
    world();
    mockAtomicFail = true;
    mockAtomicHook = (n, stage) => {
      if (n === 1 && stage === 'before') { const p = rows('daily_content_plans')[0]; p.updated_at = 'someone-else'; }
    };
    const r = await reschedule(AT_12);
    expect(r.status).toBe(502);
    expect(r.body).toMatchObject({ incomplete_recorded: false });
    expect(planContent()).not.toHaveProperty('reschedule_incomplete');
  });
});
