/**
 * Closure-006 Phase 4 — activity-workspace reschedule / unschedule: response
 * ordering for unauthenticated, cross-tenant, missing and conflicting
 * requests, with the REAL withIdempotency wrapper (other suites mock it away).
 *
 * withIdempotency resolves the principal before the handler runs, so an
 * unauthenticated caller gets the same 401 for an existing plan and a missing
 * one and the handler never reads a row. In-memory: proves the route's
 * ordering, not Postgres row-level security.
 */
import {
  seed, invoke, calls, rows, CAMPAIGN_A, USER_A, UNKNOWN_ID,
} from '../helpers/routeAuthHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => jest.requireActual('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => jest.requireActual('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => jest.requireActual('../helpers/routeAuthHarness').authModule());
jest.mock('../../security/IdentityResolver', () => jest.requireActual('../helpers/routeAuthHarness').identityModule());
jest.mock('../../services/mediaUploadValidationService', () => ({
  validateMediaUpload: jest.fn(async () => ({ valid: true, validated_at: 'now', details: {} })),
}));
jest.mock('../../services/creatorOperationalTelemetryService', () => ({
  emitCreatorEvent: jest.fn(),
  CREATOR_EVENTS: new Proxy({}, { get: (_t, key) => String(key) }),
}));
jest.mock('../../services/creatorAuditTrailService', () => ({ recordAuditEntry: jest.fn() }));
jest.mock('../../scheduler/schedulerService', () => ({
  tryAcquireScheduledPostQueueLock: jest.fn(async () => ({ acquired: true, release: async () => undefined })),
  cancelScheduledPostQueueEntry: jest.fn(async () => ({ db_cancelled: 1, queue_removed: 1, errors: [] })),
  enqueueScheduledPostAt: jest.fn(async () => 'enqueued'),
  atomicCancelAndReEnqueueScheduledPost: jest.fn(async () => ({ ok: true, locked: true, enqueue: 'enqueued', cancel: {}, idempotency_key: 'k' })),
}));

import rescheduleHandler from '../../../pages/api/activity-workspace/[id]/reschedule';
import unscheduleHandler from '../../../pages/api/activity-workspace/[id]/unschedule';

const PLAN = 'plan-a-0-0000-0000-00000000000a';
const POST = '0a000000-0000-4000-8000-00000000000a';
const NEW_AT = '2027-04-02T09:00:00.000Z';

function world(postOver: Record<string, unknown> = {}) {
  seed({
    daily_content_plans: [{
      id: PLAN, campaign_id: CAMPAIGN_A, content_type: 'reel', platform: 'instagram', content_status: 'scheduled',
      scheduled_time: '14:30', date: '2027-03-10', execution_id: null, week_number: 1,
      content: { creator_lifecycle_state: 'scheduled', scheduled_post_id: POST },
    }],
    scheduled_posts: [{
      id: POST, campaign_id: CAMPAIGN_A, user_id: USER_A, social_account_id: 'sa-a', status: 'scheduled',
      error_code: null, platform_post_id: null, is_thread_start: false, parent_post_id: null,
      scheduled_for: '2027-03-10T14:30:00.000Z', ...postOver,
    }],
  });
}

let keySeq = 0;
const ROUTES = [
  ['reschedule', rescheduleHandler, { scheduled_at: NEW_AT }],
  ['unschedule', unscheduleHandler, {}],
] as const;
const call = (handler: unknown, planId: string, body: Record<string, unknown>, as: 'A' | 'B' | null) =>
  invoke(handler as never, {
    method: 'POST', query: { id: planId }, body, as,
    headers: { 'idempotency-key': `c6-auth-order-${(keySeq += 1)}` },
  });
const rowReads = () => calls().filter((c) => c.table === 'daily_content_plans' || c.table === 'scheduled_posts');

describe.each(ROUTES)('%s — auth before any row is read or disclosed', (_name, handler, body) => {
  it('unauthenticated: the SAME 401 for an existing plan and a missing one, and no row is read', async () => {
    world();
    const existing = await call(handler, PLAN, body, null);
    const missing = await call(handler, UNKNOWN_ID, body, null);
    expect(existing.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(missing.body).toEqual(existing.body);
    expect(rowReads()).toEqual([]);
  });

  it('cross-tenant on an existing plan: 403, nothing written', async () => {
    world();
    const before = JSON.parse(JSON.stringify(rows('scheduled_posts')));
    const r = await call(handler, PLAN, body, 'B');
    expect(r.status).toBe(403);
    expect(rows('scheduled_posts')).toEqual(before);
  });

  it('an authenticated caller on a missing plan: 404', async () => {
    world();
    const r = await call(handler, UNKNOWN_ID, body, 'A');
    expect(r.status).toBe(404);
  });

  it('a post that is being published: 409, nothing written', async () => {
    world({ status: 'publishing', error_code: 'PUBLISH_CALL_STARTED' });
    const before = JSON.parse(JSON.stringify(rows('scheduled_posts')));
    const r = await call(handler, PLAN, body, 'A');
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: 'POST_PUBLISH_IN_PROGRESS' });
    expect(rows('scheduled_posts')).toEqual(before);
  });
});
