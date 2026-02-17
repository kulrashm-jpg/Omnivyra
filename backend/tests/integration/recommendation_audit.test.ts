import { generateRecommendations } from '../../services/recommendationEngine';
import { getPlatformStrategies } from '../../services/externalApiService';
import { logRecommendationAudit } from '../../services/recommendationAuditService';
import { supabase } from '../../db/supabaseClient';
import handler from '../../../pages/api/recommendations/audit/[id]';
import campaignHandler from '../../../pages/api/recommendations/audit/campaign/[id]';
import { createApiRequestMock, createMockRes, createSupabaseMock } from '../utils';

jest.mock('../../services/externalApiService', () => ({
  getPlatformStrategies: jest.fn().mockResolvedValue([]),
}));
jest.mock('../../services/performanceFeedbackService', () => ({
  getHistoricalAccuracyScore: jest.fn().mockResolvedValue(0.5),
}));
jest.mock('../../services/recommendationAuditService', () => ({
  logRecommendationAudit: jest.fn(),
  getAuditByRecommendationId: jest.fn().mockResolvedValue({ recommendation_id: 'rec-1' }),
  getAuditByCampaignId: jest.fn().mockResolvedValue([{ recommendation_id: 'rec-1' }]),
}));
jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));
jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: jest.fn().mockResolvedValue({ user: { id: 'user-1' }, error: null }),
}));
jest.mock('../../services/rbacService', () =>
  require('../utils/setupApiTest').getRbacMockImplementations()
);

const policyRow = {
  id: 'policy-1',
  is_active: true,
  weights: { trend_score: 1, geo_fit: 1, audience_fit: 1, category_fit: 1, platform_fit: 1 },
};

describe('Recommendation audit', () => {
  beforeEach(() => {
    (getPlatformStrategies as jest.Mock).mockResolvedValue([]);
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: true, error: null });
    const mockResponses = (table: string) => {
      if (table === 'recommendation_policies') return { data: [policyRow], error: null };
      return { data: [], error: null };
    };
    const { from } = createSupabaseMock(mockResponses);
    (supabase.from as jest.Mock).mockImplementation(from);
  });

  it('logs audit row during recommendation generation', async () => {
    await generateRecommendations({
      companyProfile: { company_id: 'default' },
      trendSignals: [{ topic: 'AI marketing', source: 'YouTube Trends', volume: 1000 }],
    });
    expect(logRecommendationAudit).toHaveBeenCalled();
  });

  it('fetches audit by recommendation id', async () => {
    const req = createApiRequestMock({ method: 'GET', id: 'rec-1', companyId: 'default' });
    const res = createMockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body?.audit).toBeDefined();
  });

  it('fetches audit by campaign id', async () => {
    const req = createApiRequestMock({ method: 'GET', id: 'camp-1', companyId: 'default' });
    const res = createMockRes();
    await campaignHandler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body?.audits).toBeDefined();
  });
});
