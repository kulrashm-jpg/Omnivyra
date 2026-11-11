/**
 * Plan-row existence oracle (e9, 2026-11-11): creator-bundle, creator-lifecycle and upload-media read
 * daily_content_plans on the service-role client BEFORE any authentication, so an ANONYMOUS caller could
 * tell a missing plan id ("Row not found: <id>") from a foreign one (403); upload-media also echoed the
 * row's content_type through its format 409 before authorization (the SEC-E6 class). They now go through
 * loadAuthorizedPlanRow:
 *   - anonymous -> 401 and NO plan read;
 *   - a non-member gets the SAME 404 for a foreign, a company-unresolvable and a missing plan;
 *   - format / state checks (409s) are reached only by a member.
 * In-memory harness: proves route ordering, not Postgres RLS.
 */
import { seed, invoke, calls, CAMPAIGN_A, UNKNOWN_ID } from '../helpers/routeAuthHarness';

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
// creator-lifecycle only needs reconcileContentWrite (PATCH); the orchestration index opens Redis at load.
jest.mock('../../services/orchestration', () => ({ reconcileContentWrite: jest.fn() }));
// As in activityWorkspaceAuthOrdering: the scheduler (Redis at load) is not under test here.
jest.mock('../../scheduler/schedulerService', () => ({
  tryAcquireScheduledPostQueueLock: jest.fn(async () => ({ acquired: true, release: async () => undefined })),
  cancelScheduledPostQueueEntry: jest.fn(async () => ({ db_cancelled: 1, queue_removed: 1, errors: [] })),
  enqueueScheduledPostAt: jest.fn(async () => 'enqueued'),
  atomicCancelAndReEnqueueScheduledPost: jest.fn(async () => ({ ok: true, locked: true, enqueue: 'enqueued', cancel: {}, idempotency_key: 'k' })),
}));

import bundleHandler from '../../../pages/api/activity-workspace/[id]/creator-bundle';
import lifecycleHandler from '../../../pages/api/activity-workspace/[id]/creator-lifecycle';
import uploadMediaHandler from '../../../pages/api/activity-workspace/[id]/upload-media';

const PLAN_TEXT = 'plan-t-0-0000-0000-00000000000t';
const PLAN_ORPHAN = 'plan-o-0-0000-0000-00000000000o';
const NOT_FOUND = { error: 'Not found', code: 'NOT_FOUND' };

function world() {
  seed({
    daily_content_plans: [
      // A TEXT row: a member gets a format/creator 409 for it; nobody else may learn that.
      { id: PLAN_TEXT, campaign_id: CAMPAIGN_A, content_type: 'post', platform: 'linkedin', content_status: 'draft', content: {}, intent_type: 'text', execution_id: null, week_number: 1 },
      { id: PLAN_ORPHAN, campaign_id: 'camp-none-0000-0000-000000000000', content_type: 'reel', platform: 'instagram', content_status: 'draft', content: {}, intent_type: 'creator', execution_id: null, week_number: 1 },
    ],
  });
}

const FLAG = 'ENABLE_CREATOR_WORKSPACE_LIFECYCLE';
const saved = process.env[FLAG];
beforeAll(() => { process.env[FLAG] = 'true'; });
afterAll(() => { if (saved === undefined) delete process.env[FLAG]; else process.env[FLAG] = saved; });

const ROUTES = [
  ['creator-bundle', bundleHandler, 'GET', {}],
  ['creator-lifecycle', lifecycleHandler, 'GET', {}],
  ['upload-media', uploadMediaHandler, 'POST', { media_url: 'https://cdn.example.com/v.mp4', source: 'external_link' }],
] as const;
const planReads = () => calls().filter((c) => c.table === 'daily_content_plans');

describe.each(ROUTES)('%s: no existence oracle', (_name, handler, method, body) => {
  const call = (planId: string, as: 'A' | 'B' | null) => invoke(handler as never, { method, query: { id: planId }, body, as });

  it('ANONYMOUS: the same 401 for an existing and a missing plan, and no plan row is read', async () => {
    world();
    const a = await call(PLAN_TEXT, null);
    const b = await call(UNKNOWN_ID, null);
    expect([a.status, b.status]).toEqual([401, 401]);
    expect(b.body).toEqual(a.body);
    expect(planReads()).toEqual([]);
  });

  it('a NON-MEMBER gets the byte-identical 404 for a foreign, a company-unresolvable and a missing plan', async () => {
    world();
    const answers = [await call(PLAN_TEXT, 'B'), await call(PLAN_ORPHAN, 'B'), await call(UNKNOWN_ID, 'B')];
    for (const r of answers) {
      expect(r.status).toBe(404);
      expect(r.body).toEqual(NOT_FOUND);
      expect(JSON.stringify(r.body)).not.toMatch(/post|text|linkedin/);
    }
  });

  it('only a MEMBER reaches the row-specific answer (the format / creator 409)', async () => {
    world();
    const r = await call(PLAN_TEXT, 'A');
    expect(r.status).toBe(409);
  });
});
