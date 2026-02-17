import { generateRecommendations } from '../../services/recommendationEngine';
import { getPlatformStrategies } from '../../services/externalApiService';
import { getHistoricalAccuracyScore } from '../../services/performanceFeedbackService';

jest.mock('../../services/externalApiService', () => ({
  getPlatformStrategies: jest.fn().mockResolvedValue([]),
}));
jest.mock('../../services/performanceFeedbackService', () => ({
  getHistoricalAccuracyScore: jest.fn().mockResolvedValue(0.5),
}));
jest.mock('../../services/recommendationPolicyService', () => ({
  ...jest.requireActual('../../services/recommendationPolicyService'),
  getActivePolicy: jest.fn().mockResolvedValue({
    id: 'policy-1',
    name: 'Default',
    is_active: true,
    weights: {
      trend_score: 1,
      geo_fit: 1,
      audience_fit: 1,
      category_fit: 1,
      platform_fit: 1,
      health_multiplier: 1,
      historical_accuracy: 1,
      effort_penalty: 1,
    },
  }),
}));

describe('Recommendation fusion scoring', () => {
  beforeEach(() => {
    (getPlatformStrategies as jest.Mock).mockResolvedValue([]);
    (getHistoricalAccuracyScore as jest.Mock).mockResolvedValue(0.5);
  });

  it('boosts consensus for multi-source trends', async () => {
    const recs = await generateRecommendations({
      companyProfile: { company_id: 'default' },
      trendSignals: [
        { topic: 'AI marketing', source: 'Google Trends', volume: 1000, velocity: 1, sentiment: 0.5 },
        { topic: 'AI marketing', source: 'YouTube Trends', volume: 1000, velocity: 1, sentiment: 0.5 },
        { topic: 'AI marketing', source: 'Reddit', volume: 1000, velocity: 1, sentiment: 0.5 },
      ],
    });

    expect(recs[0].scores.source_consensus_score).toBeGreaterThan(1);
    expect(recs[0].scores.trend_score).toBeCloseTo(1.2, 2);
    expect(recs[0].trend_source).toContain('Google Trends');
    expect(recs[0].trend_source).toContain('YouTube Trends');
  });

  it('applies geo relevance scoring', async () => {
    const recs = await generateRecommendations({
      companyProfile: { company_id: 'default', geography: 'US' },
      trendSignals: [{ topic: 'AI marketing', source: 'News', geo: 'UK', volume: 1000 }],
    });

    expect(recs[0].scores.geo_fit_score).toBeCloseTo(0.85, 2);
  });

  it('applies audience fit scoring', async () => {
    const recs = await generateRecommendations({
      companyProfile: { company_id: 'default', target_audience: 'Women 18-24, creators' },
      trendSignals: [{ topic: 'Women creators growth', source: 'YouTube Trends', volume: 1000 }],
    });

    expect(recs[0].scores.audience_fit_score).toBeCloseTo(1.2, 2);
  });
});
