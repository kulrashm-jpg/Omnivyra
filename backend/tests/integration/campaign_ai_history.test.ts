import handler from '../../../pages/api/campaigns/[id]/ai-history';
import { supabase } from '../../db/supabaseClient';
import type { NextApiRequest, NextApiResponse } from 'next';

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));

type SupabaseResult = { data: any; error: any };

const buildQuery = (result: SupabaseResult) => {
  const query: any = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
  };

  return query;
};

const createMockRes = () => {
  const res: Partial<NextApiResponse> & { json: jest.Mock } = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  return res as NextApiResponse;
};

describe('Campaign AI history API', () => {
  it('returns ai history entries for campaign', async () => {
    const planQuery = buildQuery({
      data: [
        {
          snapshot_hash: 'snap-1',
          omnivyre_decision: { recommendation: 'GO' },
          weeks: [{ week: 1, theme: 'Week 1', daily: [] }],
          created_at: '2026-01-01T00:00:00Z',
        },
      ],
      error: null,
    });

    const scheduledQuery = buildQuery({
      data: [
        {
          id: 'post-1',
          platform: 'linkedin',
          content: 'Test post',
          scheduled_for: '2026-01-02T09:00:00Z',
          status: 'scheduled',
          created_at: '2026-01-01T12:00:00Z',
        },
      ],
      error: null,
    });

    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === '12_week_plan') return planQuery;
      if (table === 'scheduled_posts') return scheduledQuery;
      return buildQuery({ data: [], error: null });
    });

    const req = {
      method: 'GET',
      query: { id: 'campaign-123' },
    } as unknown as NextApiRequest;

    const res = createMockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = (res.json as jest.Mock).mock.calls[0][0];
    expect(payload.history).toHaveLength(1);
    expect(payload.history[0].snapshot_hash).toBe('snap-1');
    expect(payload.history[0].scheduled_posts).toHaveLength(1);
  });
});
