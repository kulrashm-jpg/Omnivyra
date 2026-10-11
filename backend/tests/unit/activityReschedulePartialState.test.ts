/**
 * Closure-006 — activity-workspace reschedule: partial-state safety and
 * account scoping on platform moves.
 *
 * The real enforceCompanyAccess → TenantGuard chain runs (routeAuthHarness);
 * only the database, the identity provider, the queue, storage and telemetry
 * are fake. In-memory: these tests pin the route's ordering and its answers,
 * they prove nothing about Postgres isolation or concurrency.
 *
 * Before:
 *   - the plan row was re-timed FIRST, so a post compare-and-set that then
 *     lost a race (or failed) left a re-timed plan over an unchanged post;
 *   - the compare-and-set did not pin the row version, so two concurrent
 *     re-times both passed;
 *   - the prior media object was deleted before either write;
 *   - a failed re-queue left no durable trace on the row;
 *   - a platform move picked ANY active company account for the target
 *     platform — possibly a teammate's.
 */
import {
  seed, invoke, rows, CO_A, CO_B, CAMPAIGN_A, USER_A,
} from '../helpers/routeAuthHarness';

const mockEvents: string[] = [];
/** Runs before every scheduled_posts update reaches the fake (race injection). */
let mockBeforePostUpdate: ((n: number) => void) | null = null;
let mockPostUpdates = 0;
/** When it returns true for a daily_content_plans update payload, that write fails. */
let mockFailPlanUpdate: ((payload: Record<string, unknown>) => boolean) | null = null;
let mockQueue: 'ok' | 'failed' | 'locked' = 'ok';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => {
  const h = jest.requireActual('../helpers/routeAuthHarness');
  const supabase = {
    ...h.fakeSupabase,
    from: (t: string) => { mockEvents.push(`db:${t}`); return h.fakeSupabase.from(t); },
    storage: {
      from: (bucket: string) => ({
        remove: jest.fn(async (p: string[]) => { mockEvents.push(`storage:remove:${bucket}:${p.join(',')}`); return { data: null, error: null }; }),
      }),
    },
  };
  return { supabase, default: supabase, getSupabase: () => supabase, supabaseAdmin: supabase };
});
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => {
    const b = jest.requireActual('../helpers/routeAuthHarness').writeOwnerModule().ownedDbTable(t);
    const update = b.update;
    b.update = (p: Record<string, unknown>) => {
      mockEvents.push(`db:update:${t}`);
      if (t === 'scheduled_posts') {
        mockPostUpdates += 1;
        if (mockBeforePostUpdate) mockBeforePostUpdate(mockPostUpdates);
      }
      const q = update(p);
      if (t === 'daily_content_plans' && mockFailPlanUpdate && mockFailPlanUpdate(p)) {
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
  return {
    assertBlueprintMutable: jest.fn(async () => undefined),
    BlueprintImmutableError, BlueprintExecutionFreezeError, BlueprintMutabilityReadError,
  };
});
jest.mock('../../scheduler/schedulerService', () => ({
  tryAcquireScheduledPostQueueLock: jest.fn(async () => ({ acquired: true, release: async () => undefined })),
  cancelScheduledPostQueueEntry: jest.fn(async (id: string) => { mockEvents.push(`queue:cancel:${id}`); return { db_cancelled: 1, queue_removed: 1, errors: [] }; }),
  enqueueScheduledPostAt: jest.fn(async (id: string) => { mockEvents.push(`queue:enqueue:${id}`); return 'enqueued'; }),
  atomicCancelAndReEnqueueScheduledPost: jest.fn(async (input: { scheduledPostId: string; userId: string; socialAccountId: string; newScheduledFor: string }) => {
    mockEvents.push(`queue:reenqueue:${input.scheduledPostId}:${input.userId}:${input.socialAccountId}:${input.newScheduledFor}`);
    if (mockQueue === 'locked') return { ok: false, locked: false, enqueue: 'skipped', cancel: {}, idempotency_key: 'k' };
    if (mockQueue === 'failed') return { ok: false, locked: true, enqueue: 'failed', cancel: {}, rollback: 'restored', idempotency_key: 'k' };
    return { ok: true, locked: true, enqueue: 'enqueued', cancel: {}, idempotency_key: 'k' };
  }),
}));

import rescheduleHandler from '../../../pages/api/activity-workspace/[id]/reschedule';

// Hermetic storage origin (placeholder host — never a real project).
const STORAGE_ORIGIN = 'https://placeholder.supabase.co';
process.env.SUPABASE_URL = STORAGE_ORIGIN;
process.env.NEXT_PUBLIC_SUPABASE_URL = STORAGE_ORIGIN;
const own = (key: string) => `${STORAGE_ORIGIN}/storage/v1/object/public/media-uploads/${key}`;

type Row = Record<string, unknown>;
const TEAMMATE = 'user-t-00-0000-0000-00000000000t'; // another member of company A
const PLAN = 'plan-a-0-0000-0000-00000000000a';
const POST = '0a000000-0000-4000-8000-00000000000a';
const ORIGINAL_AT = '2027-03-10T14:30:00.000Z';
const NEW_AT = '2027-04-02T09:00:00.000Z';
const OTHER_AT = '2027-05-05T05:00:00.000Z';
const VERSION_0 = '2027-01-01T00:00:00.000Z';
const OLD_KEY = `${PLAN}/video/old.mp4`;
const NEW_MEDIA = own(`${PLAN}/video/new.mp4`);

function world(postOver: Row = {}, accounts: Row[] = [], planContentOver: Row = {}) {
  seed({
    daily_content_plans: [{
      id: PLAN, campaign_id: CAMPAIGN_A, content_type: 'reel', platform: 'instagram', content_status: 'scheduled',
      scheduled_time: '14:30', date: '2027-03-10', execution_id: null, week_number: 1,
      content: { creator_lifecycle_state: 'scheduled', scheduled_post_id: POST, uploaded_media_url: own(OLD_KEY), ...planContentOver },
    }],
    scheduled_posts: [{
      id: POST, campaign_id: CAMPAIGN_A, user_id: USER_A, social_account_id: 'sa-owner-ig', platform: 'instagram',
      status: 'scheduled', error_code: null, platform_post_id: null, is_thread_start: false, parent_post_id: null,
      scheduled_for: ORIGINAL_AT, media_urls: ['a.mp4'], updated_at: VERSION_0, ...postOver,
    }],
    social_accounts: accounts,
  });
}
const reschedule = (body: Row = { scheduled_at: NEW_AT }) =>
  invoke(rescheduleHandler as never, { method: 'POST', query: { id: PLAN }, body, as: 'A' });
const post = () => rows('scheduled_posts').find((p) => p.id === POST) as Row;
const plan = () => rows('daily_content_plans')[0];
const planContent = (): Row => {
  const c = plan().content;
  return (typeof c === 'string' ? JSON.parse(c) : c) as Row;
};
/** A concurrent writer: REPLACES the stored row (the harness hands out live references). */
const concurrentWrite = (patch: Row) => {
  const table = rows('scheduled_posts');
  const i = table.findIndex((p) => p.id === POST);
  table[i] = { ...table[i], ...patch };
};
const queueEffects = () => mockEvents.filter((e) => e.startsWith('queue:'));
const removes = () => mockEvents.filter((e) => e.startsWith('storage:remove:'));
const snapshot = <T>(v: T): T => JSON.parse(JSON.stringify(v));

beforeEach(() => {
  mockEvents.length = 0;
  mockBeforePostUpdate = null;
  mockPostUpdates = 0;
  mockFailPlanUpdate = null;
  mockQueue = 'ok';
});

describe('write order: the guarded post compare-and-set comes first', () => {
  it('a successful re-time writes the post, then the plan, then the queue', async () => {
    world();
    const r = await reschedule();
    expect(r.status).toBe(200);
    const postWrite = mockEvents.indexOf('db:update:scheduled_posts');
    const planWrite = mockEvents.indexOf('db:update:daily_content_plans');
    const queue = mockEvents.findIndex((e) => e.startsWith('queue:reenqueue'));
    expect(postWrite).toBeGreaterThan(-1);
    expect(planWrite).toBeGreaterThan(postWrite);
    expect(queue).toBeGreaterThan(planWrite);
    expect(post()).toMatchObject({ scheduled_for: NEW_AT });
    expect(post().updated_at).not.toBe(VERSION_0);
  });
});

describe('concurrent reschedules', () => {
  it('another re-time lands between the read and the write: 409, NOTHING written by the loser, nothing re-queued', async () => {
    world();
    const planBefore = snapshot(plan());
    // Same status, same error_code — only the version and the time move.
    mockBeforePostUpdate = () => { concurrentWrite({ scheduled_for: OTHER_AT, updated_at: '2027-02-02T00:00:00.000Z' }); };
    const r = await reschedule();
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: 'SCHEDULED_POST_CHANGED_CONCURRENTLY', partial: false });
    expect(post()).toMatchObject({ scheduled_for: OTHER_AT, updated_at: '2027-02-02T00:00:00.000Z' });
    expect(plan()).toEqual(planBefore);
    expect(queueEffects()).toEqual([]);
  });

  it('a post with no recorded version is pinned on updated_at IS NULL (a concurrent writer that sets one wins)', async () => {
    world({ updated_at: null });
    mockBeforePostUpdate = () => { concurrentWrite({ scheduled_for: OTHER_AT, updated_at: '2027-02-02T00:00:00.000Z' }); };
    const r = await reschedule();
    expect(r.status).toBe(409);
    expect(post()).toMatchObject({ scheduled_for: OTHER_AT });
    expect(queueEffects()).toEqual([]);
  });

  it('sequential re-times (a retry after success) each succeed against the version they read', async () => {
    world();
    expect((await reschedule()).status).toBe(200);
    const r = await reschedule({ scheduled_at: OTHER_AT });
    expect(r.status).toBe(200);
    expect(post()).toMatchObject({ scheduled_for: OTHER_AT });
    expect(queueEffects().filter((e) => e.startsWith('queue:reenqueue'))).toHaveLength(2);
  });
});

describe('plan write fails after the post write', () => {
  it('the post write is undone (compare-and-set on its own version): 500, partial false, nothing queued, no object deleted', async () => {
    world();
    mockFailPlanUpdate = () => true;
    const r = await reschedule({ scheduled_at: NEW_AT, media_url: NEW_MEDIA });
    expect(r.status).toBe(500);
    expect(r.body).toMatchObject({ code: 'RESCHEDULE_PLAN_WRITE_FAILED', partial: false });
    expect(r.body.recovery).toBeUndefined();
    expect(post()).toMatchObject({ scheduled_for: ORIGINAL_AT, media_urls: ['a.mp4'], status: 'scheduled' });
    expect(queueEffects()).toEqual([]);
    expect(removes()).toEqual([]);
  });

  it('a writer that moved the post on before the undo is NOT clobbered: partial true with an explicit recovery', async () => {
    world();
    mockFailPlanUpdate = () => true;
    // 1st post update = the re-time; before the 2nd (the undo) another writer lands.
    mockBeforePostUpdate = (n) => { if (n === 2) concurrentWrite({ scheduled_for: OTHER_AT, updated_at: '2027-09-09T00:00:00.000Z' }); };
    const r = await reschedule();
    expect(r.status).toBe(500);
    expect(r.body).toMatchObject({
      code: 'RESCHEDULE_PLAN_WRITE_FAILED', partial: true, recovery: 'repeat_reschedule', scheduled_post_id: POST,
    });
    expect(post()).toMatchObject({ scheduled_for: OTHER_AT, updated_at: '2027-09-09T00:00:00.000Z' });
    expect(queueEffects()).toEqual([]);
  });
});

describe('queue step fails after the post and plan writes: durable, observable, repairable', () => {
  it.each([
    ['re-enqueue failure', 'failed', 502, 'QUEUE_REENQUEUE_FAILED', 'reenqueue_failed'],
    ['queue lock contention', 'locked', 409, 'CONCURRENT_QUEUE_MUTATION', 'lock_contention'],
  ] as const)('%s: partial answer + marker on the plan row; repeating the reschedule converges and clears it', async (_n, mode, status, code, reason) => {
    world();
    mockQueue = mode;
    const r1 = await reschedule();
    expect(r1.status).toBe(status);
    expect(r1.body).toMatchObject({ code, partial: true, recovery: 'repeat_reschedule', incomplete_recorded: true, scheduled_post_id: POST });
    expect(post()).toMatchObject({ scheduled_for: NEW_AT, status: 'scheduled', platform_post_id: null });
    expect(planContent().reschedule_incomplete).toMatchObject({
      stage: 'queue', reason, scheduled_post_id: POST, target_scheduled_at: NEW_AT, recovery: 'repeat_reschedule',
    });

    // Recovery: the SAME reschedule again (idempotent — same target time).
    mockQueue = 'ok';
    const r2 = await reschedule();
    expect(r2.status).toBe(200);
    expect(planContent().reschedule_incomplete).toBeUndefined();
    expect(post()).toMatchObject({ scheduled_for: NEW_AT, status: 'scheduled' });
    const reenqueues = queueEffects().filter((e) => e.startsWith('queue:reenqueue'));
    expect(reenqueues).toHaveLength(2);
    expect(reenqueues[1]).toBe(`queue:reenqueue:${POST}:${USER_A}:sa-owner-ig:${NEW_AT}`);
  });

  it('a marker that could not be written is reported as such (incomplete_recorded: false), never as recorded', async () => {
    world();
    mockQueue = 'failed';
    mockFailPlanUpdate = (p) => typeof p.content === 'string' && p.content.includes('reschedule_incomplete');
    const r = await reschedule();
    expect(r.status).toBe(502);
    expect(r.body).toMatchObject({ code: 'QUEUE_REENQUEUE_FAILED', partial: true, incomplete_recorded: false });
    expect(planContent().reschedule_incomplete).toBeUndefined();
  });

  it('a stale marker from an earlier attempt is cleared by the next successful reschedule', async () => {
    world({}, [], { reschedule_incomplete: { stage: 'queue', reason: 'reenqueue_failed', target_scheduled_at: OTHER_AT } });
    const r = await reschedule();
    expect(r.status).toBe(200);
    expect(planContent().reschedule_incomplete).toBeUndefined();
  });
});

describe('the prior media object is deleted only after every write has landed', () => {
  it('success: deleted exactly once, after the post and plan writes', async () => {
    world();
    const r = await reschedule({ scheduled_at: NEW_AT, media_url: NEW_MEDIA });
    expect(r.status).toBe(200);
    expect(removes()).toEqual([`storage:remove:media-uploads:${OLD_KEY}`]);
    const del = mockEvents.indexOf(`storage:remove:media-uploads:${OLD_KEY}`);
    expect(del).toBeGreaterThan(mockEvents.lastIndexOf('db:update:daily_content_plans'));
    expect(del).toBeGreaterThan(mockEvents.indexOf('db:update:scheduled_posts'));
  });

  it('a lost post race deletes nothing (the row still points at the old object)', async () => {
    world();
    mockBeforePostUpdate = () => { concurrentWrite({ updated_at: '2027-02-02T00:00:00.000Z' }); };
    const r = await reschedule({ scheduled_at: NEW_AT, media_url: NEW_MEDIA });
    expect(r.status).toBe(409);
    expect(removes()).toEqual([]);
    expect(planContent().uploaded_media_url).toBe(own(OLD_KEY));
  });
});

describe('platform move: the target account is the POST OWNER\'s', () => {
  const acct = (id: string, user: string, over: Row = {}): Row => ({
    id, user_id: user, company_id: CO_A, platform: 'tiktok', is_active: true, ...over,
  });

  it('a teammate\'s account for the target platform is never chosen; the owner\'s is', async () => {
    world({}, [acct('sa-teammate-tt', TEAMMATE), acct('sa-owner-tt', USER_A)]);
    const r = await reschedule({ platform: 'tiktok', scheduled_at: NEW_AT });
    expect(r.status).toBe(200);
    expect(post()).toMatchObject({ social_account_id: 'sa-owner-tt', platform: 'tiktok' });
    expect(queueEffects().filter((e) => e.startsWith('queue:reenqueue'))).toEqual([
      `queue:reenqueue:${POST}:${USER_A}:sa-owner-tt:${NEW_AT}`,
    ]);
  });

  it.each([
    ['only a teammate has one', [acct('sa-teammate-tt', TEAMMATE)]],
    ['the owner\'s is inactive', [acct('sa-owner-tt', USER_A, { is_active: false })]],
    ['the owner\'s is in another company', [acct('sa-owner-tt', USER_A, { company_id: CO_B })]],
    ['the owner\'s is for another platform', [acct('sa-owner-x', USER_A, { platform: 'x' })]],
  ])('%s: 422 MOVE_NO_CONNECTED_ACCOUNT, nothing written or queued', async (_n, accounts) => {
    world({}, accounts as Row[]);
    const before = { post: snapshot(post()), plan: snapshot(plan()) };
    const r = await reschedule({ platform: 'tiktok', scheduled_at: NEW_AT });
    expect(r.status).toBe(422);
    expect(r.body).toMatchObject({ code: 'MOVE_NO_CONNECTED_ACCOUNT' });
    expect(post()).toEqual(before.post);
    expect(plan()).toEqual(before.plan);
    expect(queueEffects()).toEqual([]);
  });
});
