import collectHandler from '../../../pages/api/performance/collect';
import campaignHandler from '../../../pages/api/performance/campaign/[id]';
import { supabase } from '../../db/supabaseClient';
import type { NextApiRequest, NextApiResponse } from 'next';

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

describe('Performance feedback', () => {
  const feedbackStore: any[] = [];
  const recommendationStore: any[] = [
    {
      id: 'rec-1',
      campaign_id: 'camp-1',
      success_projection: { expected_reach: 1000 },
      confidence: 80,
    },
  ];

  const buildQuery = (table: string) => {
    const state: { filters: Record<string, any> } = { filters: {} };
    const query: any = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn((field: string, value: any) => {
        state.filters[field] = value;
        return query;
      }),
      insert: jest.fn(async (payload: any) => {
        if (table === 'performance_feedback') {
          feedbackStore.push(payload);
        }
        return { error: null };
      }),
      then: (resolve: any, reject: any) => {
        if (table === 'performance_feedback') {
          const filtered = feedbackStore.filter(
            (row) => row.campaign_id === state.filters.campaign_id
          );
          return Promise.resolve({ data: filtered, error: null }).then(resolve, reject);
        }
        if (table === 'recommendation_snapshots') {
          const filtered = recommendationStore.filter(
            (row) => row.campaign_id === state.filters.campaign_id
          );
          return Promise.resolve({ data: filtered, error: null }).then(resolve, reject);
        }
        return Promise.resolve({ data: [], error: null }).then(resolve, reject);
      },
    };
    return query;
  };

  beforeEach(() => {
    feedbackStore.length = 0;
    (supabase.from as jest.Mock).mockImplementation((table: string) => buildQuery(table));
  });

  it('records metrics and aggregates accuracy', async () => {
    const collectReq = {
      method: 'POST',
      body: {
        campaign_id: 'camp-1',
        recommendation_id: 'rec-1',
        platform: 'linkedin',
        post_id: 'post-1',
        impressions: 800,
        likes: 80,
        shares: 10,
        comments: 10,
        clicks: 20,
        source: 'platform_api',
      },
    } as unknown as NextApiRequest;

    const collectRes = createMockRes();
    await collectHandler(collectReq, collectRes);
    expect(collectRes.status).toHaveBeenCalledWith(200);

    const campaignReq = {
      method: 'GET',
      query: { id: 'camp-1' },
    } as unknown as NextApiRequest;

    const campaignRes = createMockRes();
    await campaignHandler(campaignReq, campaignRes);
    const payload = (campaignRes.json as jest.Mock).mock.calls[0][0];
    expect(payload.campaign_id).toBe('camp-1');
    expect(payload.impressions).toBe(800);
    expect(payload.engagement_rate).toBeCloseTo(0.15, 4);
    expect(payload.accuracy_score).toBeCloseTo(0.8, 2);
  });
});
