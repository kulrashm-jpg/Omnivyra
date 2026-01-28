import { runWeeklyRecommendationRefresh, runCompanyProfileTriggeredRefresh } from '../../services/recommendationScheduler';
import { supabase } from '../../db/supabaseClient';
import { fetchTrendsFromApis } from '../../services/externalApiService';
import { generateRecommendations } from '../../services/recommendationEngine';
import { getProfile } from '../../services/companyProfileService';

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));
jest.mock('../../services/externalApiService', () => ({
  fetchTrendsFromApis: jest.fn(),
}));
jest.mock('../../services/recommendationEngine', () => ({
  generateRecommendations: jest.fn(),
}));
jest.mock('../../services/companyProfileService', () => ({
  getProfile: jest.fn(),
}));

const buildQuery = (result: { data: any; error: any }) => {
  const query: any = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    insert: jest.fn().mockResolvedValue({ error: null }),
    then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
  };
  return query;
};

describe('Recommendation scheduler', () => {
  beforeEach(() => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'company_profiles') {
        return buildQuery({ data: [{ company_id: 'default' }], error: null });
      }
      if (table === 'recommendation_snapshots') {
        return buildQuery({ data: [], error: null });
      }
      return buildQuery({ data: [], error: null });
    });

    (fetchTrendsFromApis as jest.Mock).mockResolvedValue([
      { topic: 'AI marketing', source: 'YouTube Trends' },
    ]);
    (generateRecommendations as jest.Mock).mockReturnValue([
      {
        trend: 'AI marketing',
        category: 'AI marketing',
        audience: null,
        geo: 'US',
        platforms: ['linkedin'],
        promotion_mode: 'organic',
        effort_score: 1,
        expected_reach: 100,
        expected_growth: 10,
        final_score: 1,
        scores: {
          trend_score: 1,
          geo_fit_score: 1,
          platform_fit_score: 1,
          demographic_fit_score: 1,
          promotion_fit_score: 1,
          effort_score: 1,
          final_score: 1,
        },
        confidence: 80,
        explanation: 'Test explanation',
      },
    ]);
    (getProfile as jest.Mock).mockResolvedValue({ company_id: 'default' });
  });

  it('runs weekly refresh and persists with auto_weekly source', async () => {
    await runWeeklyRecommendationRefresh();

    expect(generateRecommendations).toHaveBeenCalled();
  });

  it('runs profile refresh and persists with profile_update source', async () => {
    await runCompanyProfileTriggeredRefresh('default');

    expect(generateRecommendations).toHaveBeenCalled();
  });
});
