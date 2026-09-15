/**
 * ROUTE-AUTH-001 (STEP 3AH-85) — thread runtime, legacy scheduled posts and
 * content-opportunity lifecycle: request-supplied tenant ids are bound to the
 * authenticated caller before any read, write or side effect.
 *
 * The real guard chain runs; only the database, the identity provider, the
 * trace store/reconstructor, the legacy scheduler and publish-media resolution
 * are faked. Every denial asserts the sink was not reached.
 */
import {
  seed, invoke, rows, writeCalls, leaksB,
  CO_A, CO_B, CAMPAIGN_A, CAMPAIGN_B, UNKNOWN_ID, USER_A, USER_B,
} from '../helpers/routeAuthHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/routeAuthHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/routeAuthHarness').identityModule());

// Thread runtime: the per-company trace bucket is the sink.
const mockTraceQuery = jest.fn(async () => [] as unknown[]);
jest.mock('../../services/threadRuntime/persistentTraceStore', () => ({
  getDefaultPersistentTraceStore: () => ({ query: (...a: any[]) => (mockTraceQuery as any)(...a) }),
}));
const mockReplay = jest.fn(async () => ({ trace: { events: [] }, contributingSessions: [], dedupedCount: 0, rewrittenCount: 0 }));
jest.mock('../../services/threadRuntime/globalRuntimeReplayReconstructor', () => ({ reconstructReplay: (...a: any[]) => (mockReplay as any)(...a) }));
jest.mock('../../services/threadRuntime/distributedRuntimeCorrelationEngine', () => ({ resolveDistributedCorrelation: () => ({ groups: [] }) }));
jest.mock('../../services/threadRuntime/runtimeForensicAnalyzer', () => ({ analyzeRuntimeForensics: () => ({ findings: [] }) }));
jest.mock('../../services/threadRuntime/runtimeAnalyticsAggregator', () => ({ aggregateRuntimeAnalytics: async () => null }));
jest.mock('../../services/threadRuntime/runtimeGovernanceScore', () => ({ computeRuntimeGovernanceScore: () => ({ score: 1 }) }));
jest.mock('../../services/threadRuntime/threadRuntimeTimelineBuilder', () => ({
  buildThreadRuntimeTimeline: () => ({ entries: [] }),
  formatThreadRuntimeTimeline: () => 'timeline',
}));

// Legacy scheduled posts: the scheduler is user-bound; publish-media resolution is the sink.
const mockGetPost = jest.fn(async (i: { userId: string; id: string }) => (i.id === 'post-a' && i.userId === USER_A ? { id: 'post-a' } : null));
const mockUpdatePost = jest.fn(async () => undefined);
jest.mock('../../services/structuredPlanScheduler', () => ({
  getLegacyScheduledPostById: (...a: any[]) => (mockGetPost as any)(...a),
  updateLegacyScheduledPost: (...a: any[]) => (mockUpdatePost as any)(...a),
  cancelLegacyScheduledPost: jest.fn(async () => undefined),
  publishLegacyScheduledPostNow: jest.fn(async () => undefined),
}));
jest.mock('../../scheduler/schedulerService', () => ({ enqueueScheduledPostAt: jest.fn(async () => undefined) }));
const mockResolvePublishMedia = jest.fn(async () => ({ mediaUrls: ['https://storage/resolved.png'], totalRefs: 1, resolvedCount: 1, usedFallback: false }));
jest.mock('../../services/creator/creatorPublishResolution', () => ({ resolvePublishMedia: (...a: any[]) => (mockResolvePublishMedia as any)(...a) }));

/* eslint-disable @typescript-eslint/no-var-requires */
const failures = require('../../../pages/api/threadRuntime/failures').default;
const introspect = require('../../../pages/api/threadRuntime/introspect').default;
const replay = require('../../../pages/api/threadRuntime/replay').default;
const timeline = require('../../../pages/api/threadRuntime/timeline').default;
const schedulePost = require('../../../pages/api/schedule/posts/[id]').default;
const lifecycle = require('../../../pages/api/engagement/content-opportunities/lifecycle').default;
/* eslint-enable @typescript-eslint/no-var-requires */

const OPP_A = 'opp-a-000-0000-0000-00000000000a';
const OPP_B = 'opp-b-000-0000-0000-00000000000b';

beforeEach(() => {
  seed({
    engagement_content_opportunities: [
      { id: OPP_A, organization_id: CO_A, status: 'new', campaign_id: null },
      { id: OPP_B, organization_id: CO_B, status: 'new', campaign_id: null },
    ],
  });
  [mockTraceQuery, mockReplay, mockGetPost, mockUpdatePost, mockResolvePublishMedia].forEach((m) => m.mockClear());
});

/* ───────────────────────────── thread runtime ───────────────────────────── */

describe.each([
  ['failures', () => failures, { threadId: 't1' }],
  ['introspect', () => introspect, { threadId: 't1' }],
  ['replay', () => replay, { threadId: 't1' }],
  ['timeline', () => timeline, { threadId: 't1' }],
])('threadRuntime/%s', (_name, h, extra) => {
  const traceTouched = () => mockTraceQuery.mock.calls.length + mockReplay.mock.calls.length;

  it('unauthenticated → 401, trace store never queried', async () => {
    const r = await invoke(h(), { as: null, query: { companyId: CO_A, ...extra } });
    expect(r.status).toBe(401);
    expect(traceTouched()).toBe(0);
  });
  it('member of A naming company B → 403, B\'s trace bucket never queried', async () => {
    const r = await invoke(h(), { as: 'A', query: { companyId: CO_B, ...extra } });
    expect(r.status).toBe(403);
    expect(traceTouched()).toBe(0);
    expect(leaksB(r.body)).toBe(false);
  });
  it('member of A with own company → 200, queried with company A only', async () => {
    const r = await invoke(h(), { as: 'A', query: { companyId: CO_A, ...extra } });
    expect(r.status).toBe(200);
    expect(traceTouched()).toBeGreaterThan(0);
    const companies = [...mockTraceQuery.mock.calls, ...mockReplay.mock.calls].map((c: any[]) => c[0].companyId);
    expect(new Set(companies)).toEqual(new Set([CO_A]));
  });
  it('unknown company → 403', async () => {
    expect((await invoke(h(), { as: 'A', query: { companyId: UNKNOWN_ID, ...extra } })).status).toBe(403);
    expect(traceTouched()).toBe(0);
  });
});

/* ───────────────────────── schedule/posts/[id] PUT ───────────────────────── */

describe('schedule/posts/[id]', () => {
  const put = (as: 'A' | 'B' | null, id: string, body: Record<string, unknown>) =>
    invoke(schedulePost, { method: 'PUT', as, query: { id }, body });

  it('unauthenticated → 401, nothing resolved or updated', async () => {
    const r = await put(null, 'post-a', { companyId: CO_A, assetRefs: [{ assetId: 'x' }] });
    expect(r.status).toBe(401);
    expect(mockResolvePublishMedia).not.toHaveBeenCalled();
    expect(mockUpdatePost).not.toHaveBeenCalled();
  });
  it('another user\'s post → 404 (unchanged user binding)', async () => {
    const r = await put('B', 'post-a', { content: 'x' });
    expect(r.status).toBe(404);
    expect(mockUpdatePost).not.toHaveBeenCalled();
  });
  it('THE EXPLOIT: own post + companyId=B with creator asset refs → 403, B\'s assets never resolved, post not updated', async () => {
    const r = await put('A', 'post-a', { companyId: CO_B, assetRefs: [{ assetId: 'asset-of-b' }], mediaUrls: [] });
    expect(r.status).toBe(403);
    expect(mockResolvePublishMedia).not.toHaveBeenCalled();
    expect(mockUpdatePost).not.toHaveBeenCalled();
  });
  it('own post + own companyId → media resolved under company A, post updated', async () => {
    const r = await put('A', 'post-a', { companyId: CO_A, assetRefs: [{ assetId: 'asset-of-a' }], mediaUrls: [] });
    expect(r.status).toBe(200);
    expect(mockResolvePublishMedia).toHaveBeenCalledWith(expect.objectContaining({ companyId: CO_A, userId: USER_A }));
    expect(mockUpdatePost).toHaveBeenCalledTimes(1);
  });
  it('no companyId (what the scheduler UI sends) → unchanged behaviour', async () => {
    const r = await put('A', 'post-a', { assetRefs: [{ assetId: 'asset-of-a' }], mediaUrls: [] });
    expect(r.status).toBe(200);
    expect(mockResolvePublishMedia).toHaveBeenCalledWith(expect.objectContaining({ companyId: USER_A, userId: USER_A }));
  });
  it('companyId without media fields is not used and not required to bind', async () => {
    const r = await put('A', 'post-a', { companyId: CO_B, content: 'text only' });
    expect(r.status).toBe(200);
    expect(mockResolvePublishMedia).not.toHaveBeenCalled();
  });
});

/* ─────────────────── engagement/content-opportunities/lifecycle ─────────────────── */

describe('engagement/content-opportunities/lifecycle', () => {
  const patch = (as: 'A' | 'B' | null, body: Record<string, unknown>) => invoke(lifecycle, { method: 'PATCH', as, body });
  const oppWrites = () => writeCalls(['engagement_content_opportunities']);

  it('unauthenticated → 401, nothing written', async () => {
    const r = await patch(null, { id: OPP_A, action: 'complete', organization_id: CO_A });
    expect(r.status).toBe(401);
    expect(oppWrites()).toHaveLength(0);
  });
  it('organization B → 403, nothing written', async () => {
    const r = await patch('A', { id: OPP_B, action: 'complete', organization_id: CO_B });
    expect(r.status).toBe(403);
    expect(oppWrites()).toHaveLength(0);
  });
  it('an opportunity of B addressed through org A is never touched', async () => {
    await patch('A', { id: OPP_B, action: 'complete', organization_id: CO_A });
    expect(rows('engagement_content_opportunities').find((o) => o.id === OPP_B)?.status).toBe('new');
  });
  it('link_campaign with B\'s campaign → 404, campaign never stored', async () => {
    const r = await patch('A', { id: OPP_A, action: 'link_campaign', organization_id: CO_A, campaign_id: CAMPAIGN_B });
    expect(r.status).toBe(404);
    expect(oppWrites()).toHaveLength(0);
    expect(rows('engagement_content_opportunities').find((o) => o.id === OPP_A)?.campaign_id).toBeNull();
  });
  it('link_campaign with a not-yet-existing campaign id is not a cross-tenant link (unchanged behaviour)', async () => {
    // The shared binder denies campaigns owned by ANOTHER company (above); an id
    // with no campaign behind it belongs to nobody, so no tenant is exposed.
    const r = await patch('A', { id: OPP_A, action: 'link_campaign', organization_id: CO_A, campaign_id: UNKNOWN_ID });
    expect(r.status).toBe(200);
  });
  it('link_campaign with own campaign → 200 and stored', async () => {
    const r = await patch('A', { id: OPP_A, action: 'link_campaign', organization_id: CO_A, campaign_id: CAMPAIGN_A });
    expect(r.status).toBe(200);
    expect(rows('engagement_content_opportunities').find((o) => o.id === OPP_A)?.campaign_id).toBe(CAMPAIGN_A);
  });
  it('assign to a user of another tenant → 400, nothing written', async () => {
    const r = await patch('A', { id: OPP_A, action: 'assign', organization_id: CO_A, user_id: USER_B });
    expect(r.status).toBe(400);
    expect(oppWrites()).toHaveLength(0);
  });
  it('assign with no user_id assigns the caller (what the UI sends)', async () => {
    const r = await patch('A', { id: OPP_A, action: 'assign', organization_id: CO_A });
    expect(r.status).toBe(200);
    expect(rows('engagement_content_opportunities').find((o) => o.id === OPP_A)?.assigned_to).toBe(USER_A);
  });
  it('assign to another active member of the same organization → 200', async () => {
    seed({
      user_company_roles: [{ user_id: 'user-a2-0-0000-0000-0000000000a2', company_id: CO_A, role: 'CONTENT_CREATOR', status: 'active' }],
      engagement_content_opportunities: [{ id: OPP_A, organization_id: CO_A, status: 'new' }],
    });
    const r = await patch('A', { id: OPP_A, action: 'assign', organization_id: CO_A, user_id: 'user-a2-0-0000-0000-0000000000a2' });
    expect(r.status).toBe(200);
    expect(rows('engagement_content_opportunities').find((o) => o.id === OPP_A)?.assigned_to).toBe('user-a2-0-0000-0000-0000000000a2');
  });
});
