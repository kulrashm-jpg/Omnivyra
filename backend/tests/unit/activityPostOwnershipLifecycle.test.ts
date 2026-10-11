/**
 * Closure-005 — activity-workspace unschedule / reschedule: post ownership and
 * publication lifecycle.
 *
 * The real enforceCompanyAccess → TenantGuard chain runs (routeAuthHarness);
 * only the database, the identity provider, the queue and telemetry are fake.
 *
 * Before: both routes authorized the PLAN row at company level and then
 * cancelled / re-timed whatever scheduled post it linked — another member's
 * post, a published one (overwriting it to 'cancelled'), one being published,
 * or one whose outcome is uncertain — and ignored thread children.
 */
import {
  seed, invoke, rows, calls, CAMPAIGN_A, USER_A, USER_SUPER,
} from '../helpers/routeAuthHarness';

const mockEvents: string[] = [];
/** Runs before every scheduled_posts update reaches the fake (race injection). */
let mockBeforePostUpdate: (() => void) | null = null;
let mockReenqueueOk = true;

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => {
  const h = jest.requireActual('../helpers/routeAuthHarness');
  const supabase = {
    ...h.fakeSupabase,
    from: (t: string) => { mockEvents.push(`db:${t}`); return h.fakeSupabase.from(t); },
    storage: { from: () => ({ remove: jest.fn(async () => ({ data: null, error: null })) }) },
  };
  return { supabase, default: supabase, getSupabase: () => supabase, supabaseAdmin: supabase };
});
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => {
    const b = jest.requireActual('../helpers/routeAuthHarness').writeOwnerModule().ownedDbTable(t);
    const update = b.update;
    b.update = (p: unknown) => {
      mockEvents.push(`db:update:${t}`);
      if (t === 'scheduled_posts' && mockBeforePostUpdate) mockBeforePostUpdate();
      return update(p);
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
const mockAudit = jest.fn();
jest.mock('../../services/creatorAuditTrailService', () => ({ recordAuditEntry: (...a: unknown[]) => mockAudit(...a) }));
jest.mock('../../scheduler/schedulerService', () => ({
  tryAcquireScheduledPostQueueLock: jest.fn(async (id: string) => {
    mockEvents.push(`queue:lock:${id}`);
    return { acquired: true, release: async () => undefined };
  }),
  cancelScheduledPostQueueEntry: jest.fn(async (id: string) => { mockEvents.push(`queue:cancel:${id}`); return { db_cancelled: 1, queue_removed: 1, errors: [] }; }),
  enqueueScheduledPostAt: jest.fn(async (id: string) => { mockEvents.push(`queue:enqueue:${id}`); return 'enqueued'; }),
  atomicCancelAndReEnqueueScheduledPost: jest.fn(async (input: { scheduledPostId: string; userId: string }) => {
    mockEvents.push(`queue:reenqueue:${input.scheduledPostId}:${input.userId}`);
    return mockReenqueueOk
      ? { ok: true, locked: true, enqueue: 'enqueued', cancel: {}, idempotency_key: 'k' }
      : { ok: false, locked: true, enqueue: 'failed', cancel: {}, rollback: 'restored', idempotency_key: 'k' };
  }),
}));

import unscheduleHandler from '../../../pages/api/activity-workspace/[id]/unschedule';
import rescheduleHandler from '../../../pages/api/activity-workspace/[id]/reschedule';

type Row = Record<string, unknown>;
const TEAMMATE = 'user-t-00-0000-0000-00000000000t'; // another member of company A
const PLAN = 'plan-a-0-0000-0000-00000000000a';
const POST = '0a000000-0000-4000-8000-00000000000a';
const CHILD_1 = '0a000000-0000-4000-8000-0000000000c1';
const CHILD_2 = '0a000000-0000-4000-8000-0000000000c2';
const ORIGINAL_AT = '2027-03-10T14:30:00.000Z';
const NEW_AT = '2027-04-02T09:00:00.000Z';

function world(postOver: Row = {}, extraPosts: Row[] = [], planOver: Row = {}) {
  seed({
    daily_content_plans: [{
      id: PLAN, campaign_id: CAMPAIGN_A, content_type: 'reel', platform: 'instagram', content_status: 'scheduled',
      scheduled_time: '14:30', date: '2027-03-10', execution_id: null, week_number: 1,
      content: { creator_lifecycle_state: 'scheduled', scheduled_post_id: POST }, ...planOver,
    }],
    scheduled_posts: [
      {
        id: POST, campaign_id: CAMPAIGN_A, user_id: USER_A, social_account_id: 'sa-a', status: 'scheduled',
        error_code: null, platform_post_id: null, is_thread_start: false, parent_post_id: null,
        scheduled_for: ORIGINAL_AT, media_urls: ['a.mp4'], ...postOver,
      },
      ...extraPosts,
    ],
  });
}
const child = (id: string, over: Row = {}): Row => ({
  id, campaign_id: CAMPAIGN_A, user_id: USER_A, status: 'draft', error_code: null, platform_post_id: null,
  is_thread_start: false, parent_post_id: POST, scheduled_for: ORIGINAL_AT, ...over,
});
const unschedule = (as: 'A' | 'B' | 'SUPER' | null = 'A', body: Row = {}) =>
  invoke(unscheduleHandler as never, { method: 'POST', query: { id: PLAN }, body, as });
const reschedule = (as: 'A' | 'B' | 'SUPER' | null = 'A', body: Row = { scheduled_at: NEW_AT }) =>
  invoke(rescheduleHandler as never, { method: 'POST', query: { id: PLAN }, body, as });
const post = (id: string) => rows('scheduled_posts').find((p) => p.id === id) as Row;
/**
 * A concurrent writer: REPLACES the stored row (the harness hands out live row
 * references; a real database returns copies, so the route's earlier read must
 * not see the change).
 */
const concurrentWrite = (id: string, patch: Row) => {
  const table = rows('scheduled_posts');
  const i = table.findIndex((p) => p.id === id);
  table[i] = { ...table[i], ...patch };
};
const planState = () => (rows('daily_content_plans')[0].content as { creator_lifecycle_state?: string }).creator_lifecycle_state;
const postWrites = () => calls().filter((c) => c.table === 'scheduled_posts' && c.op === 'update');
const queueEffects = () => mockEvents.filter((e) => e.startsWith('queue:cancel') || e.startsWith('queue:reenqueue') || e.startsWith('queue:enqueue'));

beforeEach(() => {
  mockEvents.length = 0;
  mockBeforePostUpdate = null;
  mockReenqueueOk = true;
  mockAudit.mockClear();
});

// ─── Ownership ──────────────────────────────────────────────────────────────

describe.each([
  ['unschedule', () => unschedule('A')],
  ['reschedule', () => reschedule('A')],
])('%s — ownership', (_route, act) => {
  it("another member of the same company cannot change the post: 403, nothing written or queued", async () => {
    world({ user_id: TEAMMATE });
    const before = { ...post(POST) };
    const r = await act();
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ code: 'SCHEDULED_POST_NOT_OWNED' });
    expect(post(POST)).toEqual(before);
    expect(postWrites()).toEqual([]);
    expect(queueEffects()).toEqual([]);
    expect(planState()).toBe('scheduled');
  });
});

describe('ownership — identities and principals', () => {
  it('a caller-supplied user id cannot override the session (still 403 on a teammate\'s post)', async () => {
    world({ user_id: TEAMMATE });
    expect((await unschedule('A', { user_id: TEAMMATE, userId: TEAMMATE })).status).toBe(403);
    expect((await reschedule('A', { scheduled_at: NEW_AT, user_id: TEAMMATE, userId: TEAMMATE })).status).toBe(403);
    expect(post(POST).status).toBe('scheduled');
  });

  it('another tenant: 403 from the company gate, nothing touched', async () => {
    world();
    const before = { ...post(POST) };
    expect((await unschedule('B')).status).toBe(403);
    expect((await reschedule('B')).status).toBe(403);
    expect(post(POST)).toEqual(before);
    expect(queueEffects()).toEqual([]);
  });

  it('unauthenticated: 401 — and the row\'s state is not disclosed first', async () => {
    world({}, [], { content: { creator_lifecycle_state: 'upload_failed', scheduled_post_id: POST } });
    const u = await unschedule(null);
    const r = await reschedule(null);
    expect(u.status).toBe(401);
    expect(r.status).toBe(401);
    expect(JSON.stringify(u.body)).not.toMatch(/upload_failed|UNSCHEDULE_INVALID_STATE/);
  });

  it('the owner still unschedules (audited under the authenticated user) and re-times (re-queued under the post owner)', async () => {
    world();
    const u = await unschedule('A');
    expect(u.status).toBe(200);
    expect(post(POST).status).toBe('cancelled');
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'schedule_unscheduled', actorUserId: USER_A }));

    world();
    const r = await reschedule('A');
    expect(r.status).toBe(200);
    expect(post(POST).scheduled_for).toBe(NEW_AT);
    expect(mockEvents).toContain(`queue:reenqueue:${POST}:${USER_A}`);
  });

  it('a platform SUPER_ADMIN may act on another user\'s post (the same exception /api/social/publish makes)', async () => {
    world();
    const r = await unschedule('SUPER');
    expect(r.status).toBe(200);
    expect(post(POST).status).toBe('cancelled');
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: USER_SUPER }));
  });
});

// ─── Publication lifecycle ──────────────────────────────────────────────────

describe.each([
  ['unschedule', () => unschedule('A')],
  ['reschedule', () => reschedule('A')],
])('%s — states that must never be changed', (_route, act) => {
  it.each([
    ['published (platform_post_id kept)', { status: 'published', platform_post_id: 'ig_123' }, 'POST_ALREADY_PUBLISHED'],
    ['publishing — a call in flight', { status: 'publishing', error_code: 'PUBLISH_CALL_STARTED' }, 'POST_PUBLISH_IN_PROGRESS'],
    ['publishing — a pre-call claim', { status: 'publishing', error_code: 'PUBLISH_CLAIMED:t' }, 'POST_PUBLISH_IN_PROGRESS'],
    ['uncertain', { status: 'failed', error_code: 'PUBLISH_OUTCOME_UNCERTAIN' }, 'PUBLISH_OUTCOME_UNCERTAIN'],
    ['uncertain, already moved back to scheduled', { status: 'scheduled', error_code: 'PUBLISH_OUTCOME_UNCERTAIN' }, 'PUBLISH_OUTCOME_UNCERTAIN'],
  ])('%s → 409, the post is untouched (no write, no queue change)', async (_s, over, code) => {
    world(over);
    const before = { ...post(POST) };
    const r = await act();
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code });
    expect(post(POST)).toEqual(before);
    expect(postWrites()).toEqual([]);
    expect(queueEffects()).toEqual([]);
    expect(planState()).toBe('scheduled');
  });

  it('a thread CHILD is never changed on its own', async () => {
    world({ parent_post_id: 'root-x' });
    const r = await act();
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: 'THREAD_CHILD_NOT_STANDALONE' });
    expect(postWrites()).toEqual([]);
  });

  it('a thread root with a PUBLISHED child is refused; every node keeps its identity', async () => {
    world({ is_thread_start: true }, [child(CHILD_1, { status: 'published', platform_post_id: 'ig_c1' }), child(CHILD_2)]);
    const before = JSON.stringify(rows('scheduled_posts'));
    const r = await act();
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: 'POST_ALREADY_PUBLISHED', node_ids: [CHILD_1] });
    expect(JSON.stringify(rows('scheduled_posts'))).toBe(before);
  });

  it('a thread root with an uncertain child is refused', async () => {
    world({ is_thread_start: true }, [child(CHILD_1, { status: 'failed', error_code: null })]);
    const r = await act();
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: 'PUBLISH_OUTCOME_UNCERTAIN' });
  });

  it("a thread whose child belongs to someone else is refused", async () => {
    world({ is_thread_start: true }, [child(CHILD_1, { user_id: TEAMMATE })]);
    const r = await act();
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: 'THREAD_OWNERSHIP_CONFLICT' });
  });
});

describe('unschedule — threads and races', () => {
  it('an unpublished thread is unscheduled as a whole: root and every child cancelled, the root\'s job cancelled', async () => {
    world({ is_thread_start: true }, [child(CHILD_1), child(CHILD_2, { status: 'blocked' })]);
    const r = await unschedule('A');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ thread_children_cancelled: 2 });
    for (const id of [POST, CHILD_1, CHILD_2]) expect(post(id).status).toBe('cancelled');
    expect(mockEvents).toContain(`queue:cancel:${POST}`);
  });

  it('a publisher claims the post between the check and the cancel: the publisher wins, unschedule answers 409', async () => {
    world();
    mockBeforePostUpdate = () => { concurrentWrite(POST, { status: 'publishing', error_code: 'PUBLISH_CLAIMED:publisher' }); };
    const r = await unschedule('A');
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: 'SCHEDULED_POST_CHANGED_CONCURRENTLY' });
    expect(post(POST)).toMatchObject({ status: 'publishing', error_code: 'PUBLISH_CLAIMED:publisher' });
    expect(queueEffects()).toEqual([]);
    expect(planState()).toBe('scheduled');
  });

  it('the cancel is written before the queue job is cancelled', async () => {
    world();
    await unschedule('A');
    const write = mockEvents.indexOf('db:update:scheduled_posts');
    const cancel = mockEvents.indexOf(`queue:cancel:${POST}`);
    expect(write).toBeGreaterThan(-1);
    expect(cancel).toBeGreaterThan(write);
  });
});

describe('reschedule — races and honest results', () => {
  it('a publisher claims the post between the check and the re-time: 409 (partial), the claim is not overwritten, nothing re-queued', async () => {
    world();
    mockBeforePostUpdate = () => { concurrentWrite(POST, { status: 'publishing', error_code: 'PUBLISH_CALL_STARTED' }); };
    const r = await reschedule('A');
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: 'SCHEDULED_POST_CHANGED_CONCURRENTLY', partial: true });
    expect(post(POST)).toMatchObject({ status: 'publishing', scheduled_for: ORIGINAL_AT });
    expect(queueEffects()).toEqual([]);
  });

  it('the post is unscheduled (status only) between the check and the re-time: 409, the cancelled post is not re-timed', async () => {
    world();
    mockBeforePostUpdate = () => { concurrentWrite(POST, { status: 'cancelled' }); };
    const r = await reschedule('A');
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: 'SCHEDULED_POST_CHANGED_CONCURRENTLY' });
    expect(post(POST)).toMatchObject({ status: 'cancelled', scheduled_for: ORIGINAL_AT });
    expect(queueEffects()).toEqual([]);
  });

  it('a failed re-queue is reported (502 QUEUE_REENQUEUE_FAILED), not a false 200 "re_enqueued"', async () => {
    world();
    mockReenqueueOk = false;
    const r = await reschedule('A');
    expect(r.status).toBe(502);
    expect(r.body).toMatchObject({ code: 'QUEUE_REENQUEUE_FAILED', partial: true });
  });
});
