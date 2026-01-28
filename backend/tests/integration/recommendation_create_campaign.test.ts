import handler from '../../../pages/api/recommendations/[id]/create-campaign';
import { runCampaignAiPlan } from '../../services/campaignAiOrchestrator';
import { supabase } from '../../db/supabaseClient';
import type { NextApiRequest, NextApiResponse } from 'next';

jest.mock('../../services/campaignAiOrchestrator', () => ({
  runCampaignAiPlan: jest.fn(),
}));

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));

const createMockRes = () => {
  const res: Partial<NextApiResponse> & { json: jest.Mock } = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  return res as NextApiResponse;
};

describe('Recommendation create campaign API', () => {
  beforeEach(() => {
    const recommendationRecord = {
      id: 'rec-1',
      company_id: 'default',
      trend_topic: 'AI marketing',
      category: 'marketing',
      audience: { segment: 'founders' },
      geo: 'US',
      platforms: [{ platform: 'linkedin' }],
      promotion_mode: 'organic',
    };
    const campaignRecord = { id: 'camp-1', name: 'Trend: AI marketing' };

    const updateMock = jest.fn().mockReturnValue({
      eq: jest.fn().mockResolvedValue({ error: null }),
    });

    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'recommendation_snapshots') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: recommendationRecord, error: null }),
            }),
          }),
          update: updateMock,
        };
      }
      if (table === 'campaigns') {
        return {
          insert: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: campaignRecord, error: null }),
            }),
          }),
        };
      }
      return {};
    });

    (runCampaignAiPlan as jest.Mock).mockResolvedValue({
      snapshot_hash: 'hash123',
      omnivyre_decision: { decision_id: 'dec-1', recommendation: 'GO' },
    });
  });

  it('creates campaign, links recommendation, and returns response', async () => {
    const req = {
      method: 'POST',
      query: { id: 'rec-1' },
      body: { durationWeeks: 12 },
    } as unknown as NextApiRequest;

    const res = createMockRes();
    await handler(req, res);

    expect(runCampaignAiPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignId: 'camp-1',
        mode: 'generate_plan',
      })
    );

    const payload = (res.json as jest.Mock).mock.calls[0][0];
    expect(res.status).toHaveBeenCalledWith(200);
    expect(payload.campaign_id).toBe('camp-1');
    expect(payload.snapshot_hash).toBe('hash123');
    expect(payload.omnivyre_decision).toBeDefined();
  });
});
