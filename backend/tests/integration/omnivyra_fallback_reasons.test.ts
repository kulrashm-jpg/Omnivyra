import { generateRecommendations } from '../../services/recommendationEngineService';
import { getRulesForPlatform } from '../../services/platformRulesService';

jest.mock('../../services/companyProfileService', () => ({
  getProfile: jest.fn().mockResolvedValue({ company_id: 'comp-1', category: 'marketing' }),
}));
// LAYER 2 — the AI runtime. Mocked at the CALLER boundary, which stops execution
// before the gateway consults pricing at all. Suite-local, not global:
// `getOpenAiClient` is module-private in aiGatewayCore so there is no injection
// seam, and a global `openai` mock would neutralise the suites that legitimately
// exercise the gateway.
jest.mock('../../services/aiGatewayProvidersOps', () => ({
  runCompletionWithOperation: jest.fn().mockResolvedValue({
    output: '{}',
    metadata: { provider: 'mock', model: 'mock' },
  }),
}));
jest.mock('../../services/externalApiService', () => ({
  fetchTrendsFromApis: jest.fn().mockResolvedValue([
    { topic: 'AI marketing', source: 'YouTube Trends', signal_confidence: 0.9 },
  ]),
  fetchExternalApis: jest.fn().mockResolvedValue({
    results: [
      {
        source: { name: 'YouTube Trends', id: 'yt' },
        payload: { items: [{ title: 'AI marketing', snippet: { title: 'AI marketing' } }] },
        health: null,
        cache_hit: false,
        missing_env: [],
      },
    ],
    missing_env_placeholders: [],
    cache_stats: { hits: 0, misses: 0, per_api_hits: {}, per_api_misses: {} },
    rate_limited_sources: [],
    signal_confidence_summary: { average: 0.9, min: 0.8, max: 1 },
  }),
  getPlatformStrategies: jest.fn().mockResolvedValue([]),
  getEnabledApis: jest.fn().mockResolvedValue([]),
  getExternalApiRuntimeSnapshot: jest.fn().mockResolvedValue({
    health_snapshot: [],
    cache_stats: { hits: 0, misses: 0 },
    rate_limited_sources: [],
    signal_confidence_summary: null,
  }),
}));
jest.mock('../../services/campaignMemoryService', () => ({
  getCampaignMemory: jest.fn().mockResolvedValue({
    pastThemes: [],
    pastTopics: [],
    pastHooks: [],
    pastTrendsUsed: [],
    pastPlatforms: [],
    pastContentSummaries: [],
  }),
  validateUniqueness: jest.fn().mockResolvedValue({
    overlapDetected: false,
    overlappingItems: [],
    similarityScore: 0.1,
    recommendation: 'Content is sufficiently unique.',
  }),
}));
jest.mock('../../services/campaignRecommendationService', () => ({
  generateCampaignStrategy: jest.fn().mockResolvedValue({
    weekly_plan: [{ week_number: 1, theme: 'AI Marketing', trend_influence: [] }],
    daily_plan: [{ date: 'Week 1 Day 1', platform: 'linkedin', content_type: 'text', topic: 'AI' }],
  }),
}));
jest.mock('../../db/supabaseClient', () => {
  const chain = (data: any) => ({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    // LAYER 1 — reached by pricingService.fetchModelPricingRow:136, which builds
    // `.eq()x4.lte().order().limit().maybeSingle()`.
    lte: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    contains: jest.fn().mockReturnThis(),
    // Write entry points — profile write-back via upsertCompanyProfilePayload.
    insert: jest.fn().mockReturnThis(),
    upsert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({
      data: Array.isArray(data) ? data?.[0] ?? null : data,
      error: null,
    }),
    maybeSingle: jest.fn().mockResolvedValue({
      data: Array.isArray(data) ? data?.[0] ?? null : data,
      error: null,
    }),
    then: (fn: (v: any) => any) =>
      Promise.resolve({ data: Array.isArray(data) ? data : data ? [data] : [], error: null }).then(fn),
  });
  const from = jest.fn((table: string) => {
    if (table === 'campaign_versions') return chain([{ id: 'v1', company_id: 'comp-1', campaign_id: 'camp-1' }]);
    if (table === 'platform_rules') return chain(null); // getPlatformRule returns null when no rule
    // LAYER 3 — the profile write-back. `upsertCompanyProfilePayload` performs
    // `.upsert(...).select('*').single()`, and
    // companyProfileServiceRest1Rest2Competitors.ts:474 throws
    // "no profile returned after save" on a null result. Without a row for this
    // table the write-back cannot succeed.
    //
    // Minimal shape proven by the caller: a NON-NULL object. Line 488 reads
    // `data.report_settings?.competitor_intelligence` (optional-chained, so absent
    // is fine) and passes `data` to buildChangedFields / after_profile. Mirrors
    // the getProfile mock above rather than inventing columns.
    if (table === 'company_profiles') {
      return chain([{ company_id: 'comp-1', category: 'marketing' }]);
    }
    return chain([]);
  });
  return { supabase: { from, rpc: jest.fn().mockResolvedValue({ data: null, error: null }) } };
});
jest.mock('../../services/omnivyraClientV1', () => ({
  isOmnivyraEnabled: jest.fn().mockReturnValue(true),
  getTrendRelevance: jest.fn().mockResolvedValue({
    status: 'error',
    error: { message: 'Invalid schema' },
    _omnivyra_meta: { error_type: 'schema_invalid', endpoint: '/trends/relevance', latency_ms: 100 },
  }),
  getTrendRanking: jest.fn().mockResolvedValue({
    status: 'error',
    error: { message: 'Invalid schema' },
    _omnivyra_meta: { error_type: 'schema_invalid', endpoint: '/trends/rank', latency_ms: 100 },
  }),
  getPlatformRules: jest.fn().mockResolvedValue({
    status: 'error',
    error: { message: 'Invalid schema' },
    _omnivyra_meta: { error_type: 'schema_invalid', endpoint: '/platform/rules/canonical', latency_ms: 100 },
  }),
  getOmnivyraHealthReport: jest.fn().mockReturnValue({
    status: 'degraded',
    endpoints: {},
    avg_latency_ms: 100,
    success_rate: 0.5,
    last_error: 'Invalid schema',
  }),
}));

describe('Omnivyra fallback reasons', () => {
  it('sets fallback reason in recommendation engine status', async () => {
    const result = await generateRecommendations({
      companyId: 'comp-1',
      campaignId: 'camp-1',
    });
    expect(result.omnivyra_status?.fallback_reason).toBe('schema_invalid');
  });

  it('sets fallback reason in platform rules', async () => {
    const rule = await getRulesForPlatform({ platform: 'linkedin', contentType: 'text' });
    expect(rule.fallback_reason).toBe('schema_invalid');
  });
});
