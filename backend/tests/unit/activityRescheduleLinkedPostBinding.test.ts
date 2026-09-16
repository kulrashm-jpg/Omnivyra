/**
 * 3AH-92 (S-3, sibling route) — /api/activity-workspace/[id]/reschedule must
 * only retime / re-media / re-enqueue the scheduled post that belongs to the
 * authorized row's campaign.
 *
 * THE DEFECT: the post id came from the row's content JSON
 * (`content.scheduled_post_id`), which a campaign member can write verbatim
 * (e.g. commit-daily-plan). The route authorized the ROW's company and then
 * updated whatever post that id named — another tenant's post — and
 * re-enqueued it on that tenant's user and social account.
 *
 * The real enforceCompanyAccess → TenantGuard chain runs; only the database,
 * the identity provider, the queue and telemetry are fake. withIdempotency is
 * a pass-through here (its own suites cover it).
 */
import {
  seed, invoke, failTable, rows, CAMPAIGN_A, CAMPAIGN_B, USER_A, USER_B,
} from '../helpers/routeAuthHarness';

const mockEvents: string[] = [];

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => {
  const h = jest.requireActual('../helpers/routeAuthHarness');
  const supabase = {
    ...h.fakeSupabase,
    from: (t: string) => { mockEvents.push(`db:${t}`); return h.fakeSupabase.from(t); },
    storage: { from: () => ({ remove: jest.fn(async (p: string[]) => { mockEvents.push(`storage:remove:${p.join(',')}`); return { data: null, error: null }; }) }) },
  };
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
jest.mock('../../services/mediaUploadValidationService', () => ({
  validateMediaUpload: jest.fn(async () => { mockEvents.push('media:validate'); return { valid: true, validated_at: 'now', details: {} }; }),
}));
jest.mock('../../services/creatorOperationalTelemetryService', () => ({
  emitCreatorEvent: jest.fn(),
  CREATOR_EVENTS: new Proxy({}, { get: (_t, key) => String(key) }),
}));
jest.mock('../../services/creatorAuditTrailService', () => ({ recordAuditEntry: jest.fn() }));
jest.mock('../../scheduler/schedulerService', () => ({
  cancelScheduledPostQueueEntry: jest.fn(async (id: string) => { mockEvents.push(`queue:cancel:${id}`); return { db_cancelled: 1, queue_removed: 1, errors: [] }; }),
  enqueueScheduledPostAt: jest.fn(async (id: string) => { mockEvents.push(`queue:enqueue:${id}`); return 'enqueued'; }),
  atomicCancelAndReEnqueueScheduledPost: jest.fn(async (input: { scheduledPostId: string; userId: string; socialAccountId: string }) => {
    mockEvents.push(`queue:reenqueue:${input.scheduledPostId}:${input.userId}:${input.socialAccountId}`);
    return { ok: true, locked: true, enqueue: 'enqueued', cancel: {}, idempotency_key: 'k' };
  }),
}));

import handler from '../../../pages/api/activity-workspace/[id]/reschedule';

const PLAN_A = 'plan-a-0-0000-0000-00000000000a';
const POST_A = '0a000000-0000-4000-8000-00000000000a';
const POST_B = '0b000000-0000-4000-8000-00000000000b';
const POST_B_SOLO = '0b000000-0000-4000-8000-0000000005b0';
const ORIGINAL_AT = '2027-03-10T14:30:00.000Z';
const NEW_AT = '2027-04-02T09:00:00.000Z';
const OLD_MEDIA = 'https://supabase.test/storage/v1/object/public/media-uploads/plan-a/video/old.mp4';

function planPointingAt(postId: string) {
  return {
    id: PLAN_A, campaign_id: CAMPAIGN_A, content_type: 'reel', platform: 'instagram', content_status: 'scheduled',
    scheduled_time: '14:30', date: '2027-03-10', execution_id: null, week_number: 1,
    content: { creator_lifecycle_state: 'scheduled', scheduled_post_id: postId, uploaded_media_url: OLD_MEDIA },
  };
}
function world(postId: string) {
  seed({
    daily_content_plans: [planPointingAt(postId)],
    scheduled_posts: [
      { id: POST_A, campaign_id: CAMPAIGN_A, user_id: USER_A, social_account_id: 'sa-a', status: 'scheduled', scheduled_for: ORIGINAL_AT, media_urls: ['a.mp4'] },
      { id: POST_B, campaign_id: CAMPAIGN_B, user_id: USER_B, social_account_id: 'sa-b', status: 'scheduled', scheduled_for: ORIGINAL_AT, media_urls: ['b.mp4'] },
      { id: POST_B_SOLO, campaign_id: null, user_id: USER_B, social_account_id: 'sa-b', status: 'scheduled', scheduled_for: ORIGINAL_AT, media_urls: ['b.mp4'] },
    ],
  });
}

const call = (body: Record<string, unknown>, as: 'A' | 'B' | null = 'A') =>
  invoke(handler as any, { method: 'POST', query: { id: PLAN_A }, body, as });
const sideEffects = () => mockEvents.filter((e) => e.startsWith('db:update:') || e.startsWith('queue:') || e.startsWith('storage:') || e === 'media:validate');
const post = (id: string) => rows('scheduled_posts').find((p) => p.id === id)!;

beforeEach(() => { mockEvents.length = 0; });

describe('row content pointing at another tenant\'s post', () => {
  it.each([
    ['B\'s campaign post, retime', POST_B, { scheduled_at: NEW_AT }],
    ['B\'s campaign post, media swap + retime', POST_B, { scheduled_at: NEW_AT, media_url: 'https://evil.test/x.mp4' }],
    ['B\'s campaign post, media swap only', POST_B, { media_url: 'https://evil.test/x.mp4' }],
    ['B\'s campaign_id NULL post, retime', POST_B_SOLO, { scheduled_at: NEW_AT }],
    ['a post that does not exist', '0e000000-0000-4000-8000-00000000000e', { scheduled_at: NEW_AT }],
  ])('%s → 409, nothing written, validated, deleted or enqueued', async (_n, target, body) => {
    world(target);
    const r = await call(body);
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: 'SCHEDULED_POST_NOT_IN_CAMPAIGN' });
    expect(sideEffects()).toEqual([]);
    for (const id of [POST_B, POST_B_SOLO]) {
      expect(post(id).scheduled_for).toBe(ORIGINAL_AT);
      expect(post(id).media_urls).toEqual(['b.mp4']);
    }
    expect(rows('daily_content_plans')[0].content.scheduled_post_id).toBe(target);
  });
  it('the linked-post read failing → 503, nothing written or enqueued', async () => {
    world(POST_B);
    failTable('scheduled_posts');
    const r = await call({ scheduled_at: NEW_AT });
    expect(r.status).toBe(503);
    expect(sideEffects()).toEqual([]);
  });
});

describe('legitimate reschedules are unchanged', () => {
  it('row → its own campaign post: retime updates the post and re-enqueues on the owner\'s account', async () => {
    world(POST_A);
    const r = await call({ scheduled_at: NEW_AT });
    expect(r.status).toBe(200);
    expect(post(POST_A).scheduled_for).toBe(NEW_AT);
    expect(mockEvents).toContain(`queue:reenqueue:${POST_A}:${USER_A}:sa-a`);
    const read = mockEvents.indexOf('db:scheduled_posts');
    expect(read).toBeGreaterThan(-1);
    expect(read).toBeLessThan(mockEvents.findIndex((e) => e.startsWith('db:update:')));
  });
  it('another company\'s member cannot reschedule A\'s row at all', async () => {
    world(POST_A);
    const r = await call({ scheduled_at: NEW_AT }, 'B');
    expect(r.status).toBe(403);
    expect(sideEffects()).toEqual([]);
  });
  it('anonymous → 401, nothing written', async () => {
    world(POST_A);
    const r = await call({ scheduled_at: NEW_AT }, null);
    expect(r.status).toBe(401);
    expect(sideEffects()).toEqual([]);
  });
});
