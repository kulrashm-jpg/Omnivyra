import handler from '../../../pages/api/recommendations/simulate';
import { simulateRecommendations } from '../../services/recommendationSimulationService';
import { supabase } from '../../db/supabaseClient';
import { getProfile } from '../../services/companyProfileService';
import { fetchTrendsFromApis } from '../../services/externalApiService';
import { getActivePolicy } from '../../services/recommendationPolicyService';
import { logRecommendationAudit } from '../../services/recommendationAuditService';
import type { NextApiRequest, NextApiResponse } from 'next';

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));
jest.mock('../../services/companyProfileService', () => ({
  getProfile: jest.fn(),
  normalizeCompanyProfile: jest.fn((profile: any) => ({
    base: profile ?? null,
    categories: [],
    target_audience: null,
    geo_focus: [],
    brand_type: null,
  })),
}));
jest.mock('../../services/externalApiService', () => ({
  fetchTrendsFromApis: jest.fn(),
  getPlatformStrategies: jest.fn().mockResolvedValue([]),
  getCompanyDefaultApiIds: jest.fn().mockResolvedValue([]),
}));
jest.mock('../../services/recommendationPolicyService', () => ({
  getActivePolicy: jest.fn(),
  validatePolicy: jest.fn().mockReturnValue({ ok: true }),
}));
jest.mock('../../services/performanceFeedbackService', () => ({
  getHistoricalAccuracyScore: jest.fn().mockResolvedValue(0.5),
}));
jest.mock('../../services/recommendationAuditService', () => ({
  logRecommendationAudit: jest.fn(),
}));
jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: jest.fn().mockResolvedValue({ user: { id: 'user-1' }, error: null }),
}));
jest.mock('../../services/rbacService', () => ({
  ...jest.requireActual('../../services/rbacService'),
  isSuperAdmin: jest.fn().mockResolvedValue(true),
  getUserRole: jest.fn().mockResolvedValue({ role: 'SUPER_ADMIN', error: null }),
}));

const createMockRes = () => {
  const res: Partial<NextApiResponse> & { json: jest.Mock } = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  return res as NextApiResponse;
};

describe('Recommendation simulation', () => {
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
    },
  ];
  const insertCalls: string[] = [];

  beforeEach(() => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: true, error: null });
    insertCalls.length = 0;
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      const query: any = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        insert: jest.fn(() => {
          insertCalls.push(table);
          return { error: null };
        }),
        then: (resolve: any, reject: any) =>
          Promise.resolve({ data: policiesStore, error: null }).then(resolve, reject),
      };
      return query;
    });
    (getProfile as jest.Mock).mockResolvedValue({ company_id: 'default' });
    (fetchTrendsFromApis as jest.Mock).mockResolvedValue([
      { topic: 'AI marketing', source: 'YouTube Trends', volume: 1000 },
    ]);
    (getActivePolicy as jest.Mock).mockResolvedValue({
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
    });
  });

  it('simulates recommendations without persistence', async () => {
    await expect(
      simulateRecommendations({
        companyId: 'default',
        draftPolicyWeights: {
          trend_score: 2,
          geo_fit: 1,
          audience_fit: 1,
          category_fit: 1,
          platform_fit: 1,
          health_multiplier: 1,
          historical_accuracy: 1,
          effort_penalty: 0.1,
        },
      })
    ).resolves.toBeDefined();

    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer test' },
      query: {},
      body: {
        companyId: 'default',
        draftPolicyWeights: {
          trend_score: 2,
          geo_fit: 1,
          audience_fit: 1,
          category_fit: 1,
          platform_fit: 1,
          health_multiplier: 1,
          historical_accuracy: 1,
          effort_penalty: 0.1,
        },
      },
    } as unknown as NextApiRequest;

    const res = createMockRes();
    await handler(req, res);
    const payload = (res.json as jest.Mock).mock.calls[0][0];

    expect(res.status).toHaveBeenCalledWith(200);
    expect(payload.simulated_recommendations.length).toBeGreaterThan(0);
    expect(payload.compared_with).toBe('policy-1');
    expect(logRecommendationAudit).not.toHaveBeenCalled();
    expect(insertCalls).not.toContain('recommendation_snapshots');
  });
});
