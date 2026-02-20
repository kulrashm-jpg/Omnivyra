import { buildFallbackRecommendationSignals } from '../../services/recommendationFallbackSignalService';
import { generateRecommendations } from '../../services/recommendationEngineService';
import { getProfile } from '../../services/companyProfileService';
import { fetchExternalApis } from '../../services/externalApiService';
import { validateUniqueness } from '../../services/campaignMemoryService';
import { generateCampaignStrategy } from '../../services/campaignRecommendationService';
import { isOmniVyraEnabled } from '../../services/omnivyraClientV1';

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));

jest.mock('../../services/companyProfileService', () => ({
  getProfile: jest.fn(),
}));

jest.mock('../../services/externalApiService', () => ({
  fetchExternalApis: jest.fn(),
  recordSignalConfidenceSummary: jest.fn(),
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
  getCampaignMemory: jest.fn(),
  validateUniqueness: jest.fn(),
}));

jest.mock('../../services/campaignRecommendationService', () => ({
  generateCampaignStrategy: jest.fn(),
}));

jest.mock('../../services/omnivyraClientV1', () => ({
  getTrendRelevance: jest.fn(),
  getTrendRanking: jest.fn(),
  isOmniVyraEnabled: jest.fn(),
  getOmniVyraHealthReport: jest.fn().mockReturnValue({
    status: 'healthy',
    endpoints: {},
    avg_latency_ms: 0,
    success_rate: 1,
    last_error: null,
  }),
}));

jest.mock('../../services/trendNormalizationService', () => ({
  normalizeTrends: jest.fn().mockReturnValue([]),
}));

describe('recommendationFallbackSignalService', () => {
  it('generates signals from authority domains', () => {
    const signals = buildFallbackRecommendationSignals({
      authority_domains: ['AI strategy'],
    });

    expect(signals.length).toBe(3);
    expect(signals.every((item) => item.topic === 'AI strategy')).toBe(true);
    expect(signals.every((item) => item.volume === 3000)).toBe(true);
    expect(signals.every((item) => item.signal_confidence === 0.8)).toBe(true);
    expect(signals.every((item) => item.source === 'fallback_context')).toBe(true);
  });

  it('uses core problem when authority domains are missing', () => {
    const signals = buildFallbackRecommendationSignals({
      core_problem_statement: 'Low conversion confidence',
    });

    expect(signals.length).toBe(2);
    expect(signals.every((item) => item.topic === 'Low conversion confidence')).toBe(true);
    expect(signals.every((item) => item.volume === 2500)).toBe(true);
  });

  it('is deterministic for identical inputs', () => {
    const profile = {
      authority_domains: ['Go-to-market'],
      pain_symptoms: ['high churn'],
      desired_transformation: 'predictable pipeline',
      campaign_focus: 'B2B growth',
      content_themes: ['thought leadership'],
      growth_priorities: ['retention'],
    };
    const first = buildFallbackRecommendationSignals(profile);
    const second = buildFallbackRecommendationSignals(profile);
    expect(second).toEqual(first);
  });
});

describe('generateRecommendations fallback signals', () => {
  beforeEach(() => {
    const { supabase } = jest.requireMock('../../db/supabaseClient');
    (supabase.from as jest.Mock).mockImplementation(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      then: (resolve: any) => resolve({ data: [{ id: 'link' }], error: null }),
    }));

    (getProfile as jest.Mock).mockResolvedValue({
      company_id: 'c-1',
      category: 'marketing',
      campaign_focus: 'AI marketing',
      core_problem_statement: 'decision friction',
      pain_symptoms: ['analysis paralysis'],
      desired_transformation: 'confident execution',
      authority_domains: ['strategy'],
      content_themes: ['messaging'],
      growth_priorities: ['lead quality'],
    });
    (fetchExternalApis as jest.Mock).mockResolvedValue({
      results: [],
      missing_env_placeholders: [],
      cache_stats: { hits: 0, misses: 0, per_api_hits: {}, per_api_misses: {} },
      rate_limited_sources: [],
      signal_confidence_summary: null,
    });
    (isOmniVyraEnabled as jest.Mock).mockReturnValue(false);
    const omnivyra = jest.requireMock('../../services/omnivyraClientV1');
    omnivyra.getOmniVyraHealthReport.mockReturnValue({
      status: 'healthy',
      endpoints: {},
      avg_latency_ms: 0,
      success_rate: 1,
      last_error: null,
    });
    const externalApiService = jest.requireMock('../../services/externalApiService');
    externalApiService.getEnabledApis.mockResolvedValue([]);
    externalApiService.getPlatformStrategies.mockResolvedValue([]);
    externalApiService.getExternalApiRuntimeSnapshot.mockResolvedValue({
      health_snapshot: [],
      cache_stats: { hits: 0, misses: 0 },
      rate_limited_sources: [],
      signal_confidence_summary: null,
    });
    externalApiService.recordSignalConfidenceSummary.mockImplementation(() => {});
    (validateUniqueness as jest.Mock).mockResolvedValue({
      overlapDetected: false,
      overlappingItems: [],
      similarityScore: 0.2,
      recommendation: 'unique',
    });
    (generateCampaignStrategy as jest.Mock).mockResolvedValue({
      weekly_plan: [{ week_number: 1, theme: 'AI Marketing', trend_influence: [] }],
      daily_plan: [{ date: 'Week 1 Day 1', platform: 'linkedin', content_type: 'text', topic: 'AI' }],
    });
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('returns recommendations when external signals are empty', async () => {
    const result = await generateRecommendations({
      companyId: 'c-1',
      campaignId: 'camp-1',
      durationWeeks: 4,
    });

    expect(result.trends_used.length).toBeGreaterThan(0);
    expect(result.signals_source).toBe('PROFILE_ONLY');
    expect(result.trends_used[0]?.source).toBe('fallback_context');
  });

  it('keeps scoring path active for fallback signals', async () => {
    const result = await generateRecommendations({
      companyId: 'c-1',
      campaignId: 'camp-1',
      durationWeeks: 4,
    });

    const first = result.trends_used[0] as Record<string, unknown>;
    expect(first.alignmentScore).toBeDefined();
    expect(first.finalAlignmentScore).toBeDefined();
    expect(result.scoring_adjustments).toBeDefined();
    expect(result.campaign_blueprint_validated).toBeDefined();
  });
});

