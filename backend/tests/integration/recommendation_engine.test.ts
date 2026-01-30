import handler from '../../../pages/api/recommendations/generate';
import type { NextApiRequest, NextApiResponse } from 'next';
import { generateRecommendations } from '../../services/recommendationEngineService';
import { getProfile } from '../../services/companyProfileService';
import { fetchTrendsFromApis } from '../../services/externalApiService';
import { validateUniqueness } from '../../services/campaignMemoryService';
import { generateCampaignStrategy } from '../../services/campaignRecommendationService';
import { getTrendRanking, getTrendRelevance, isOmniVyraEnabled } from '../../services/omnivyraClientV1';

jest.mock('../../services/companyProfileService', () => ({
  getProfile: jest.fn(),
}));
jest.mock('../../services/externalApiService', () => ({
  fetchTrendsFromApis: jest.fn(),
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
    (getProfile as jest.Mock).mockResolvedValue({ company_id: 'c-1', category: 'marketing' });
    (fetchTrendsFromApis as jest.Mock).mockResolvedValue([
      { topic: 'AI marketing', source: 'YouTube Trends', volume: 1200 },
      { topic: 'AI marketing', source: 'NewsAPI', volume: 900 },
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
});
