import handler from '../../../pages/api/recommendations/analytics';
import { supabase } from '../../db/supabaseClient';
import type { NextApiRequest, NextApiResponse } from 'next';

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

const buildQuery = (result: { data: any; error: any }) => {
  const query: any = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    lte: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
  };
  return query;
};

describe('Recommendation analytics', () => {
  beforeEach(() => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: true, error: null });
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'recommendation_snapshots') {
        return buildQuery({
          data: [
            {
              id: 'rec-1',
              campaign_id: 'camp-1',
              confidence: 80,
              platforms: ['linkedin'],
              created_at: '2026-01-01T00:00:00Z',
            },
          ],
          error: null,
        });
      }
      if (table === 'recommendation_audit_logs') {
        return buildQuery({
          data: [
            {
              policy_id: 'policy-1',
              confidence: 80,
              final_score: 1.2,
              trend_sources_used: [{ source: 'YouTube Trends' }],
              created_at: '2026-01-01T00:00:00Z',
            },
          ],
          error: null,
        });
      }
      if (table === 'performance_feedback') {
        return buildQuery({
          data: [
            { campaign_id: 'camp-1', engagement_rate: 0.1, collected_at: '2026-01-01T00:00:00Z' },
          ],
          error: null,
        });
      }
      if (table === 'recommendation_policies') {
        return buildQuery({
          data: [{ id: 'policy-1', name: 'Default Policy' }],
          error: null,
        });
      }
      return buildQuery({ data: [], error: null });
    });
  });

  it('computes analytics and enforces admin gating', async () => {
    const req = {
      method: 'GET',
      query: {},
    } as unknown as NextApiRequest;
    const res = createMockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = (res.json as jest.Mock).mock.calls[0][0];
    expect(payload.totals.recommendations_count).toBe(1);
    expect(payload.by_platform[0].platform).toBe('linkedin');
    expect(payload.timeline[0].count).toBe(1);
    expect(payload.by_policy[0].policy_id).toBe('policy-1');
  });

  it('blocks non-admin access', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValueOnce({ data: false, error: null });
    const req = {
      method: 'GET',
      query: {},
    } as unknown as NextApiRequest;
    const res = createMockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
