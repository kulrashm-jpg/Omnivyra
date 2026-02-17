import * as externalApiService from '../../services/externalApiService';
import {
  normalizeNewsApiTrends,
  normalizeSerpApiTrends,
  normalizeYouTubeTrends,
} from '../../services/trendNormalizationService';
import { setCachedResponse, getCacheStats, resetCacheStats } from '../../services/externalApiCacheService';
import { updateApiHealth } from '../../services/externalApiHealthService';

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

jest.mock('../../services/externalApiHealthService', () => ({
  updateApiHealth: jest.fn().mockResolvedValue({
    freshness_score: 1,
    reliability_score: 1,
    health_score: 1,
  }),
}));

const { supabase } = jest.requireMock('../../db/supabaseClient');

const sourcesStore = new Map<string, any>();

const buildQuery = (table: string) => {
  const state: { filters: Record<string, any> } = { filters: {} };
  const query: any = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn((field: string, value: any) => {
      state.filters[field] = value;
      return query;
    }),
    or: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    single: jest.fn().mockReturnThis(),
    then: (resolve: any, reject: any) => {
      const result = resolveQuery(table, state);
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  return query;
};

const resolveQuery = (table: string, state: any) => {
  if (table === 'external_api_sources') {
    if (state.filters.is_active === true) {
      return { data: Array.from(sourcesStore.values()), error: null };
    }
    return { data: Array.from(sourcesStore.values()), error: null };
  }
  if (table === 'external_api_user_access') {
    return { data: [], error: null };
  }
  if (table === 'campaign_versions') {
    if (state.filters.company_id && state.filters.campaign_id) {
      return { data: [{ id: 'v1', company_id: state.filters.company_id, campaign_id: state.filters.campaign_id }], error: null };
    }
    return { data: [], error: null };
  }
  return { data: [], error: null };
};

describe('External API alignment', () => {
  beforeEach(() => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => buildQuery(table));
    sourcesStore.clear();
    resetCacheStats();
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [{ topic: 'AI', volume: 10 }] }),
    });
  });

  it('normalizes YouTube trends', () => {
    const raw = {
      items: [
        {
          snippet: { title: 'AI marketing', description: 'Growth tactics' },
          statistics: { viewCount: '1200' },
        },
      ],
    };
    const normalized = normalizeYouTubeTrends(raw, { sourceName: 'YouTube Trends', geo: 'US' });
    expect(normalized[0]).toMatchObject({
      source: 'YouTube Trends',
      title: 'AI marketing',
      description: 'Growth tactics',
      volume: 1200,
      geo: 'US',
    });
  });

  it('normalizes NewsAPI trends', () => {
    const raw = {
      totalResults: 50,
      articles: [{ title: 'AI funding', description: 'News summary' }],
    };
    const normalized = normalizeNewsApiTrends(raw, { sourceName: 'NewsAPI', category: 'tech' });
    expect(normalized[0]).toMatchObject({
      source: 'NewsAPI',
      title: 'AI funding',
      description: 'News summary',
      volume: 50,
      category: 'tech',
    });
  });

  it('normalizes SerpAPI trends', () => {
    const raw = {
      trend_results: [{ query: 'ai tools', value: 70 }],
    };
    const normalized = normalizeSerpApiTrends(raw, { sourceName: 'SerpAPI', geo: 'US' });
    expect(normalized[0]).toMatchObject({
      source: 'SerpAPI',
      title: 'ai tools',
      volume: 70,
    });
  });

  it('handles missing env vars and cache hits', async () => {
    sourcesStore.set('api-1', {
      id: 'api-1',
      name: 'YouTube Trends',
      base_url: 'https://example.com/trends',
      purpose: 'trends',
      is_active: true,
      auth_type: 'query',
      api_key_env_name: 'MISSING_KEY',
      headers: {},
      query_params: {},
      created_at: new Date().toISOString(),
    });
    sourcesStore.set('api-2', {
      id: 'api-2',
      name: 'NewsAPI Headlines',
      base_url: 'https://example.com/news',
      purpose: 'trends',
      is_active: true,
      auth_type: 'none',
      headers: {},
      query_params: {},
      created_at: new Date().toISOString(),
    });

    const summary = await externalApiService.fetchExternalTrends('US', 'marketing', { recordHealth: true });
    expect(summary.missing_env_placeholders).toContain('missing_env:MISSING_KEY');

    setCachedResponse('api-2::US::marketing::system', { items: [] }, 1000);
    const cachedSummary = await externalApiService.fetchExternalTrends('US', 'marketing', { recordHealth: true });
    expect(getCacheStats().hits).toBeGreaterThan(0);
    expect(updateApiHealth).toHaveBeenCalled();
    externalApiService.recordSignalConfidenceSummary([0.6, 0.8]);
    expect(cachedSummary.cache_stats.hits).toBeGreaterThanOrEqual(0);
  });

  it('falls back with no_external_signals placeholder', async () => {
    let result: any = null;
    await new Promise<void>((resolve, reject) => {
      jest.isolateModules(() => {
        jest.doMock('../../services/externalApiService', () => ({
          fetchExternalTrends: jest.fn().mockResolvedValue({
            results: [],
            missing_env_placeholders: [],
            cache_stats: { hits: 0, misses: 0, per_api_hits: {}, per_api_misses: {} },
            rate_limited_sources: [],
            signal_confidence_summary: null,
          }),
          getEnabledApis: jest.fn().mockResolvedValue([]),
          getExternalApiRuntimeSnapshot: jest.fn().mockResolvedValue({
            health_snapshot: [],
            cache_stats: { hits: 0, misses: 0, per_api_hits: {}, per_api_misses: {} },
            rate_limited_sources: [],
            signal_confidence_summary: null,
          }),
          getPlatformStrategies: jest.fn().mockResolvedValue([]),
          recordSignalConfidenceSummary: jest.fn(),
        }));
        jest.doMock('../../services/companyProfileService', () => ({
          getProfile: jest.fn().mockResolvedValue({ geography: 'US', industry_list: [], goals_list: [], content_themes_list: [] }),
        }));
        jest.doMock('../../services/campaignMemoryService', () => ({
          getCampaignMemory: jest.fn().mockResolvedValue({}),
        }));
        jest.doMock('../../services/campaignRecommendationService', () => ({
          generateCampaignStrategy: jest.fn().mockResolvedValue({ weekly_plan: [], daily_plan: [] }),
        }));
        jest.doMock('../../services/omnivyraClientV1', () => ({
          isOmniVyraEnabled: jest.fn().mockReturnValue(false),
          getOmniVyraHealthReport: jest.fn().mockReturnValue({ status: 'disabled' }),
        }));
        jest.doMock('../../services/omnivyraHealthService', () => ({
          getLastFallbackReason: jest.fn().mockReturnValue(null),
          getLastMeta: jest.fn().mockReturnValue(null),
          setLastFallbackReason: jest.fn(),
        }));
        jest.doMock('../../services/omnivyraFeedbackService', () => ({
          sendLearningSnapshot: jest.fn().mockResolvedValue({ status: 'skipped' }),
        }));

        const { generateRecommendations } = require('../../services/recommendationEngineService');
        generateRecommendations({
          companyId: 'company-1',
          campaignId: 'campaign-1',
        })
          .then((value: any) => {
            result = value;
            resolve();
          })
          .catch(reject);
      });
    });
    expect(result.omnivyra_metadata?.placeholders).toContain('no_external_signals');
    expect(result.confidence_score).toBe(35);
  });
});
