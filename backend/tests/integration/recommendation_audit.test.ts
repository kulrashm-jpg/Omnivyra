import { generateRecommendations } from '../../services/recommendationEngine';
import { getPlatformStrategies } from '../../services/externalApiService';
import { getHistoricalAccuracyScore } from '../../services/performanceFeedbackService';
import { logRecommendationAudit } from '../../services/recommendationAuditService';
import { supabase } from '../../db/supabaseClient';
import handler from '../../../pages/api/recommendations/audit/[id]';
import campaignHandler from '../../../pages/api/recommendations/audit/campaign/[id]';
import type { NextApiRequest, NextApiResponse } from 'next';

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

const createMockRes = () => {
  const res: Partial<NextApiResponse> & { json: jest.Mock } = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  return res as NextApiResponse;
};

describe('Recommendation audit', () => {
  beforeEach(() => {
    (getPlatformStrategies as jest.Mock).mockResolvedValue([]);
    (getHistoricalAccuracyScore as jest.Mock).mockResolvedValue(0.5);
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: true, error: null });
  });

  it('logs audit row during recommendation generation', async () => {
    await generateRecommendations({
      companyProfile: { company_id: 'default' },
      trendSignals: [{ topic: 'AI marketing', source: 'YouTube Trends', volume: 1000 }],
    });
    expect(logRecommendationAudit).toHaveBeenCalled();
  });

  it('fetches audit by recommendation id', async () => {
    const req = { method: 'GET', query: { id: 'rec-1' } } as unknown as NextApiRequest;
    const res = createMockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect((res.json as jest.Mock).mock.calls[0][0].audit).toBeDefined();
  });

  it('fetches audit by campaign id', async () => {
    const req = { method: 'GET', query: { id: 'camp-1' } } as unknown as NextApiRequest;
    const res = createMockRes();
    await campaignHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect((res.json as jest.Mock).mock.calls[0][0].audits).toBeDefined();
  });
});
