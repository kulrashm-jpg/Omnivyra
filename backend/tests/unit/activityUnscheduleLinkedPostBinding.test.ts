/**
 * 3AH-92 (S-3 class, sibling route) — /api/activity-workspace/[id]/unschedule
 * must only cancel the scheduled post that belongs to the authorized row's
 * campaign.
 *
 * THE DEFECT: the post id came from the row's content JSON
 * (`content.scheduled_post_id`), which a campaign member can write verbatim
 * (e.g. commit-daily-plan). The route authorized the ROW's company and then
 * cancelled the publish job of, and marked cancelled, whatever post that id
 * named — another tenant's post.
 *
 * The real enforceCompanyAccess → TenantGuard chain runs; only the database,
 * the identity provider, the queue and telemetry are fake. withIdempotency is
 * a pass-through here (its own suites cover it).
 */
import {
  seed, invoke, failTable, rows, calls, CAMPAIGN_A, CAMPAIGN_B, USER_A, USER_B,
} from '../helpers/routeAuthHarness';

const mockEvents: string[] = [];

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => {
  const h = jest.requireActual('../helpers/routeAuthHarness');
  const supabase = { ...h.fakeSupabase, from: (t: string) => { mockEvents.push(`db:${t}`); return h.fakeSupabase.from(t); } };
  return { supabase, default: supabase, getSupabase: () => supabase, supabaseAdmin: supabase };
});
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => {
    const b = jest.requireActual('../helpers/routeAuthHarness').writeOwnerModule().ownedDbTable(t);
    const update = b.update;
    b.update = (p: unknown) => { mockEvents.push(`db:update:${t}`); return update(p); };
    return b;
  },
}));
jest.mock('../../services/supabaseAuthService', () => jest.requireActual('../helpers/routeAuthHarness').authModule());
jest.mock('../../security/IdentityResolver', () => jest.requireActual('../helpers/routeAuthHarness').identityModule());
jest.mock('../../middleware/withIdempotency', () => ({ withIdempotency: (h: unknown) => h }));
jest.mock('../../services/creatorOperationalTelemetryService', () => ({
  emitCreatorEvent: jest.fn(),
  CREATOR_EVENTS: new Proxy({}, { get: (_t, key) => String(key) }),
}));
jest.mock('../../services/creatorAuditTrailService', () => ({ recordAuditEntry: jest.fn() }));
jest.mock('../../scheduler/schedulerService', () => ({
  tryAcquireScheduledPostQueueLock: jest.fn(async (id: string) => {
    mockEvents.push(`queue:lock:${id}`);
    return { acquired: true, release: async () => undefined };
  }),
  cancelScheduledPostQueueEntry: jest.fn(async (id: string) => { mockEvents.push(`queue:cancel:${id}`); return { db_cancelled: 1, queue_removed: 1, errors: [] }; }),
}));

import handler from '../../../pages/api/activity-workspace/[id]/unschedule';

const PLAN_A = 'plan-a-0-0000-0000-00000000000a';
const POST_A = '0a000000-0000-4000-8000-00000000000a';
const POST_B = '0b000000-0000-4000-8000-00000000000b';
const POST_B_SOLO = '0b000000-0000-4000-8000-0000000005b0';
const MISSING_POST = '0e000000-0000-4000-8000-00000000000e';

function planPointingAt(postId: string | null) {
  return {
    id: PLAN_A, campaign_id: CAMPAIGN_A, content_type: 'reel', platform: 'instagram', content_status: 'scheduled',
    content: { creator_lifecycle_state: 'scheduled', ...(postId ? { scheduled_post_id: postId } : {}) },
  };
}
function world(postId: string | null) {
  seed({
    daily_content_plans: [planPointingAt(postId)],
    scheduled_posts: [
      { id: POST_A, campaign_id: CAMPAIGN_A, user_id: USER_A, status: 'scheduled' },
      { id: POST_B, campaign_id: CAMPAIGN_B, user_id: USER_B, status: 'scheduled' },
      { id: POST_B_SOLO, campaign_id: null, user_id: USER_B, status: 'scheduled' },
    ],
  });
}

const call = (as: 'A' | 'B' | null = 'A') => invoke(handler as never, { method: 'POST', query: { id: PLAN_A }, body: {}, as });
const sideEffects = () => mockEvents.filter((e) => e.startsWith('db:update:') || e.startsWith('queue:'));
const post = (id: string) => rows('scheduled_posts').find((p) => p.id === id)!;
const rowState = () => (rows('daily_content_plans')[0].content as { creator_lifecycle_state?: string } | string);

beforeEach(() => { mockEvents.length = 0; });

describe('row content pointing at another tenant\'s post', () => {
  it.each([
    ['B\'s campaign post', POST_B],
    ['B\'s campaign_id NULL post', POST_B_SOLO],
  ])('%s → 409, no lock, cancel or write; B\'s post untouched', async (_n, target) => {
    world(target);
    const r = await call();
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: 'SCHEDULED_POST_NOT_IN_CAMPAIGN' });
    expect(sideEffects()).toEqual([]);
    expect(post(POST_B).status).toBe('scheduled');
    expect(post(POST_B_SOLO).status).toBe('scheduled');
    expect(rowState()).toEqual({ creator_lifecycle_state: 'scheduled', scheduled_post_id: target });
  });
  it('the linked-post read failing → 503, nothing cancelled or written', async () => {
    world(POST_B);
    failTable('scheduled_posts');
    const r = await call();
    expect(r.status).toBe(503);
    expect(sideEffects()).toEqual([]);
  });
});

describe('legitimate unschedules are unchanged', () => {
  it('row → its own campaign post: cancels that job, marks it cancelled, verified before any side effect', async () => {
    world(POST_A);
    const r = await call();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ success: true, scheduled_post_id: POST_A });
    expect(mockEvents).toContain(`queue:cancel:${POST_A}`);
    expect(post(POST_A).status).toBe('cancelled');
    // The cancel write repeats the campaign it was verified under.
    const postWrites = calls().filter((c) => c.table === 'scheduled_posts' && c.op === 'update');
    expect(postWrites.map((c) => c.filters)).toEqual([{ id: POST_A, campaign_id: CAMPAIGN_A }]);
    expect(post(POST_B).status).toBe('scheduled');
    const read = mockEvents.indexOf('db:scheduled_posts');
    expect(read).toBeGreaterThan(-1);
    expect(read).toBeLessThan(mockEvents.findIndex((e) => e.startsWith('queue:')));
  });
  it('a linked post that no longer exists: nothing to cancel, the row still unschedules', async () => {
    world(MISSING_POST);
    const r = await call();
    expect(r.status).toBe(200);
    expect(mockEvents.filter((e) => e.startsWith('queue:'))).toEqual([]);
    expect(mockEvents).toEqual(expect.not.arrayContaining(['db:update:scheduled_posts']));
    expect(post(POST_B).status).toBe('scheduled');
  });
  it('a row with no linked post still unschedules', async () => {
    world(null);
    const r = await call();
    expect(r.status).toBe(200);
    expect(mockEvents.filter((e) => e.startsWith('queue:'))).toEqual([]);
  });
  it('another company\'s member cannot unschedule A\'s row at all', async () => {
    world(POST_A);
    const r = await call('B');
    expect(r.status).toBe(403);
    expect(sideEffects()).toEqual([]);
    expect(post(POST_A).status).toBe('scheduled');
  });
  it('anonymous → 401, nothing cancelled or written', async () => {
    world(POST_A);
    const r = await call(null);
    expect(r.status).toBe(401);
    expect(sideEffects()).toEqual([]);
  });
});
