import { getActivePolicy, updatePolicy } from '../../services/recommendationPolicyService';
import { generateRecommendations } from '../../services/recommendationEngine';
import { supabase } from '../../db/supabaseClient';
import { logRecommendationAudit } from '../../services/recommendationAuditService';

jest.mock('../../services/externalApiService', () => ({
  getPlatformStrategies: jest.fn().mockResolvedValue([]),
}));
jest.mock('../../services/performanceFeedbackService', () => ({
  getHistoricalAccuracyScore: jest.fn().mockResolvedValue(0.5),
}));
jest.mock('../../services/recommendationAuditService', () => ({
  logRecommendationAudit: jest.fn(),
}));
jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));

const policiesStore = [
  {
    id: 'policy-1',
    name: 'Default Policy',
    is_active: true,
    weights: {
      trend_score: 1,
      geo_fit: 1,
      audience_fit: 1,
      category_fit: 1,
      platform_fit: 1,
      health_multiplier: 1,
      historical_accuracy: 1,
      effort_penalty: 0.1,
    },
    updated_at: '2026-01-01T00:00:00Z',
  },
];

const buildQuery = (table: string) => {
  let filters: Record<string, any> = {};
  const query: any = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn((field: string, value: any) => {
      filters[field] = value;
      return query;
    }),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    update: jest.fn((payload: any) => {
      const applyUpdate = () => {
        const idx = policiesStore.findIndex((policy) => policy.id === filters.id);
        if (idx >= 0) {
          policiesStore[idx] = { ...policiesStore[idx], ...payload };
        }
        return {
          select: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: policiesStore[idx], error: null }),
        };
      };
      return {
        eq: jest.fn((field: string, value: any) => {
          filters[field] = value;
          return applyUpdate();
        }),
      };
    }),
    single: jest.fn().mockResolvedValue({ data: policiesStore[0], error: null }),
    then: (resolve: any, reject: any) =>
      Promise.resolve({ data: policiesStore, error: null }).then(resolve, reject),
  };
  return query;
};

describe('Recommendation policy', () => {
  beforeEach(() => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => buildQuery(table));
  });

  it('loads default policy', async () => {
    const policy = await getActivePolicy();
    expect(policy?.id).toBe('policy-1');
  });

  it('updates policy weights', async () => {
    const updated = await updatePolicy('policy-1', {
      trend_score: 2,
      geo_fit: 1,
      audience_fit: 1,
      category_fit: 1,
      platform_fit: 1,
      health_multiplier: 1,
      historical_accuracy: 1,
      effort_penalty: 0.1,
    });
    expect(updated.weights.trend_score).toBe(2);
  });

  it('uses policy weights and logs audit policy snapshot', async () => {
    policiesStore[0].weights.trend_score = 2;
    await generateRecommendations({
      companyProfile: { company_id: 'default' },
      trendSignals: [{ topic: 'AI marketing', source: 'YouTube Trends', volume: 1000 }],
    });
    expect(logRecommendationAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        policy_id: 'policy-1',
        policy_weights_used: expect.any(Object),
      })
    );
  });
});
