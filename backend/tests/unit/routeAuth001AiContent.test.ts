/**
 * ROUTE-AUTH-001 (STEP 3AH-85) — "AI, paid calls and content" family.
 *
 * These routes spent platform AI / external-API budget or touched tenant data
 * with NO authentication. Each is now authenticated, and every request-supplied
 * campaignId / companyId is bound to the caller. The real guard chain runs
 * (resolveUserContext, enforceCompanyAccess, requireCampaignAccess,
 * requireSuperAdminUser, rbacService); only the database, the identity provider
 * and the paid/LLM/external services are faked — and each test asserts that the
 * paid sink is NEVER reached on a 401/403/404.
 *
 * Object-id routes (voice notes, generation-status) and voice transcription are
 * in routeAuth001AiContentObjects.test.ts.
 */
import {
  seed, invoke, leaksB, CO_A, CO_B, CAMPAIGN_A, CAMPAIGN_B, CANARY_B,
} from '../helpers/routeAuthHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/routeAuthHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/routeAuthHarness').identityModule());

// ── paid / LLM / external sinks — never called for real ─────────────────────
const mockGuardAi = jest.fn(async (..._a: any[]) => undefined);
jest.mock('../../services/ai/aiRequestGuard', () => ({
  guardAiRequest: (...a: any[]) => mockGuardAi(...a),
  AiGuardError: class AiGuardError extends Error { status = 429; code = 'X'; retryAfterSecs = 0; },
}));
const mockModerate = jest.fn(async (..._a: any[]) => ({ allowed: true }));
jest.mock('../../chatGovernance', () => ({ validateAndModerateUserMessage: (...a: any[]) => mockModerate(...a) }));
const mockRefineLanguage = jest.fn(async (..._a: any[]) => ({ refined: 'refined amendment' }));
jest.mock('../../services/languageRefinementService', () => ({ refineLanguageOutput: (...a: any[]) => mockRefineLanguage(...a) }));
const mockAnalyze = jest.fn(async (..._a: any[]) => ({ topic: 't', overallScore: 1, uniquenessScore: 1, repetitionRisk: 'low' }));
jest.mock('../../../lib/content-analyzer', () => ({ ContentAnalyzer: { analyzeContent: (...a: any[]) => mockAnalyze(...a) } }));
const mockContentIdeas = jest.fn(async (..._a: any[]) => [{ title: 'idea' }]);
jest.mock('../../services/insightContentService', () => ({ generateContentIdeas: (...a: any[]) => mockContentIdeas(...a) }));
const mockBuildCampaign = jest.fn((..._a: any[]) => ({ idea_spine: {} }));
jest.mock('../../services/opportunityCampaignBuilder', () => ({ buildCampaignFromOpportunity: (...a: any[]) => mockBuildCampaign(...a) }));
const mockEstimate = jest.fn(async (..._a: any[]) => ({ total: 10 }));
jest.mock('../../services/campaignCostEstimator', () => ({ estimateCampaignCost: (...a: any[]) => mockEstimate(...a) }));
const mockSearchImages = jest.fn(async (..._a: any[]) => ({ images: [], query: 'q', originalQuery: 'q', source: 'x', fromCache: false }));
jest.mock('../../services/imageService', () => ({ searchImages: (...a: any[]) => mockSearchImages(...a) }));
jest.mock('../../db/imageMetadataStore', () => ({ recordImageSearch: jest.fn(async () => undefined) }));
const mockSafeFetch = jest.fn(async (..._a: any[]) => ({ ok: false }));
jest.mock('../../../lib/security/safeFetch', () => ({
  safeFetch: (...a: any[]) => mockSafeFetch(...a),
  readCapped: jest.fn(async () => Buffer.from('')),
}));
const mockGetProfile = jest.fn(async (companyId: string, ..._a: any[]) => ({ company_id: companyId, name: companyId === 'co-b-0000-0000-0000-00000000000b' ? 'CANARY-COMPANY-B-CONFIDENTIAL' : 'A', geography: 'US' }));
jest.mock('../../services/context/canonicalProfileAdapter', () => ({ getCanonicalProfile: (...a: any[]) => mockGetProfile(...(a as [string])) }));
const mockDetectDrift = jest.fn((..._a: any[]) => ({ drift: false }));
jest.mock('../../services/trendDriftService', () => ({ detectTrendDrift: (...a: any[]) => mockDetectDrift(...a) }));
const mockFetchTrends = jest.fn(async (..._a: any[]) => [{ topic: 'x' }]);
jest.mock('../../services/externalApiService', () => ({ fetchTrendsFromApis: (...a: any[]) => mockFetchTrends(...a) }));
const mockTrendSnapshots = jest.fn(async (..._a: any[]) => []);
jest.mock('../../db/campaignVersionStore', () => ({ getTrendSnapshots: (...a: any[]) => mockTrendSnapshots(...a) }));
const mockAnalytics = jest.fn(async (..._a: any[]) => null);
jest.mock('../../db/performanceStore', () => ({ getLatestAnalyticsReport: (...a: any[]) => mockAnalytics(...a) }));
const mockLearningSnapshot = jest.fn(async (..._a: any[]) => undefined);
jest.mock('../../services/omnivyraFeedbackService', () => ({ sendLearningSnapshot: (...a: any[]) => mockLearningSnapshot(...a) }));
const mockRefineIdea = jest.fn(async (..._a: any[]) => ({ refined_title: 'r' }));
jest.mock('../../services/ideaRefinementService', () => ({ refineCampaignIdea: (...a: any[]) => mockRefineIdea(...a) }));

/* eslint-disable @typescript-eslint/no-var-requires */
const route = (p: string) => require(`../../../pages/api/${p}`).default;
const learnings = route('ai/campaign-learnings');
const messages = route('ai/campaign-messages');
const checkClaude = route('ai/check-claude-config');
const checkGpt = route('ai/check-gpt-config');
const dailyAmendment = route('ai/daily-amendment');
const comprehensivePlan = route('ai/generate-comprehensive-plan');
const gptChat = route('ai/gpt-chat');
const topicSuggestions = route('ai/topic-suggestions');
const weeklyAmendment = route('ai/weekly-amendment');
const analyzeContent = route('analyze/content');
const contentIdeas = route('insight/content-ideas');
const trendingCurrent = route('trending/current');
const imagesSearch = route('images/search');
const creditsEstimate = route('credits/estimate');
const buildCampaign = route('opportunity/build-campaign');
const driftCheck = route('trends/drift-check');
const refineIdea = route('campaign-planner/refine-idea');
/* eslint-enable @typescript-eslint/no-var-requires */

const realFetch = global.fetch;
const mockFetch = jest.fn(async (..._a: any[]) => ({
  ok: true,
  json: async () => ({ response: 'ai amendment', choices: [{ message: { content: 'hi' } }], usage: {}, model: 'gpt-4' }),
}));

const allSinks = () => [
  mockGuardAi, mockModerate, mockRefineLanguage, mockAnalyze, mockContentIdeas, mockBuildCampaign, mockEstimate,
  mockSearchImages, mockSafeFetch, mockGetProfile, mockDetectDrift, mockFetchTrends, mockTrendSnapshots,
  mockAnalytics, mockLearningSnapshot, mockRefineIdea, mockFetch,
];
const noSinkReached = () => { for (const m of allSinks()) expect(m).not.toHaveBeenCalled(); };

beforeAll(() => { global.fetch = mockFetch as never; process.env.UNSPLASH_ACCESS_KEY = 'test-only'; });
afterAll(() => { global.fetch = realFetch; });
beforeEach(() => { seed(); for (const m of allSinks()) m.mockClear(); });

// ── ai/campaign-learnings (shared in-memory store) ──────────────────────────
describe('ai/campaign-learnings', () => {
  const secret = { campaignId: CAMPAIGN_B, campaignName: CANARY_B, performance: { engagement: 1, reach: 1 } };

  it('unauthenticated GET/POST/PUT → 401 and the store is not touched', async () => {
    expect((await invoke(learnings, { method: 'GET', as: null })).status).toBe(401);
    expect((await invoke(learnings, { method: 'POST', as: null, body: { learning: { campaignId: CAMPAIGN_A } } })).status).toBe(401);
    expect((await invoke(learnings, { method: 'PUT', as: null, body: { campaignId: CAMPAIGN_A, actualResults: { engagement: 1 } } })).status).toBe(401);
    const a = await invoke(learnings, { method: 'GET', as: 'A' });
    expect(a.body.learnings.every((l: any) => l.campaignId !== CAMPAIGN_A)).toBe(true);
  });

  it('a learning posted by company B is never visible to company A (was: global, every tenant saw it)', async () => {
    const posted = await invoke(learnings, { method: 'POST', as: 'B', body: { learning: secret } });
    expect(posted.status).toBe(200);
    const asA = await invoke(learnings, { method: 'GET', as: 'A' });
    expect(asA.status).toBe(200);
    expect(leaksB(asA.body)).toBe(false);
    expect(asA.body.learnings.length).toBeGreaterThan(0); // shared demo rows still served
    const asB = await invoke(learnings, { method: 'GET', as: 'B' });
    expect(JSON.stringify(asB.body)).toContain(CANARY_B);
  });

  it('member of A cannot post a learning under B\'s campaign → 403/404', async () => {
    const r = await invoke(learnings, { method: 'POST', as: 'A', body: { learning: { campaignId: CAMPAIGN_B, note: 'x' } } });
    expect([403, 404]).toContain(r.status);
  });

  it('client-supplied ownerCompanyId cannot override the bound tenant', async () => {
    const r = await invoke(learnings, { method: 'POST', as: 'A', body: { learning: { campaignId: CAMPAIGN_A, ownerCompanyId: CO_B, note: 'from-A' } } });
    expect(r.status).toBe(200);
    const asB = await invoke(learnings, { method: 'GET', as: 'B' });
    expect(JSON.stringify(asB.body)).not.toContain('from-A');
    const asA = await invoke(learnings, { method: 'GET', as: 'A' });
    expect(asA.body.learnings.find((l: any) => l.note === 'from-A')?.ownerCompanyId).toBe(CO_A);
  });

  it('member of A cannot update B\'s learning (PUT) → 403/404 and B\'s row is unchanged', async () => {
    const r = await invoke(learnings, { method: 'PUT', as: 'A', body: { campaignId: CAMPAIGN_B, actualResults: { engagement: 99, reach: 99 } } });
    expect([403, 404]).toContain(r.status);
    const asB = await invoke(learnings, { method: 'GET', as: 'B' });
    const row = asB.body.learnings.find((l: any) => l.campaignId === CAMPAIGN_B);
    expect(row.performance.engagement).toBe(1);
  });

  it('owner can update its own learning (PUT) → 200', async () => {
    const r = await invoke(learnings, { method: 'PUT', as: 'B', body: { campaignId: CAMPAIGN_B, actualResults: { engagement: 2, reach: 2 } } });
    expect(r.status).toBe(200);
  });
});

// ── ai/campaign-messages (in-memory, keyed by campaignId) ───────────────────
describe('ai/campaign-messages', () => {
  it('unauthenticated → 401', async () => {
    expect((await invoke(messages, { method: 'GET', as: null, query: { campaignId: CAMPAIGN_A } })).status).toBe(401);
    expect((await invoke(messages, { method: 'POST', as: null, body: { campaignId: CAMPAIGN_A, message: { t: 1 } } })).status).toBe(401);
  });

  it('member of A can neither read nor write B\'s campaign messages; B can', async () => {
    expect((await invoke(messages, { method: 'POST', as: 'B', body: { campaignId: CAMPAIGN_B, message: { text: CANARY_B } } })).status).toBe(200);
    const read = await invoke(messages, { method: 'GET', as: 'A', query: { campaignId: CAMPAIGN_B } });
    expect([403, 404]).toContain(read.status);
    expect(leaksB(read.body)).toBe(false);
    const write = await invoke(messages, { method: 'POST', as: 'A', body: { campaignId: CAMPAIGN_B, message: { text: 'injected' } } });
    expect([403, 404]).toContain(write.status);
    const asB = await invoke(messages, { method: 'GET', as: 'B', query: { campaignId: CAMPAIGN_B } });
    expect(asB.body.messages).toEqual([{ text: CANARY_B }]);
  });

  it('member of A with own campaign → 200', async () => {
    expect((await invoke(messages, { method: 'POST', as: 'A', body: { campaignId: CAMPAIGN_A, message: { text: 'a' } } })).status).toBe(200);
    const r = await invoke(messages, { method: 'GET', as: 'A', query: { campaignId: CAMPAIGN_A } });
    expect(r.status).toBe(200);
    expect(r.body.messages).toEqual([{ text: 'a' }]);
  });
});

// ── ai/check-*-config (platform diagnostics) ────────────────────────────────
describe.each([['ai/check-claude-config', checkClaude], ['ai/check-gpt-config', checkGpt]])('%s', (_name, handler) => {
  it('unauthenticated → 401', async () => {
    const r = await invoke(handler, { method: 'GET', as: null });
    expect(r.status).toBe(401);
    expect(r.body.configured).toBeUndefined();
  });
  it('tenant admin (not super admin) → 403', async () => {
    const r = await invoke(handler, { method: 'GET', as: 'A' });
    expect(r.status).toBe(403);
    expect(r.body.configured).toBeUndefined();
  });
  it('super admin → 200', async () => {
    const r = await invoke(handler, { method: 'GET', as: 'SUPER' });
    expect(r.status).toBe(200);
    expect(typeof r.body.configured).toBe('boolean');
  });
});

// ── campaign-keyed AI routes ────────────────────────────────────────────────
describe.each([
  ['ai/daily-amendment', dailyAmendment, { weekNumber: 1, amendmentRequest: 'more video', dailyPlans: [], campaignData: {} }],
  ['ai/weekly-amendment', weeklyAmendment, { weekNumber: 1, amendmentRequest: 'more video', currentWeekData: {}, campaignData: {} }],
  ['ai/generate-comprehensive-plan', comprehensivePlan, { campaignSummary: { keyMessages: [], successMetrics: [] }, weeklyPlans: [], userPrompt: 'p' }],
])('%s', (_name, handler, body) => {
  it('unauthenticated → 401 and no AI call', async () => {
    const r = await invoke(handler, { method: 'POST', as: null, body: { ...body, campaignId: CAMPAIGN_A } });
    expect(r.status).toBe(401);
    noSinkReached();
  });
  it('member of A with B\'s campaign → 403/404, no AI call, no leak', async () => {
    const r = await invoke(handler, { method: 'POST', as: 'A', body: { ...body, campaignId: CAMPAIGN_B } });
    expect([403, 404]).toContain(r.status);
    expect(leaksB(r.body)).toBe(false);
    noSinkReached();
  });
  it('member of A with own campaign → 200', async () => {
    const r = await invoke(handler, { method: 'POST', as: 'A', body: { ...body, campaignId: CAMPAIGN_A } });
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
  });
});

// ── identity-only paid routes ───────────────────────────────────────────────
describe.each([
  ['ai/gpt-chat', gptChat, 'POST', { message: 'hello', apiKey: 'sk-caller-own', stream: false }, {}, [mockGuardAi, mockModerate, mockFetch]],
  ['ai/topic-suggestions', topicSuggestions, 'POST', { count: 2, category: 'Technology', platforms: ['LinkedIn'] }, {}, []],
  ['analyze/content', analyzeContent, 'POST', { content: 'hello world', platforms: ['linkedin'] }, {}, [mockAnalyze]],
  ['insight/content-ideas', contentIdeas, 'POST', { insight: { title: 't', summary: 's' } }, {}, [mockContentIdeas]],
  ['opportunity/build-campaign', buildCampaign, 'POST', { opportunity: { title: 't' } }, {}, [mockBuildCampaign]],
  ['credits/estimate', creditsEstimate, 'POST', { platforms: ['linkedin'], posting_frequency: 3, duration_weeks: 4 }, {}, [mockEstimate]],
  ['images/search', imagesSearch, 'GET', undefined, { q: 'mountains' }, [mockSearchImages]],
  ['trending/current', trendingCurrent, 'GET', undefined, { platforms: 'linkedin,twitter' }, [mockSafeFetch]],
] as const)('%s', (_name, handler, method, body, query, sinks) => {
  it('unauthenticated → 401 and the paid/external call is never made', async () => {
    const r = await invoke(handler, { method, as: null, body, query });
    expect(r.status).toBe(401);
    noSinkReached();
  });
  it('signed-in member → 200 and the call is made', async () => {
    const r = await invoke(handler, { method, as: 'A', body, query });
    expect(r.status).toBe(200);
    for (const m of sinks) expect(m).toHaveBeenCalled();
  });
});

describe('ai/gpt-chat keeps BYOK', () => {
  it('signed-in caller without their own key → 400 (platform key never used)', async () => {
    const r = await invoke(gptChat, { method: 'POST', as: 'A', body: { message: 'hello', stream: false } });
    expect(r.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it('the caller\'s key is what reaches the provider', async () => {
    await invoke(gptChat, { method: 'POST', as: 'A', body: { message: 'hello', apiKey: 'sk-caller-own', stream: false } });
    expect(JSON.stringify(mockFetch.mock.calls[0])).toContain('sk-caller-own');
  });
});

describe('ai/topic-suggestions GET', () => {
  it('unauthenticated GET → 401; signed-in GET → 200', async () => {
    expect((await invoke(topicSuggestions, { method: 'GET', as: null })).status).toBe(401);
    expect((await invoke(topicSuggestions, { method: 'GET', as: 'A' })).status).toBe(200);
  });
});

// ── company-keyed routes ────────────────────────────────────────────────────
describe('trends/drift-check', () => {
  it('unauthenticated → 401, no profile read, no external call, no snapshot write', async () => {
    const r = await invoke(driftCheck, { method: 'POST', as: null, body: { companyId: CO_A } });
    expect(r.status).toBe(401);
    noSinkReached();
  });
  it('member of A naming company B → 403, nothing read or written for B', async () => {
    const r = await invoke(driftCheck, { method: 'POST', as: 'A', body: { companyId: CO_B } });
    expect(r.status).toBe(403);
    expect(leaksB(r.body)).toBe(false);
    noSinkReached();
  });
  it('member of A with own company → 200, services see CO_A only', async () => {
    const r = await invoke(driftCheck, { method: 'POST', as: 'A', body: { companyId: CO_A } });
    expect(r.status).toBe(200);
    expect(mockGetProfile.mock.calls[0][0]).toBe(CO_A);
    expect(mockFetchTrends.mock.calls[0][0]).toBe(CO_A);
    expect((mockLearningSnapshot.mock.calls[0][0] as any).companyId).toBe(CO_A);
  });
});

describe('campaign-planner/refine-idea (authenticated, companyId was unchecked)', () => {
  it('unauthenticated → 401, no LLM call', async () => {
    const r = await invoke(refineIdea, { method: 'POST', as: null, body: { idea_text: 'idea', companyId: CO_A } });
    expect(r.status).toBe(401);
    noSinkReached();
  });
  it('member of A passing companyId=B → 403; B\'s profile never loaded, no LLM call', async () => {
    const r = await invoke(refineIdea, { method: 'POST', as: 'A', body: { idea_text: 'idea', companyId: CO_B } });
    expect(r.status).toBe(403);
    expect(leaksB(r.body)).toBe(false);
    expect(mockGetProfile).not.toHaveBeenCalled();
    expect(mockRefineIdea).not.toHaveBeenCalled();
  });
  it('member of A with own company → 200 with A\'s profile', async () => {
    const r = await invoke(refineIdea, { method: 'POST', as: 'A', body: { idea_text: 'idea', companyId: CO_A } });
    expect(r.status).toBe(200);
    expect(mockGetProfile.mock.calls[0][0]).toBe(CO_A);
    expect((mockRefineIdea.mock.calls[0][0] as any).company_profile.company_id).toBe(CO_A);
  });
  it('no companyId → unchanged behaviour (200, no profile)', async () => {
    const r = await invoke(refineIdea, { method: 'POST', as: 'A', body: { idea_text: 'idea' } });
    expect(r.status).toBe(200);
    expect(mockGetProfile).not.toHaveBeenCalled();
  });
});
