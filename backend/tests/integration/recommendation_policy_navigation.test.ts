import simulateHandler from '../../../pages/api/recommendations/simulate';
import { supabase } from '../../db/supabaseClient';
import { simulateRecommendations } from '../../services/recommendationSimulationService';
import { createApiRequestMock, createMockRes } from '../utils';

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));
jest.mock('../../services/recommendationSimulationService', () => ({
  simulateRecommendations: jest.fn(),
}));
jest.mock('../../services/recommendationPolicyService', () => ({
  validatePolicy: jest.fn().mockReturnValue({ ok: true }),
}));
jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: jest.fn().mockResolvedValue({ user: { id: 'user-1' }, error: null }),
}));
jest.mock('../../services/rbacService', () =>
  require('../utils/setupApiTest').getRbacMockImplementations()
);

describe('Recommendation policy navigation', () => {
  beforeEach(() => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: true, error: null });
  });

  it('blocks simulate for non-admin', async () => {
    const rbac = require('../../services/rbacService');
    (rbac.enforceRole as jest.Mock).mockImplementationOnce(async ({ res }: { res: any }) => {
      res.status(403).json({ error: 'FORBIDDEN_ROLE' });
      return null;
    });
    const req = createApiRequestMock({
      method: 'POST',
      companyId: 'default',
      body: { draftPolicyWeights: { trend_score: 1 } },
    });
    const res = createMockRes();
    await simulateHandler(req, res);
    expect(res.statusCode).toBe(403);
  });

  it('passes campaignId to simulation', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: true, error: null });
    (simulateRecommendations as jest.Mock).mockResolvedValue({
      simulated_recommendations: [],
      baseline_recommendations: [],
      compared_with: 'policy-1',
    });
    const req = createApiRequestMock({
      method: 'POST',
      companyId: 'default',
      body: {
        companyId: 'default',
        campaignId: 'camp-123',
        draftPolicyWeights: { trend_score: 1 },
      },
    });
    const res = createMockRes();
    await simulateHandler(req, res);
    expect(simulateRecommendations).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: 'camp-123' })
    );
    expect(res.statusCode).toBe(200);
  });
});
