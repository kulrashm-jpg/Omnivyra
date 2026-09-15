/**
 * ROUTE-AUTH-001 (STEP 3AH-85) — "Data, admin and diagnostics" family, part 1:
 * tenant- and user-scoped data routes.
 *
 *   analytics/platform/[platform]   user-owned rows: owner = authenticated caller
 *   analytics/post/[postId]         post → campaign company (or post owner)
 *   analytics/posting               authenticate only (no tenant data)
 *   analytics/tracking-assist       authenticate only (no tenant data)
 *   content-adapter/config          user-owned rows: owner = authenticated caller
 *   companies/[id]/efficiency       enforceCompanyAccess(path id)
 *   companies/[id]/intelligence     enforceCompanyAccess(path id)
 *   governance/summary              enforceCompanyAccess(companyId)
 *   governance/campaign-analytics   requireCampaignAccess(campaignId)
 *   performance/campaign/[id]       requireCampaignAccess(id) + client companyId check
 *   performance/collect             requireCampaignAccess(campaign_id) + recommendation binding
 *   performance/ingest              asset → campaign → requireCampaignAccess
 *   admin/autonomous/decisions      enforceCompanyAccess(company_id, campaign_id)
 *   user/subscription               enforceCompanyAccess(company_id)
 *
 * Only the database and the identity provider are faked; the real guards run.
 * Every denial also asserts the SINK (mocked service / table) was not reached.
 */
import {
  seed, invoke, sinkCalls, writeCalls, leaksB, rows,
  CO_A, CO_B, CAMPAIGN_A, CAMPAIGN_B, UNKNOWN_ID, USER_A, USER_B, CANARY_B,
} from '../helpers/routeAuthHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/routeAuthHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/routeAuthHarness').identityModule());

// ── sinks (paid / heavy / data services the routes call) ──────────────────────
const mockGetPlatformPerformance = jest.fn(async (..._a: any[]) => [{ platform: 'linkedin', total_posts: 1 }]);
const mockGetPostAnalytics = jest.fn(async (..._a: any[]) => [{ scheduled_post_id: 'x', engagement_rate: 1 }]);
jest.mock('../../services/analyticsService', () => ({
  getPlatformPerformance: (...a: any[]) => mockGetPlatformPerformance(...a),
  getPostAnalytics: (...a: any[]) => mockGetPostAnalytics(...a),
}));
const mockTrackingAssist = jest.fn((..._a: any[]) => ({ status: 'ok', script: '<script/>', placement_instructions: [], validation_steps: [] }));
jest.mock('../../services/googleAnalyticsExperienceService', () => ({
  buildTrackingAssistResponse: (...a: any[]) => mockTrackingAssist(...a),
}));
const mockOutcomeStats = jest.fn(async (..._a: any[]) => ({ avg_credits_per_outcome: 1, total_outcomes: 2 }));
jest.mock('../../services/outcomeTrackingService', () => ({
  getCompanyOutcomeStats: (...a: any[]) => mockOutcomeStats(...a),
}));
const mockOptimize = jest.fn(async (..._a: any[]) => ({ tier: 'standard', actions_taken: [] }));
jest.mock('../../services/creditEfficiencyEngine', () => ({
  optimizeCreditEfficiency: (...a: any[]) => mockOptimize(...a),
}));
const mockGovSummary = jest.fn(async (..._a: any[]) => ({ companyId: 'x', totalEvents: 0 }));
jest.mock('../../services/GovernanceMetricsService', () => ({
  getGovernanceSummary: (...a: any[]) => mockGovSummary(...a),
}));
const mockCampaignGovAnalytics = jest.fn(async (id: string) => ({ campaignId: id, totalEvents: 0 }));
jest.mock('../../services/GovernanceAnalyticsService', () => ({
  getCampaignGovernanceAnalytics: (...a: any[]) => mockCampaignGovAnalytics(...(a as [string])),
}));
const mockListDecisionObjects = jest.fn(async (..._a: any[]) => []);
jest.mock('../../services/decisionObjectService', () => ({
  listDecisionObjects: (...a: any[]) => mockListDecisionObjects(...a),
}));
jest.mock('../../services/intelligenceExecutionContext', () => ({
  runInApiReadContext: (_name: string, fn: () => unknown) => fn(),
}));
const mockAggregate = jest.fn(async (id: string) => ({ campaign_id: id, impressions: 5 }));
const mockRecordPerformance = jest.fn(async (..._a: any[]) => true);
jest.mock('../../services/performanceFeedbackService', () => ({
  aggregateCampaignPerformance: (...a: any[]) => mockAggregate(...(a as [string])),
  recordPerformance: (...a: any[]) => mockRecordPerformance(...a),
}));
const mockIngest = jest.fn(async (..._a: any[]) => undefined);
jest.mock('../../services/performanceIngestionService', () => ({
  ingestPerformanceData: (...a: any[]) => mockIngest(...a),
}));
const mockGetDecisionLog = jest.fn(async (..._a: any[]) => []);
jest.mock('../../services/autonomousDecisionLogger', () => ({
  getDecisionLog: (...a: any[]) => mockGetDecisionLog(...a),
}));
const mockDetectPatterns = jest.fn(async (..._a: any[]) => ({ patterns: [] }));
const mockEvolveStrategy = jest.fn(async (..._a: any[]) => null);
jest.mock('../../services/patternDetectionService', () => ({ detectWinningPatterns: (...a: any[]) => mockDetectPatterns(...a) }));
jest.mock('../../services/marketPositioningEngine', () => ({ evaluateMarketPosition: async () => null }));
jest.mock('../../services/competitorIntelligenceService', () => ({ fetchCompetitorSignals: async () => null }));
jest.mock('../../services/strategyEvolutionEngine', () => ({ evolveStrategy: (...a: any[]) => mockEvolveStrategy(...a) }));
jest.mock('../../services/portfolioDecisionEngine', () => ({ evaluatePortfolioDecision: async () => null }));
jest.mock('../../services/learningDecayService', () => ({ getEffectiveLearnings: async () => [] }));
jest.mock('../../services/globalPatternService', () => ({ injectGlobalPatternsIntoPrompt: async () => '' }));
jest.mock('../../services/billing/phase2EnforcementGate', () => ({
  PaymentRequiredError: class PaymentRequiredError extends Error { code = 'PAYMENT_REQUIRED'; },
}));
const mockPlanLimits = jest.fn(async (..._a: any[]) => ({ plan_key: 'pro', limits: { seats: 5 } }));
jest.mock('../../services/planResolutionService', () => ({
  resolveOrganizationPlanLimits: (...a: any[]) => mockPlanLimits(...a),
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const platformHandler = require('../../../pages/api/analytics/platform/[platform]').default;
const postAnalyticsHandler = require('../../../pages/api/analytics/post/[postId]').default;
const postingHandler = require('../../../pages/api/analytics/posting').default;
const trackingAssistHandler = require('../../../pages/api/analytics/tracking-assist').default;
const adapterConfigHandler = require('../../../pages/api/content-adapter/config').default;
const efficiencyHandler = require('../../../pages/api/companies/[id]/efficiency').default;
const intelligenceHandler = require('../../../pages/api/companies/[id]/intelligence').default;
const govSummaryHandler = require('../../../pages/api/governance/summary').default;
const campaignAnalyticsHandler = require('../../../pages/api/governance/campaign-analytics').default;
const perfCampaignHandler = require('../../../pages/api/performance/campaign/[id]').default;
const perfCollectHandler = require('../../../pages/api/performance/collect').default;
const perfIngestHandler = require('../../../pages/api/performance/ingest').default;
const decisionsHandler = require('../../../pages/api/admin/autonomous/decisions').default;
const subscriptionHandler = require('../../../pages/api/user/subscription').default;
/* eslint-enable @typescript-eslint/no-var-requires */

const POST_A = 'post-a-00-0000-0000-00000000000a';
const POST_B = 'post-b-00-0000-0000-00000000000b';
const POST_A_SOLO = 'post-as-0-0000-0000-00000000000a';
const POST_B_SOLO = 'post-bs-0-0000-0000-00000000000b';
const REC_A = 'rec-a-000-0000-0000-00000000000a';
const REC_B = 'rec-b-000-0000-0000-00000000000b';
const ASSET_A = 'asset-a-0-0000-0000-00000000000a';
const ASSET_B = 'asset-b-0-0000-0000-00000000000b';

beforeEach(() => {
  seed({
    scheduled_posts: [
      { id: POST_A, user_id: USER_A, campaign_id: CAMPAIGN_A, platform: 'linkedin', content: 'a' },
      { id: POST_B, user_id: USER_B, campaign_id: CAMPAIGN_B, platform: 'linkedin', content: CANARY_B },
      { id: POST_A_SOLO, user_id: USER_A, campaign_id: null, platform: 'x', content: 'a' },
      { id: POST_B_SOLO, user_id: USER_B, campaign_id: null, platform: 'x', content: CANARY_B },
    ],
    adapter_configs: [
      { user_id: USER_A, platform: 'linkedin', auto_truncate: false, custom_rules: {} },
      { user_id: USER_B, platform: 'linkedin', auto_truncate: true, custom_rules: { note: CANARY_B } },
    ],
    recommendation_snapshots: [
      { id: REC_A, company_id: CO_A, campaign_id: CAMPAIGN_A },
      { id: REC_B, company_id: CO_B, campaign_id: CAMPAIGN_B },
    ],
    content_assets: [
      { asset_id: ASSET_A, campaign_id: CAMPAIGN_A, week_number: 1, day: 'mon', platform: 'linkedin' },
      { asset_id: ASSET_B, campaign_id: CAMPAIGN_B, week_number: 1, day: 'mon', platform: 'linkedin' },
    ],
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/analytics/platform/[platform] (user-owned platform_performance)', () => {
  const q = { platform: 'linkedin', start_date: '2026-01-01', end_date: '2026-02-01' };

  it('unauthenticated → 401, service never reached', async () => {
    const r = await invoke(platformHandler, { as: null, query: { ...q, user_id: USER_B } });
    expect(r.status).toBe(401);
    expect(mockGetPlatformPerformance).not.toHaveBeenCalled();
  });
  it('signed-in user reads their OWN rows', async () => {
    const r = await invoke(platformHandler, { as: 'A', query: q });
    expect(r.status).toBe(200);
    expect(mockGetPlatformPerformance).toHaveBeenCalledWith(USER_A, 'linkedin', expect.any(Date), expect.any(Date));
  });
  it('client-supplied user_id of another user is ignored (was: read that user\'s rows)', async () => {
    const r = await invoke(platformHandler, { as: 'A', query: { ...q, user_id: USER_B } });
    expect(r.status).toBe(200);
    expect(mockGetPlatformPerformance).toHaveBeenCalledTimes(1);
    expect(mockGetPlatformPerformance.mock.calls[0][0]).toBe(USER_A);
    expect(JSON.stringify(mockGetPlatformPerformance.mock.calls)).not.toContain(USER_B);
  });
});

describe('GET /api/analytics/post/[postId] (post → campaign company or post owner)', () => {
  it('unauthenticated → 401 before the post is looked up', async () => {
    const r = await invoke(postAnalyticsHandler, { as: null, query: { postId: POST_A } });
    expect(r.status).toBe(401);
    expect(sinkCalls(['scheduled_posts'])).toHaveLength(0);
    expect(mockGetPostAnalytics).not.toHaveBeenCalled();
  });
  it('member of A reads analytics of A\'s campaign post', async () => {
    const r = await invoke(postAnalyticsHandler, { as: 'A', query: { postId: POST_A } });
    expect(r.status).toBe(200);
    expect(mockGetPostAnalytics).toHaveBeenCalledWith(POST_A, undefined, undefined);
  });
  it('member of A cannot read B\'s campaign post → 403/404, no analytics read', async () => {
    const r = await invoke(postAnalyticsHandler, { as: 'A', query: { postId: POST_B } });
    expect([403, 404]).toContain(r.status);
    expect(leaksB(r.body)).toBe(false);
    expect(mockGetPostAnalytics).not.toHaveBeenCalled();
  });
  it('a post outside any campaign is readable by its owner only', async () => {
    expect((await invoke(postAnalyticsHandler, { as: 'A', query: { postId: POST_A_SOLO } })).status).toBe(200);
    const foreign = await invoke(postAnalyticsHandler, { as: 'A', query: { postId: POST_B_SOLO } });
    expect(foreign.status).toBe(404);
    expect(mockGetPostAnalytics).toHaveBeenCalledTimes(1);
    expect(mockGetPostAnalytics.mock.calls[0][0]).toBe(POST_A_SOLO);
  });
  it('unknown and foreign solo posts get the same answer (no existence oracle)', async () => {
    const unknown = await invoke(postAnalyticsHandler, { as: 'A', query: { postId: UNKNOWN_ID } });
    const foreign = await invoke(postAnalyticsHandler, { as: 'A', query: { postId: POST_B_SOLO } });
    expect([unknown.status, unknown.body]).toEqual([foreign.status, foreign.body]);
  });
});

describe('GET /api/analytics/posting and POST /api/analytics/tracking-assist (no tenant data)', () => {
  it('posting: unauthenticated → 401; signed in → 200', async () => {
    expect((await invoke(postingHandler, { as: null })).status).toBe(401);
    expect((await invoke(postingHandler, { as: 'A' })).status).toBe(200);
  });
  it('tracking-assist: unauthenticated → 401, builder never reached', async () => {
    const r = await invoke(trackingAssistHandler, { method: 'POST', as: null, body: { website_url: 'https://a.test', platform: 'wordpress' } });
    expect(r.status).toBe(401);
    expect(mockTrackingAssist).not.toHaveBeenCalled();
  });
  it('tracking-assist: signed in → 200', async () => {
    const r = await invoke(trackingAssistHandler, { method: 'POST', as: 'A', body: { website_url: 'https://a.test', platform: 'wordpress' } });
    expect(r.status).toBe(200);
    expect(mockTrackingAssist).toHaveBeenCalledTimes(1);
  });
});

describe('GET/POST /api/content-adapter/config (user-owned adapter_configs)', () => {
  it('unauthenticated GET/POST → 401, table never touched', async () => {
    expect((await invoke(adapterConfigHandler, { as: null, query: { user_id: USER_B } })).status).toBe(401);
    expect((await invoke(adapterConfigHandler, { method: 'POST', as: null, query: { user_id: USER_B }, body: { platform: 'linkedin', config: {} } })).status).toBe(401);
    expect(sinkCalls(['adapter_configs'])).toHaveLength(0);
  });
  it('GET returns the caller\'s own configs, without the ?user_id the UI never sent', async () => {
    const r = await invoke(adapterConfigHandler, { as: 'A' });
    expect(r.status).toBe(200);
    expect(r.body.configs.linkedin.autoTruncate).toBe(false);
  });
  it('GET with ?user_id=B still returns A\'s configs (client user id ignored)', async () => {
    const r = await invoke(adapterConfigHandler, { as: 'A', query: { user_id: USER_B } });
    expect(r.status).toBe(200);
    expect(r.body.configs.linkedin.autoTruncate).toBe(false);
    expect(leaksB(r.body)).toBe(false);
    expect(sinkCalls(['adapter_configs']).every((c) => c.filters.user_id === USER_A)).toBe(true);
  });
  it('POST with ?user_id=B writes A\'s row, never B\'s', async () => {
    const r = await invoke(adapterConfigHandler, {
      method: 'POST', as: 'A', query: { user_id: USER_B },
      body: { platform: 'x', config: { autoTruncate: true, autoFormatHashtags: true, preserveLinks: true, customRules: {} } },
    });
    expect(r.status).toBe(200);
    const writes = writeCalls(['adapter_configs']);
    expect(writes).toHaveLength(1);
    expect((writes[0].payload as any).user_id).toBe(USER_A);
    expect(rows('adapter_configs').filter((x) => x.user_id === USER_B)).toHaveLength(1);
  });
});

describe('/api/companies/[id]/efficiency', () => {
  it('unauthenticated GET/POST → 401, services never reached', async () => {
    expect((await invoke(efficiencyHandler, { as: null, query: { id: CO_A } })).status).toBe(401);
    expect((await invoke(efficiencyHandler, { method: 'POST', as: null, query: { id: CO_A } })).status).toBe(401);
    expect(mockOutcomeStats).not.toHaveBeenCalled();
    expect(mockOptimize).not.toHaveBeenCalled();
  });
  it('member of A cannot read or optimize company B → 403', async () => {
    expect((await invoke(efficiencyHandler, { as: 'A', query: { id: CO_B } })).status).toBe(403);
    const post = await invoke(efficiencyHandler, { method: 'POST', as: 'A', query: { id: CO_B } });
    expect(post.status).toBe(403);
    expect(leaksB(post.body)).toBe(false);
    expect(mockOutcomeStats).not.toHaveBeenCalled();
    expect(mockOptimize).not.toHaveBeenCalled();
  });
  it('member of A reads and optimizes company A', async () => {
    expect((await invoke(efficiencyHandler, { as: 'A', query: { id: CO_A } })).status).toBe(200);
    expect((await invoke(efficiencyHandler, { method: 'POST', as: 'A', query: { id: CO_A } })).status).toBe(200);
    expect(mockOutcomeStats).toHaveBeenCalledWith(CO_A);
    expect(mockOptimize).toHaveBeenCalledWith(CO_A);
  });
});

describe('GET /api/companies/[id]/intelligence (was: identity only)', () => {
  it('unauthenticated → 401, no intelligence service runs', async () => {
    const r = await invoke(intelligenceHandler, { as: null, query: { id: CO_A } });
    expect(r.status).toBe(401);
    expect(mockDetectPatterns).not.toHaveBeenCalled();
  });
  it('member of A naming company B → 403; no read, write or credit charge for B', async () => {
    const r = await invoke(intelligenceHandler, { as: 'A', query: { id: CO_B } });
    expect(r.status).toBe(403);
    expect(leaksB(r.body)).toBe(false);
    expect(mockDetectPatterns).not.toHaveBeenCalled();
    expect(mockEvolveStrategy).not.toHaveBeenCalled();
    expect(mockGetDecisionLog).not.toHaveBeenCalled();
  });
  it('member of A → 200 for company A', async () => {
    const r = await invoke(intelligenceHandler, { as: 'A', query: { id: CO_A } });
    expect(r.status).toBe(200);
    expect(mockDetectPatterns).toHaveBeenCalledWith(CO_A);
    expect(mockEvolveStrategy).toHaveBeenCalledWith(CO_A);
  });
});

describe('GET /api/governance/summary', () => {
  it('unauthenticated → 401, summary never computed', async () => {
    expect((await invoke(govSummaryHandler, { as: null, query: { companyId: CO_A } })).status).toBe(401);
    expect(mockGovSummary).not.toHaveBeenCalled();
  });
  it('member of A naming company B → 403', async () => {
    const r = await invoke(govSummaryHandler, { as: 'A', query: { companyId: CO_B } });
    expect(r.status).toBe(403);
    expect(mockGovSummary).not.toHaveBeenCalled();
  });
  it('member of A → 200 for company A', async () => {
    expect((await invoke(govSummaryHandler, { as: 'A', query: { companyId: CO_A } })).status).toBe(200);
    expect(mockGovSummary).toHaveBeenCalledWith(CO_A);
  });
});

describe('GET /api/governance/campaign-analytics', () => {
  it('unauthenticated → 401, nothing read', async () => {
    const r = await invoke(campaignAnalyticsHandler, { as: null, query: { campaignId: CAMPAIGN_A } });
    expect(r.status).toBe(401);
    expect(mockCampaignGovAnalytics).not.toHaveBeenCalled();
    expect(mockListDecisionObjects).not.toHaveBeenCalled();
  });
  it('member of A with B\'s campaign → 403/404, nothing read', async () => {
    const r = await invoke(campaignAnalyticsHandler, { as: 'A', query: { campaignId: CAMPAIGN_B } });
    expect([403, 404]).toContain(r.status);
    expect(leaksB(r.body)).toBe(false);
    expect(mockCampaignGovAnalytics).not.toHaveBeenCalled();
    expect(mockListDecisionObjects).not.toHaveBeenCalled();
  });
  it('member of A with own campaign → 200, decisions scoped to A', async () => {
    const r = await invoke(campaignAnalyticsHandler, { as: 'A', query: { campaignId: CAMPAIGN_A } });
    expect(r.status).toBe(200);
    expect(mockListDecisionObjects).toHaveBeenCalledWith(expect.objectContaining({ companyId: CO_A, entityId: CAMPAIGN_A }));
  });
  it('a divergent campaigns.company_id can no longer choose the tenant (owner record wins)', async () => {
    seed({ campaigns: [{ id: 'camp-div', company_id: CO_B }], campaign_versions: [{ campaign_id: 'camp-div', company_id: CO_A, created_at: '2026-02-01' }] });
    const r = await invoke(campaignAnalyticsHandler, { as: 'A', query: { campaignId: 'camp-div' } });
    expect(r.status).toBe(200);
    expect(mockListDecisionObjects).toHaveBeenCalledWith(expect.objectContaining({ companyId: CO_A }));
    expect(JSON.stringify(mockListDecisionObjects.mock.calls)).not.toContain(CO_B);
  });
});

describe('GET /api/performance/campaign/[id]', () => {
  it('unauthenticated → 401, aggregate never read', async () => {
    expect((await invoke(perfCampaignHandler, { as: null, query: { id: CAMPAIGN_A } })).status).toBe(401);
    expect(mockAggregate).not.toHaveBeenCalled();
  });
  it('member of A with B\'s campaign → 403/404', async () => {
    const r = await invoke(perfCampaignHandler, { as: 'A', query: { id: CAMPAIGN_B } });
    expect([403, 404]).toContain(r.status);
    expect(leaksB(r.body)).toBe(false);
    expect(mockAggregate).not.toHaveBeenCalled();
  });
  it('member of A with own campaign (and matching companyId, as the UI sends) → 200', async () => {
    const r = await invoke(perfCampaignHandler, { as: 'A', query: { id: CAMPAIGN_A, companyId: CO_A } });
    expect(r.status).toBe(200);
    expect(mockAggregate).toHaveBeenCalledWith(CAMPAIGN_A);
  });
  it('client-supplied companyId=B cannot override the bound tenant → 403', async () => {
    const r = await invoke(perfCampaignHandler, { as: 'A', query: { id: CAMPAIGN_A, companyId: CO_B } });
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: 'Access denied to company' });
    expect(mockAggregate).not.toHaveBeenCalled();
  });
});

describe('POST /api/performance/collect', () => {
  const body = (over: Record<string, unknown> = {}) => ({ campaign_id: CAMPAIGN_A, platform: 'linkedin', post_id: 'p-1', source: 'manual', impressions: 10, ...over });

  it('unauthenticated → 401, nothing recorded', async () => {
    const r = await invoke(perfCollectHandler, { method: 'POST', as: null, body: body() });
    expect(r.status).toBe(401);
    expect(mockRecordPerformance).not.toHaveBeenCalled();
  });
  it('member of A recording against B\'s campaign → 403/404, nothing recorded', async () => {
    const r = await invoke(perfCollectHandler, { method: 'POST', as: 'A', body: body({ campaign_id: CAMPAIGN_B }) });
    expect([403, 404]).toContain(r.status);
    expect(mockRecordPerformance).not.toHaveBeenCalled();
  });
  it('member of A recording against own campaign (with own recommendation) → 200', async () => {
    const r = await invoke(perfCollectHandler, { method: 'POST', as: 'A', body: body({ recommendation_id: REC_A }) });
    expect(r.status).toBe(200);
    expect(mockRecordPerformance).toHaveBeenCalledWith(expect.objectContaining({ campaign_id: CAMPAIGN_A, recommendation_id: REC_A }));
  });
  it('B\'s recommendation id cannot be attached to A\'s campaign → 404 (same as unknown)', async () => {
    const foreign = await invoke(perfCollectHandler, { method: 'POST', as: 'A', body: body({ recommendation_id: REC_B }) });
    const unknown = await invoke(perfCollectHandler, { method: 'POST', as: 'A', body: body({ recommendation_id: UNKNOWN_ID }) });
    expect(foreign.status).toBe(404);
    expect([foreign.status, foreign.body]).toEqual([unknown.status, unknown.body]);
    expect(mockRecordPerformance).not.toHaveBeenCalled();
  });
});

describe('POST /api/performance/ingest (asset → campaign → company)', () => {
  const body = (assetId: string) => ({ platform: 'linkedin', contentAssetId: assetId, metrics: { likes: 1, comments: 0, shares: 0 } });

  it('unauthenticated → 401 before the asset is looked up', async () => {
    const r = await invoke(perfIngestHandler, { method: 'POST', as: null, body: body(ASSET_A) });
    expect(r.status).toBe(401);
    expect(sinkCalls(['content_assets'])).toHaveLength(0);
    expect(mockIngest).not.toHaveBeenCalled();
  });
  it('member of A ingesting for B\'s asset → 403/404, nothing ingested', async () => {
    const r = await invoke(perfIngestHandler, { method: 'POST', as: 'A', body: body(ASSET_B) });
    expect([403, 404]).toContain(r.status);
    expect(leaksB(r.body)).toBe(false);
    expect(mockIngest).not.toHaveBeenCalled();
  });
  it('unknown asset → 404', async () => {
    expect((await invoke(perfIngestHandler, { method: 'POST', as: 'A', body: body(UNKNOWN_ID) })).status).toBe(404);
    expect(mockIngest).not.toHaveBeenCalled();
  });
  it('member of A ingesting for own asset → 200', async () => {
    const r = await invoke(perfIngestHandler, { method: 'POST', as: 'A', body: body(ASSET_A) });
    expect(r.status).toBe(200);
    expect(mockIngest).toHaveBeenCalledWith(expect.objectContaining({ contentAssetId: ASSET_A }));
  });
});

describe('GET /api/admin/autonomous/decisions (was: identity only)', () => {
  it('unauthenticated → 401', async () => {
    expect((await invoke(decisionsHandler, { as: null, query: { company_id: CO_A } })).status).toBe(401);
    expect(mockGetDecisionLog).not.toHaveBeenCalled();
  });
  it('member of A reading company B\'s decision log → 403, log never read', async () => {
    const r = await invoke(decisionsHandler, { as: 'A', query: { company_id: CO_B } });
    expect(r.status).toBe(403);
    expect(mockGetDecisionLog).not.toHaveBeenCalled();
  });
  it('member of A filtering own company by B\'s campaign → 404, log never read', async () => {
    const r = await invoke(decisionsHandler, { as: 'A', query: { company_id: CO_A, campaign_id: CAMPAIGN_B } });
    expect(r.status).toBe(404);
    expect(mockGetDecisionLog).not.toHaveBeenCalled();
  });
  it('member of A → 200 for company A (with and without an own campaign filter)', async () => {
    expect((await invoke(decisionsHandler, { as: 'A', query: { company_id: CO_A, limit: '30' } })).status).toBe(200);
    expect((await invoke(decisionsHandler, { as: 'A', query: { company_id: CO_A, campaign_id: CAMPAIGN_A } })).status).toBe(200);
    expect(mockGetDecisionLog).toHaveBeenCalledWith(CO_A, expect.objectContaining({ limit: 30 }));
    expect(mockGetDecisionLog).toHaveBeenCalledWith(CO_A, expect.objectContaining({ campaign_id: CAMPAIGN_A }));
  });
});

describe('GET /api/user/subscription (was: company_id unchecked)', () => {
  it('unauthenticated → 401', async () => {
    expect((await invoke(subscriptionHandler, { as: null, query: { company_id: CO_A } })).status).toBe(401);
    expect(mockPlanLimits).not.toHaveBeenCalled();
  });
  it('member of A asking for company B\'s plan → 403, plan never resolved', async () => {
    const r = await invoke(subscriptionHandler, { as: 'A', query: { company_id: CO_B } });
    expect(r.status).toBe(403);
    expect(mockPlanLimits).not.toHaveBeenCalled();
  });
  it('member of A → own plan', async () => {
    const r = await invoke(subscriptionHandler, { as: 'A', query: { company_id: CO_A } });
    expect(r.status).toBe(200);
    expect(r.body.data.tier).toBe('pro');
    expect(mockPlanLimits).toHaveBeenCalledWith(CO_A);
  });
  it('no company_id keeps the unchanged free-tier answer', async () => {
    const r = await invoke(subscriptionHandler, { as: 'A' });
    expect(r.status).toBe(200);
    expect(r.body.data.tier).toBe('free');
    expect(mockPlanLimits).not.toHaveBeenCalled();
  });
});
