import simulateHandler from '../../../pages/api/recommendations/simulate';
import { supabase } from '../../db/supabaseClient';
import { simulateRecommendations } from '../../services/recommendationSimulationService';
import type { NextApiRequest, NextApiResponse } from 'next';

jest.mock('../../db/supabaseClient', () => ({
  supabase: { rpc: jest.fn() },
}));
jest.mock('../../services/recommendationSimulationService', () => ({
  simulateRecommendations: jest.fn(),
}));
jest.mock('../../services/recommendationPolicyService', () => ({
  validatePolicy: jest.fn().mockReturnValue({ ok: true }),
}));

const createMockRes = () => {
  const res: Partial<NextApiResponse> & { json: jest.Mock } = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  return res as NextApiResponse;
};

describe('Recommendation policy navigation', () => {
  it('blocks simulate for non-admin', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: false, error: null });
    const req = {
      method: 'POST',
      body: { draftPolicyWeights: { trend_score: 1 } },
    } as unknown as NextApiRequest;
    const res = createMockRes();
    await simulateHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('passes campaignId to simulation', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: true, error: null });
    (simulateRecommendations as jest.Mock).mockResolvedValue({
      simulated_recommendations: [],
      baseline_recommendations: [],
      compared_with: 'policy-1',
    });
    const req = {
      method: 'POST',
      body: {
        companyId: 'default',
        campaignId: 'camp-123',
        draftPolicyWeights: { trend_score: 1 },
      },
    } as unknown as NextApiRequest;
    const res = createMockRes();
    await simulateHandler(req, res);
    expect(simulateRecommendations).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignId: 'camp-123',
      })
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
