import { generateRecommendations } from '../../services/recommendationEngine';
import { getPlatformStrategies } from '../../services/externalApiService';
import { getHistoricalAccuracyScore } from '../../services/performanceFeedbackService';

jest.mock('../../services/externalApiService', () => ({
  getPlatformStrategies: jest.fn(),
}));
jest.mock('../../services/performanceFeedbackService', () => ({
  getHistoricalAccuracyScore: jest.fn().mockResolvedValue(0.5),
}));
jest.mock('../../services/recommendationPolicyService', () => ({
  getActivePolicy: jest.fn().mockResolvedValue({
    id: 'policy-1',
    name: 'default',
    is_active: true,
    weights: {
      trend_score: 1.5,
      geo_fit: 1.2,
      audience_fit: 1.0,
      category_fit: 1.0,
      platform_fit: 1.0,
      health_multiplier: 1.0,
      historical_accuracy: 1.0,
      effort_penalty: 0.5,
    },
  }),
  validatePolicy: jest.fn().mockReturnValue({ ok: true }),
  updatePolicy: jest.fn(),
}));

describe('Platform strategy filtering', () => {
  beforeEach(() => {
    (getPlatformStrategies as jest.Mock).mockResolvedValue([
      {
        platform_type: 'social',
        supported_content_types: ['text'],
        supported_promotion_modes: ['organic'],
        required_metadata: ['hashtags'],
        is_active: true,
        health_score: 0.9,
        category: 'linkedin',
      },
      {
        platform_type: 'video',
        supported_content_types: ['video'],
        supported_promotion_modes: ['organic'],
        required_metadata: [],
        is_active: true,
        health_score: 0.9,
        category: 'youtube',
      },
      {
        platform_type: 'social',
        supported_content_types: ['text'],
        supported_promotion_modes: ['paid'],
        required_metadata: [],
        is_active: true,
        health_score: 0.9,
        category: 'facebook',
      },
      {
        platform_type: 'social',
        supported_content_types: ['text'],
        supported_promotion_modes: ['organic'],
        required_metadata: [],
        is_active: false,
        health_score: 0.9,
        category: 'x',
      },
    ]);
    (getHistoricalAccuracyScore as jest.Mock).mockResolvedValue(0.5);
  });

  it('filters platforms by content type and promotion mode', async () => {
    const recs = await generateRecommendations({
      companyProfile: null,
      trendSignals: [{ topic: 'AI', source: 'Trends', volume: 1000 }],
    });

    const platforms = recs[0].platforms || [];
    expect(platforms.find((p) => p.platform === 'linkedin')).toBeDefined();
    expect(platforms.find((p) => p.platform === 'youtube')).toBeUndefined();
    expect(platforms.find((p) => p.platform === 'facebook')).toBeUndefined();
    expect(platforms.find((p) => p.platform === 'x')).toBeUndefined();
    expect(platforms[0].required_metadata).toContain('hashtags');
  });

  it('includes newly configured platform', async () => {
    (getPlatformStrategies as jest.Mock).mockResolvedValueOnce([
      {
        platform_type: 'blog',
        supported_content_types: ['text'],
        supported_promotion_modes: ['organic'],
        required_metadata: ['seo_keywords'],
        is_active: true,
        health_score: 0.9,
        category: 'blog',
      },
    ]);

    const recs = await generateRecommendations({
      companyProfile: null,
      trendSignals: [{ topic: 'AI', source: 'Trends', volume: 1000 }],
    });

    const platforms = recs[0].platforms || [];
    expect(platforms.find((p) => p.platform === 'blog')).toBeDefined();
  });
});
