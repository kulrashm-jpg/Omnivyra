import type { NextApiRequest } from 'next';
import forecastInsightsHandler from '../../../pages/api/community-ai/forecast-insights';
import forecastSimulateHandler from '../../../pages/api/community-ai/forecast-simulate';
import { getProfile } from '../../services/companyProfileService';
import { evaluateCommunityAiForecastInsights } from '../../services/omnivyraClientV1';
import {
  analyticsStore,
  buildQuery,
  createMockRes,
  resetCommunityAiStores,
  scheduledPostStore,
  setRole,
} from './communityAiTestHarness';

jest.mock('../../services/userContextService', () => ({
  enforceCompanyAccess: jest.fn().mockResolvedValue({
    userId: 'user-1',
    role: 'admin',
    companyIds: ['tenant-1'],
    defaultCompanyId: 'tenant-1',
  }),
  resolveUserContext: jest.fn().mockResolvedValue({
    userId: 'user-1',
    role: 'admin',
    companyIds: ['tenant-1'],
    defaultCompanyId: 'tenant-1',
  }),
}));

jest.mock('../../services/companyProfileService', () => ({
  getProfile: jest.fn(),
}));

jest.mock('../../services/omnivyraClientV1', () => ({
  isOmnivyraEnabled: jest.fn().mockReturnValue(true),
  evaluateCommunityAiForecastInsights: jest.fn().mockResolvedValue({
    status: 'ok',
    data: {
      explanation_summary: 'ok',
      key_drivers: [],
      risks: [],
      recommended_actions: [],
      confidence_level: 0.6,
    },
  }),
}));

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

const { supabase } = jest.requireMock('../../db/supabaseClient');

describe('Community-AI Forecast Insights', () => {
  beforeEach(() => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => buildQuery(table));
    (getProfile as jest.Mock).mockResolvedValueOnce({ brand_voice: 'professional' });
    resetCommunityAiStores();
  });

  it('requires tenant/org', async () => {
    setRole('VIEW_ONLY');
    const req = { method: 'GET' } as NextApiRequest;
    const res = createMockRes();
    await forecastInsightsHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('calls Omnivyra with forecast + trends + anomalies', async () => {
    setRole('VIEW_ONLY');
    const postId = 'forecast-insights-1';
    scheduledPostStore.push({
      id: postId,
      company_id: 'tenant-1',
      engagement_goals: { likes: 1 },
      content: 'Post content',
    });
    const date = new Date();
    date.setDate(date.getDate() - 3);
    analyticsStore.push({
      scheduled_post_id: postId,
      platform: 'linkedin',
      content_type: 'text',
      likes: 10,
      comments: 3,
      shares: 2,
      views: 80,
      engagement_rate: 0.5,
      date: date.toISOString().slice(0, 10),
    });
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1', platform: 'linkedin' },
    } as NextApiRequest;
    const res = createMockRes();
    await forecastInsightsHandler(req, res);
    expect(evaluateCommunityAiForecastInsights).toHaveBeenCalledWith(
      expect.objectContaining({
        forecast: expect.any(Array),
        trends: expect.any(Array),
        anomalies: expect.any(Array),
        kpis: expect.any(Object),
      })
    );
  });

  it('returns structured response', async () => {
    setRole('VIEW_ONLY');
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await forecastInsightsHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        explanation_summary: expect.any(String),
        key_drivers: expect.any(Array),
        risks: expect.any(Array),
        recommended_actions: expect.any(Array),
        confidence_level: expect.any(Number),
      })
    );
  });

  it('blocks cross-tenant access', async () => {
    setRole('VIEW_ONLY');
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-2' },
    } as NextApiRequest;
    const res = createMockRes();
    await forecastInsightsHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('Community-AI Forecast Simulation', () => {
  beforeEach(() => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => buildQuery(table));
    (getProfile as jest.Mock).mockResolvedValue(null);
    resetCommunityAiStores();
  });

  it('requires tenant/org', async () => {
    setRole('VIEW_ONLY');
    const req = { method: 'POST', body: { scenario: {} } } as NextApiRequest;
    const res = createMockRes();
    await forecastSimulateHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns baseline + simulated forecast', async () => {
    setRole('VIEW_ONLY');
    const postId = 'forecast-sim-1';
    scheduledPostStore.push({
      id: postId,
      company_id: 'tenant-1',
      engagement_goals: { likes: 1 },
      content: 'Post content',
    });
    const today = new Date();
    for (let i = 1; i <= 14; i += 1) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      analyticsStore.push({
        scheduled_post_id: postId,
        platform: 'linkedin',
        content_type: 'text',
        likes: i <= 7 ? 5 : 20,
        comments: i <= 7 ? 2 : 6,
        shares: i <= 7 ? 1 : 4,
        views: i <= 7 ? 50 : 120,
        engagement_rate: 0.5,
        date: date.toISOString().slice(0, 10),
      });
    }
    const req = {
      method: 'POST',
      body: {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        scenario: { posting_frequency_change: 1, engagement_boost_factor: 10 },
      },
    } as NextApiRequest;
    const res = createMockRes();
    await forecastSimulateHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        baseline_forecast: expect.any(Array),
        simulated_forecast: expect.any(Array),
        delta: expect.any(Array),
        risk_flags: expect.any(Array),
      })
    );
  });

  it('applies content_type_mix adjustments and rejects invalid mix', async () => {
    setRole('VIEW_ONLY');
    const postId = 'forecast-sim-2';
    scheduledPostStore.push({
      id: postId,
      company_id: 'tenant-1',
      engagement_goals: { likes: 1 },
      content: 'Post content',
    });
    const today = new Date();
    for (let i = 1; i <= 14; i += 1) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      analyticsStore.push({
        scheduled_post_id: postId,
        platform: 'linkedin',
        content_type: 'video',
        likes: 10,
        comments: 3,
        shares: 2,
        views: 80,
        engagement_rate: 0.5,
        date: date.toISOString().slice(0, 10),
      });
    }
    const req = {
      method: 'POST',
      body: {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        scenario: { content_type_mix: { video: 20 } },
      },
    } as NextApiRequest;
    const res = createMockRes();
    await forecastSimulateHandler(req, res);
    const payload = (res.json as jest.Mock).mock.calls[0][0];
    expect(payload.simulated_forecast[0].predicted_views).toBeGreaterThan(
      payload.baseline_forecast[0].predicted_views
    );

    const invalidReq = {
      method: 'POST',
      body: {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        scenario: { content_type_mix: { text: 80, video: 30 } },
      },
    } as NextApiRequest;
    const invalidRes = createMockRes();
    await forecastSimulateHandler(invalidReq, invalidRes);
    expect(invalidRes.status).toHaveBeenCalledWith(400);
  });

  it('returns consistent results for same scenario and blocks cross-tenant access', async () => {
    setRole('VIEW_ONLY');
    const postId = 'forecast-sim-3';
    scheduledPostStore.push({
      id: postId,
      company_id: 'tenant-1',
      engagement_goals: { likes: 1 },
      content: 'Post content',
    });
    const today = new Date();
    for (let i = 1; i <= 14; i += 1) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      analyticsStore.push({
        scheduled_post_id: postId,
        platform: 'linkedin',
        content_type: 'text',
        likes: 5,
        comments: 2,
        shares: 1,
        views: 50,
        engagement_rate: 0.5,
        date: date.toISOString().slice(0, 10),
      });
    }
    const req = {
      method: 'POST',
      body: {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        scenario: { posting_frequency_change: 1, engagement_boost_factor: 5 },
      },
    } as NextApiRequest;
    const res = createMockRes();
    await forecastSimulateHandler(req, res);
    const first = (res.json as jest.Mock).mock.calls[0][0];
    const res2 = createMockRes();
    await forecastSimulateHandler(req, res2);
    const second = (res2.json as jest.Mock).mock.calls[0][0];
    expect(second.delta).toEqual(first.delta);

    const crossTenantReq = {
      method: 'POST',
      body: { tenant_id: 'tenant-1', organization_id: 'tenant-2', scenario: {} },
    } as NextApiRequest;
    const crossTenantRes = createMockRes();
    await forecastSimulateHandler(crossTenantReq, crossTenantRes);
    expect(crossTenantRes.status).toHaveBeenCalledWith(400);
  });
});
