import handler from '../../../pages/api/recommendations/generate';
import { getProfile } from '../../services/companyProfileService';
import { fetchTrendsFromApis } from '../../services/externalApiService';
import { assessVirality } from '../../services/viralityAdvisorService';
import { requestDecision } from '../../services/omnivyreClient';
import { supabase } from '../../db/supabaseClient';
import type { NextApiRequest, NextApiResponse } from 'next';

jest.mock('../../services/companyProfileService', () => ({
  getProfile: jest.fn(),
}));
jest.mock('../../services/externalApiService', () => ({
  fetchTrendsFromApis: jest.fn(),
  getPlatformStrategies: jest.fn().mockResolvedValue([]),
}));
jest.mock('../../services/viralityAdvisorService', () => ({
  assessVirality: jest.fn(),
}));
jest.mock('../../services/omnivyreClient', () => ({
  requestDecision: jest.fn(),
  buildDecideRequest: jest.fn((payload: any) => payload),
}));
jest.mock('../../services/viralitySnapshotBuilder', () => ({
  buildCampaignSnapshotWithHash: jest.fn().mockResolvedValue({
    snapshot: {
      snapshot_id: 'snap123',
      domain_type: 'campaign',
      state_payload: { campaign_id: 'camp123' },
      metadata: { owner_id: 'test' },
      timestamp: '2026-01-01T00:00:00Z',
    },
    snapshot_hash: 'hash123',
  }),
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

describe('Recommendation engine', () => {
  beforeEach(() => {
    (supabase.from as jest.Mock).mockImplementation(() => ({
      insert: jest.fn().mockReturnValue({
        select: jest.fn().mockResolvedValue({ data: [{ id: 'rec-1' }], error: null }),
      }),
    }));
  });

  it('generates recommendations from signals', async () => {
    (getProfile as jest.Mock).mockResolvedValue({
      company_id: 'default',
      industry: 'marketing',
      content_themes: 'AI marketing',
    });
    (fetchTrendsFromApis as jest.Mock).mockResolvedValue([
      {
        topic: 'AI marketing',
        source: 'YouTube Trends',
        geo: 'US',
        velocity: 0.8,
        sentiment: 0.2,
        volume: 1200,
      },
    ]);
    (assessVirality as jest.Mock).mockResolvedValue({
      snapshot_hash: 'hash123',
      model_version: 'v1',
      diagnostics: {
        asset_coverage: {},
        platform_opportunity: {},
        engagement_readiness: {},
      },
      comparisons: [],
      overall_summary: 'ok',
    });
    (requestDecision as jest.Mock).mockResolvedValue({
      status: 'ok',
      recommendation: 'GO',
    });

    const req = {
      method: 'POST',
      body: {
        companyId: 'default',
        campaignId: 'camp123',
        geo: 'US',
        category: 'marketing',
      },
    } as unknown as NextApiRequest;

    const res = createMockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = (res.json as jest.Mock).mock.calls[0][0];
    expect(payload.recommendations.length).toBe(1);
    expect(payload.recommendations[0].trend).toBe('AI marketing');
    expect(payload.recommendations[0].confidence).toBeDefined();
    expect(payload.recommendations[0].scores).toBeDefined();
    expect(payload.recommendations[0].explanation).toBeDefined();
  });
});
