import handler from '../../../pages/api/recommendations/generate';
import type { NextApiRequest, NextApiResponse } from 'next';
import { generateRecommendations } from '../../services/recommendationEngineService';
import { getProfile } from '../../services/companyProfileService';
import { fetchExternalApis } from '../../services/externalApiService';
import { validateUniqueness } from '../../services/campaignMemoryService';
import { generateCampaignStrategy } from '../../services/campaignRecommendationService';
import {
  getTrendRanking,
  getTrendRelevance,
  getOmniVyraHealthReport,
  isOmniVyraEnabled,
} from '../../services/omnivyraClientV1';

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));
jest.mock('../../services/userContextService', () => ({
  resolveUserContext: jest.fn().mockResolvedValue({
    userId: 'user-1',
    role: 'admin',
    companyIds: ['c-1'],
    defaultCompanyId: 'c-1',
  }),
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
  normalizeTrends: jest.fn().mockReturnValue([
    { title: 'AI marketing', source: 'YouTube Trends', confidence: 0.7 },
    { title: 'AI marketing', source: 'NewsAPI', confidence: 0.6 },
  ]),
}));

const createMockRes = () => {
  const res: Partial<NextApiResponse> & { json: jest.Mock } = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  return res as NextApiResponse;
};

describe('Recommendation engine API', () => {
  it('blocks missing companyId', async () => {
    const req = { method: 'POST', body: { campaignId: 'camp-1' } } as NextApiRequest;
    const res = createMockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('Recommendation engine service', () => {
  beforeEach(() => {
    const { supabase } = jest.requireMock('../../db/supabaseClient');
    (supabase.from as jest.Mock).mockImplementation(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      then: (resolve: any) => resolve({ data: [{ id: 'link' }], error: null }),
    }));
    (getProfile as jest.Mock).mockResolvedValue({ company_id: 'c-1', category: 'marketing' });
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
    (fetchExternalApis as jest.Mock).mockResolvedValue({
      results: [
        { source: { name: 'YouTube Trends', id: 'yt' }, payload: {} },
        { source: { name: 'NewsAPI', id: 'news' }, payload: {} },
      ],
      missing_env_placeholders: [],
      cache_stats: { hits: 0, misses: 0, per_api_hits: {}, per_api_misses: {} },
      rate_limited_sources: [],
      signal_confidence_summary: null,
    });
    const trendNormalization = jest.requireMock('../../services/trendNormalizationService');
    trendNormalization.normalizeTrends.mockReturnValue([
      { title: 'AI marketing', source: 'YouTube Trends', confidence: 0.7 },
      { title: 'AI marketing', source: 'NewsAPI', confidence: 0.6 },
    ]);
    (validateUniqueness as jest.Mock).mockResolvedValue({
      overlapDetected: false,
      overlappingItems: [],
      similarityScore: 0.2,
      recommendation: 'Content is sufficiently unique.',
    });
    (generateCampaignStrategy as jest.Mock).mockResolvedValue({
      weekly_plan: [{ week_number: 1, theme: 'AI Marketing', trend_influence: [] }],
      daily_plan: [{ date: 'Week 1 Day 1', platform: 'linkedin', content_type: 'text', topic: 'AI' }],
    });
    (getOmniVyraHealthReport as jest.Mock).mockReturnValue({
      status: 'healthy',
      endpoints: {},
      avg_latency_ms: 0,
      success_rate: 1,
      last_error: null,
    });
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('handles OmniVyra enabled path', async () => {
    (isOmniVyraEnabled as jest.Mock).mockReturnValue(true);
    (getTrendRelevance as jest.Mock).mockResolvedValue({
      status: 'ok',
      data: { relevant_trends: [{ topic: 'AI marketing' }], ignored_trends: [] },
    });
    (getTrendRanking as jest.Mock).mockResolvedValue({
      status: 'ok',
      data: { ranked_trends: [{ topic: 'AI marketing' }] },
      confidence: 0.82,
      explanation: 'Ranked by OmniVyra',
    });

    const result = await generateRecommendations({
      companyId: 'c-1',
      campaignId: 'camp-1',
    });

    expect(result.trends_used.length).toBe(1);
    expect(result.confidence_score).toBeGreaterThan(0);
  });

  it('uses fallback when OmniVyra disabled', async () => {
    (isOmniVyraEnabled as jest.Mock).mockReturnValue(false);
    const result = await generateRecommendations({
      companyId: 'c-1',
      campaignId: 'camp-1',
    });
    expect(result.trends_used.length).toBe(1);
  });

  it('retries on memory overlap', async () => {
    (isOmniVyraEnabled as jest.Mock).mockReturnValue(false);
    (validateUniqueness as jest.Mock).mockResolvedValueOnce({
      overlapDetected: true,
      overlappingItems: ['AI marketing'],
      similarityScore: 0.7,
      recommendation: 'Similar content detected.',
    });

    await generateRecommendations({
      companyId: 'c-1',
      campaignId: 'camp-1',
    });

    expect(generateCampaignStrategy).toHaveBeenCalledTimes(2);
  });

  it('merges duplicate trends', async () => {
    (isOmniVyraEnabled as jest.Mock).mockReturnValue(false);
    const result = await generateRecommendations({
      companyId: 'c-1',
      campaignId: 'camp-1',
    });
    expect(result.trends_used.length).toBe(1);
    expect(result.sources.length).toBeGreaterThan(0);
  });

  it('populates confidence', async () => {
    (isOmniVyraEnabled as jest.Mock).mockReturnValue(false);
    const result = await generateRecommendations({
      companyId: 'c-1',
      campaignId: 'camp-1',
    });
    expect(result.confidence_score).toBeDefined();
  });

  it('exposes card blueprint readiness contract fields', async () => {
    (isOmniVyraEnabled as jest.Mock).mockReturnValue(false);
    (getProfile as jest.Mock).mockResolvedValue({
      company_id: 'c-1',
      category: 'marketing',
      campaign_focus: 'AI marketing',
      core_problem_statement: 'decision friction',
      pain_symptoms: ['analysis paralysis'],
      desired_transformation: 'confident action',
      authority_domains: ['strategy'],
    });
    const result = await generateRecommendations({
      companyId: 'c-1',
      campaignId: 'camp-1',
      durationWeeks: 4,
    });

    expect(result.campaign_blueprint_validated).toBeDefined();
    expect(result.strategy_dna).toBeDefined();
    expect(result.strategy_dna?.mode).toBeDefined();
    expect(result.trends_used.length).toBeGreaterThan(0);

    const card = result.trends_used[0] as Record<string, any>;
    expect(card.intelligence).toBeDefined();
    expect(card.intelligence.campaign_angle).toBeDefined();
    expect(card.campaign_angle).toBeDefined();
    expect(card.execution_stage).toBeDefined();
    expect(card.stage_objective).toBeDefined();
    expect(card.psychological_goal).toBeDefined();
    expect(card.momentum_level).toBeDefined();
    expect(card.primary_recommendations).toBeDefined();
    expect(card.supporting_recommendations).toBeDefined();
    expect(card.duration_weeks).toBeDefined();
    expect(card.strategy_mode).toBe(result.strategy_dna?.mode);
    expect(card.company_problem_transformation).toBeDefined();
  });

  describe('Content Intelligence alignment', () => {
    it('excludes trends with zero core_problem overlap (core problem filter)', async () => {
      (isOmniVyraEnabled as jest.Mock).mockReturnValue(false);
      (getProfile as jest.Mock).mockResolvedValue({
        company_id: 'c-1',
        category: 'marketing',
        campaign_focus: 'marketing',
        content_themes: 'saas',
      });
      const trendNormalization = jest.requireMock('../../services/trendNormalizationService');
      trendNormalization.normalizeTrends.mockReturnValue([
        { title: 'B2B marketing trends', source: 'YouTube', confidence: 0.8 },
        { title: 'sports playoffs championship', source: 'News', confidence: 0.7 },
      ]);
      const result = await generateRecommendations({
        companyId: 'c-1',
        campaignId: 'camp-1',
      });
      const usedTopics = result.trends_used.map((t) => t.topic.toLowerCase());
      const ignoredTopics = result.trends_ignored.map((t) => t.topic.toLowerCase());
      expect(ignoredTopics).toContain('sports playoffs championship');
      expect(usedTopics).toContain('b2b marketing trends');
    });

    it('excludes trends containing disqualified keywords', async () => {
      (isOmniVyraEnabled as jest.Mock).mockReturnValue(false);
      (getProfile as jest.Mock).mockResolvedValue({
        company_id: 'c-1',
        category: 'marketing',
        campaign_focus: 'AI marketing',
        content_themes: 'saas',
      });
      const trendNormalization = jest.requireMock('../../services/trendNormalizationService');
      trendNormalization.normalizeTrends.mockReturnValue([
        { title: 'AI marketing', source: 'YouTube', confidence: 0.8 },
        { title: 'Event announcements and seminars', source: 'News', confidence: 0.7 },
      ]);
      const result = await generateRecommendations({
        companyId: 'c-1',
        campaignId: 'camp-1',
      });
      const ignoredTopics = result.trends_ignored.map((t) => t.topic.toLowerCase());
      expect(ignoredTopics.some((t) => t.includes('event'))).toBe(true);
    });

    it('highly aligned trend outranks generic popular trend (scoring)', async () => {
      (isOmniVyraEnabled as jest.Mock).mockReturnValue(false);
      (getProfile as jest.Mock).mockResolvedValue({
        company_id: 'c-1',
        category: 'marketing',
        campaign_focus: 'marketing saas',
        content_themes: 'automation',
      });
      const trendNormalization = jest.requireMock('../../services/trendNormalizationService');
      trendNormalization.normalizeTrends.mockReturnValue([
        { title: 'enterprise marketing saas automation', source: 'YouTube', confidence: 0.7, volume: 100 },
        { title: 'automation tools', source: 'News', confidence: 0.8, volume: 10000 },
      ]);
      const result = await generateRecommendations({
        companyId: 'c-1',
        campaignId: 'camp-1',
      });
      const firstTopic = result.trends_used[0]?.topic?.toLowerCase() ?? '';
      expect(firstTopic).toBe('enterprise marketing saas automation');
    });

    it('low-alignment trend ranks lower even with higher popularity', async () => {
      (isOmniVyraEnabled as jest.Mock).mockReturnValue(false);
      (getProfile as jest.Mock).mockResolvedValue({
        company_id: 'c-1',
        campaign_focus: 'B2B marketing',
        content_themes: 'enterprise',
      });
      const trendNormalization = jest.requireMock('../../services/trendNormalizationService');
      trendNormalization.normalizeTrends.mockReturnValue([
        { title: 'B2B marketing enterprise sales', source: 'YouTube', confidence: 0.6, volume: 500 },
        { title: 'marketing tips', source: 'News', confidence: 0.9, volume: 50000 },
      ]);
      const result = await generateRecommendations({
        companyId: 'c-1',
        campaignId: 'camp-1',
      });
      const firstTopic = result.trends_used[0]?.topic?.toLowerCase() ?? '';
      expect(firstTopic).toBe('b2b marketing enterprise sales');
    });

    it('core problem overlap increases ranking', async () => {
      (isOmniVyraEnabled as jest.Mock).mockReturnValue(false);
      (getProfile as jest.Mock).mockResolvedValue({
        company_id: 'c-1',
        campaign_focus: 'SaaS productivity',
        content_themes: 'automation',
      });
      const trendNormalization = jest.requireMock('../../services/trendNormalizationService');
      trendNormalization.normalizeTrends.mockReturnValue([
        { title: 'SaaS productivity automation platform', source: 'YouTube', confidence: 0.7, volume: 500 },
        { title: 'automation tools', source: 'News', confidence: 0.7, volume: 10000 },
      ]);
      const result = await generateRecommendations({
        companyId: 'c-1',
        campaignId: 'camp-1',
      });
      const firstTopic = result.trends_used[0]?.topic?.toLowerCase() ?? '';
      expect(firstTopic).toBe('saas productivity automation platform');
    });

    it('campaign_focus match outranks industry match (weighted scoring)', async () => {
      (isOmniVyraEnabled as jest.Mock).mockReturnValue(false);
      (getProfile as jest.Mock).mockResolvedValue({
        company_id: 'c-1',
        category: 'marketing',
        campaign_focus: 'marketing',
        content_themes: 'automation',
        industry: 'retail',
      });
      const trendNormalization = jest.requireMock('../../services/trendNormalizationService');
      trendNormalization.normalizeTrends.mockReturnValue([
        { title: 'marketing automation platform', source: 'YouTube', confidence: 0.7, volume: 100 },
        { title: 'retail automation software', source: 'News', confidence: 0.7, volume: 100 },
      ]);
      const result = await generateRecommendations({
        companyId: 'c-1',
        campaignId: 'camp-1',
      });
      const firstTopic = result.trends_used[0]?.topic?.toLowerCase() ?? '';
      expect(firstTopic).toBe('marketing automation platform');
    });

    it('content_themes match outranks goals match (weighted scoring)', async () => {
      (isOmniVyraEnabled as jest.Mock).mockReturnValue(false);
      (getProfile as jest.Mock).mockResolvedValue({
        company_id: 'c-1',
        category: 'marketing',
        campaign_focus: 'marketing',
        content_themes: 'automation',
        goals: 'growth',
      });
      const trendNormalization = jest.requireMock('../../services/trendNormalizationService');
      trendNormalization.normalizeTrends.mockReturnValue([
        { title: 'marketing automation platform', source: 'YouTube', confidence: 0.7, volume: 100 },
        { title: 'marketing growth strategies', source: 'News', confidence: 0.7, volume: 100 },
      ]);
      const result = await generateRecommendations({
        companyId: 'c-1',
        campaignId: 'camp-1',
      });
      const firstTopic = result.trends_used[0]?.topic?.toLowerCase() ?? '';
      expect(firstTopic).toBe('marketing automation platform');
    });

    it('falls back to popularity when profile has only blacklisted tokens (token hygiene)', async () => {
      (isOmniVyraEnabled as jest.Mock).mockReturnValue(false);
      (getProfile as jest.Mock).mockResolvedValue({
        company_id: 'c-1',
        category: 'marketing',
        campaign_focus: 'tools software',
        content_themes: 'platform strategies',
      });
      const trendNormalization = jest.requireMock('../../services/trendNormalizationService');
      trendNormalization.normalizeTrends.mockReturnValue([
        { title: 'tools software platform', source: 'A', confidence: 0.5, volume: 100 },
        { title: 'platform strategies tools', source: 'B', confidence: 0.9, volume: 50000 },
      ]);
      const result = await generateRecommendations({
        companyId: 'c-1',
        campaignId: 'camp-1',
      });
      expect(result.trends_used[0]?.topic?.toLowerCase()).toBe('platform strategies tools');
    });

    it('falls back to popularity when profile has no alignment tokens', async () => {
      (isOmniVyraEnabled as jest.Mock).mockReturnValue(false);
      (getProfile as jest.Mock).mockResolvedValue({
        company_id: 'c-1',
        category: 'marketing',
      });
      const trendNormalization = jest.requireMock('../../services/trendNormalizationService');
      trendNormalization.normalizeTrends.mockReturnValue([
        { title: 'topic A', source: 'YouTube', confidence: 0.6, volume: 100 },
        { title: 'topic B', source: 'News', confidence: 0.8, volume: 5000 },
      ]);
      const result = await generateRecommendations({
        companyId: 'c-1',
        campaignId: 'camp-1',
      });
      const firstTopic = result.trends_used[0]?.topic ?? '';
      expect(firstTopic).toBe('topic B');
    });

    it('uses profile.geography_list when input.regions is empty (multi-region)', async () => {
      (isOmniVyraEnabled as jest.Mock).mockReturnValue(false);
      (getProfile as jest.Mock).mockResolvedValue({
        company_id: 'c-1',
        category: 'marketing',
        geography_list: ['US', 'UK'],
      });
      const fetchMock = fetchExternalApis as jest.Mock;
      fetchMock.mockResolvedValue({
        results: [
          { source: { name: 'YouTube', id: 'yt' }, payload: {} },
          { source: { name: 'News', id: 'news' }, payload: {} },
        ],
        missing_env_placeholders: [],
        cache_stats: {},
        rate_limited_sources: [],
        signal_confidence_summary: null,
      });
      const trendNormalization = jest.requireMock('../../services/trendNormalizationService');
      trendNormalization.normalizeTrends.mockImplementation((results: any[]) =>
        results.flatMap(() => [
          { title: 'AI marketing', source: 'YouTube', confidence: 0.8 },
        ])
      );
      await generateRecommendations({
        companyId: 'c-1',
        regions: [],
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenNthCalledWith(1, 'c-1', 'US', 'marketing', expect.any(Object));
      expect(fetchMock).toHaveBeenNthCalledWith(2, 'c-1', 'UK', 'marketing', expect.any(Object));
    });
  });

  describe('alignment_regression_guard', () => {
    it('1. alignment > popularity: highly aligned low-volume outranks weakly aligned high-volume', async () => {
      (isOmniVyraEnabled as jest.Mock).mockReturnValue(false);
      (getProfile as jest.Mock).mockResolvedValue({
        company_id: 'c-1',
        category: 'marketing',
        campaign_focus: 'marketing saas automation',
        content_themes: 'enterprise',
      });
      const trendNormalization = jest.requireMock('../../services/trendNormalizationService');
      trendNormalization.normalizeTrends.mockReturnValue([
        { title: 'marketing saas automation enterprise', source: 'A', confidence: 0.6, volume: 100 },
        { title: 'marketing tips', source: 'B', confidence: 0.9, volume: 100000 },
      ]);
      const result = await generateRecommendations({
        companyId: 'c-1',
        campaignId: 'camp-1',
      });
      expect(result.trends_used[0]?.topic?.toLowerCase()).toBe(
        'marketing saas automation enterprise'
      );
    });

    it('2. disqualified always excluded: high alignment + popularity still filtered out', async () => {
      (isOmniVyraEnabled as jest.Mock).mockReturnValue(false);
      (getProfile as jest.Mock).mockResolvedValue({
        company_id: 'c-1',
        category: 'marketing',
        campaign_focus: 'marketing automation',
        content_themes: 'saas',
      });
      const trendNormalization = jest.requireMock('../../services/trendNormalizationService');
      trendNormalization.normalizeTrends.mockReturnValue([
        { title: 'marketing automation saas platform', source: 'A', confidence: 0.9, volume: 50000 },
        { title: 'Event marketing automation seminars', source: 'B', confidence: 0.9, volume: 50000 },
      ]);
      const result = await generateRecommendations({
        companyId: 'c-1',
        campaignId: 'camp-1',
      });
      const used = result.trends_used.map((t) => t.topic.toLowerCase());
      const ignored = result.trends_ignored.map((t) => t.topic.toLowerCase());
      expect(ignored.some((t) => t.includes('event'))).toBe(true);
      expect(used).toContain('marketing automation saas platform');
    });

    it('3. core problem filter always active: unrelated trends never enter scoring', async () => {
      (isOmniVyraEnabled as jest.Mock).mockReturnValue(false);
      (getProfile as jest.Mock).mockResolvedValue({
        company_id: 'c-1',
        category: 'marketing',
        campaign_focus: 'marketing saas',
        content_themes: 'automation',
      });
      const trendNormalization = jest.requireMock('../../services/trendNormalizationService');
      trendNormalization.normalizeTrends.mockReturnValue([
        { title: 'marketing saas automation', source: 'A', confidence: 0.7, volume: 100 },
        { title: 'sports playoffs championship finals', source: 'B', confidence: 0.99, volume: 999999 },
      ]);
      const result = await generateRecommendations({
        companyId: 'c-1',
        campaignId: 'camp-1',
      });
      const used = result.trends_used.map((t) => t.topic.toLowerCase());
      const ignored = result.trends_ignored.map((t) => t.topic.toLowerCase());
      expect(ignored).toContain('sports playoffs championship finals');
      expect(used).not.toContain('sports playoffs championship finals');
      expect(used).toContain('marketing saas automation');
    });

    it('4. weighted alignment preserved: campaign_focus dominates lower-weight fields', async () => {
      (isOmniVyraEnabled as jest.Mock).mockReturnValue(false);
      (getProfile as jest.Mock).mockResolvedValue({
        company_id: 'c-1',
        category: 'marketing',
        campaign_focus: 'saas',
        content_themes: 'automation',
        industry: 'retail',
        goals: 'growth',
      });
      const trendNormalization = jest.requireMock('../../services/trendNormalizationService');
      trendNormalization.normalizeTrends.mockReturnValue([
        { title: 'saas solutions enterprise', source: 'A', confidence: 0.7, volume: 100 },
        { title: 'automation enterprise solutions', source: 'B', confidence: 0.7, volume: 100 },
      ]);
      const result = await generateRecommendations({
        companyId: 'c-1',
        campaignId: 'camp-1',
      });
      expect(result.trends_used[0]?.topic?.toLowerCase()).toBe('saas solutions enterprise');
    });

    it('5. fallback compatibility: no alignment tokens → popularity sorting works', async () => {
      (isOmniVyraEnabled as jest.Mock).mockReturnValue(false);
      (getProfile as jest.Mock).mockResolvedValue({
        company_id: 'c-1',
        category: 'marketing',
      });
      const trendNormalization = jest.requireMock('../../services/trendNormalizationService');
      trendNormalization.normalizeTrends.mockReturnValue([
        { title: 'low popularity trend', source: 'A', confidence: 0.5, volume: 100 },
        { title: 'high popularity trend', source: 'B', confidence: 0.95, volume: 50000 },
      ]);
      const result = await generateRecommendations({
        companyId: 'c-1',
        campaignId: 'camp-1',
      });
      expect(result.trends_used[0]?.topic).toBe('high popularity trend');
    });
  });

  describe('alignment_contract_guard', () => {
    it('validates full alignment contract in one scenario', async () => {
      (isOmniVyraEnabled as jest.Mock).mockReturnValue(false);
      (getProfile as jest.Mock).mockResolvedValue({
        company_id: 'c-1',
        category: 'marketing',
        campaign_focus: 'saas',
        content_themes: 'automation',
        industry: 'retail',
        goals: 'growth',
      });
      const trendNormalization = jest.requireMock('../../services/trendNormalizationService');
      trendNormalization.normalizeTrends.mockReturnValue([
        { title: 'sports playoffs championship', source: 'X', confidence: 0.9, volume: 999999 },
        { title: 'Event automation seminars', source: 'Y', confidence: 0.9, volume: 50000 },
        { title: 'saas automation enterprise', source: 'A', confidence: 0.6, volume: 100 },
        { title: 'automation trend', source: 'B', confidence: 0.9, volume: 100000 },
        { title: 'automation marketing tools', source: 'C', confidence: 0.8, volume: 80000 },
      ]);
      const result = await generateRecommendations({
        companyId: 'c-1',
        campaignId: 'camp-1',
      });
      const used = result.trends_used.map((t) => t.topic.toLowerCase());
      const ignored = result.trends_ignored.map((t) => t.topic.toLowerCase());

      expect(ignored).toContain('sports playoffs championship');
      expect(ignored.some((t) => t.includes('event'))).toBe(true);
      expect(result.trends_used[0]?.topic?.toLowerCase()).toBe('saas automation enterprise');
      const saasIdx = used.indexOf('saas automation enterprise');
      const genericIdx = used.indexOf('automation marketing tools');
      expect(saasIdx).toBeLessThan(genericIdx);

      (getProfile as jest.Mock).mockResolvedValue({
        company_id: 'c-1',
        category: 'marketing',
        campaign_focus: 'tools software',
        content_themes: 'platform strategies',
      });
      trendNormalization.normalizeTrends.mockReturnValue([
        { title: 'tools software', source: 'A', confidence: 0.5, volume: 100 },
        { title: 'platform strategies', source: 'B', confidence: 0.95, volume: 50000 },
      ]);
      const fallbackResult = await generateRecommendations({
        companyId: 'c-1',
        campaignId: 'camp-1',
      });
      expect(fallbackResult.trends_used[0]?.topic?.toLowerCase()).toBe('platform strategies');
    });
  });
});
