import type { NextApiRequest } from 'next';
import insightsHandler from '../../../pages/api/community-ai/insights';
import forecastHandler from '../../../pages/api/community-ai/forecast';
import { getProfile } from '../../services/companyProfileService';
import { evaluateCommunityAiInsights } from '../../services/omnivyraClientV1';
import {
  analyticsStore,
  buildQuery,
  createMockRes,
  resetCommunityAiStores,
  scheduledPostStore,
  seedPlaybook,
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
  evaluateCommunityAiInsights: jest.fn().mockResolvedValue({
    status: 'ok',
    data: {
      summary_insight: 'ok',
      key_findings: [],
      recommended_actions: [],
      risks: null,
      confidence_level: 0.5,
    },
  }),
}));

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

const { supabase } = jest.requireMock('../../db/supabaseClient');

describe('Community-AI Insights', () => {
  beforeEach(() => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => buildQuery(table));
    resetCommunityAiStores();
    seedPlaybook();
  });

  it('requires tenant/org', async () => {
    setRole('VIEW_ONLY');
    const req = { method: 'GET' } as unknown as NextApiRequest;
    const res = createMockRes();
    await insightsHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('calls Omnivyra with KPIs + trends + anomalies', async () => {
    setRole('VIEW_ONLY');
    scheduledPostStore.push({
      id: 'insight-1',
      company_id: 'tenant-1',
      engagement_goals: { likes: 5, comments: 2, shares: 1 },
      content: 'Post content',
    });
    analyticsStore.push({
      scheduled_post_id: 'insight-1',
      platform: 'linkedin',
      content_type: 'text',
      likes: 10,
      comments: 3,
      shares: 2,
      views: 50,
      engagement_rate: 1,
      date: new Date().toISOString().slice(0, 10),
    });
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as unknown as NextApiRequest;
    const res = createMockRes();
    await insightsHandler(req, res);
    expect(evaluateCommunityAiInsights).toHaveBeenCalledWith(
      expect.objectContaining({
        kpis: expect.any(Object),
        trends: expect.any(Array),
        anomalies: expect.any(Array),
      })
    );
  });

  it('returns structured insight response', async () => {
    setRole('VIEW_ONLY');
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as unknown as NextApiRequest;
    const res = createMockRes();
    await insightsHandler(req, res);
    const payload = res.json.mock.calls[0][0];
    expect(payload.summary_insight).toBeDefined();
    expect(payload.key_findings).toBeDefined();
    expect(payload.recommended_actions).toBeDefined();
  });

  it('blocks cross-tenant access', async () => {
    setRole('VIEW_ONLY');
    scheduledPostStore.push({
      id: 'insight-2',
      company_id: 'tenant-2',
      engagement_goals: { likes: 5 },
    });
    analyticsStore.push({
      scheduled_post_id: 'insight-2',
      platform: 'linkedin',
      content_type: 'text',
      likes: 1,
      comments: 0,
      shares: 0,
      views: 10,
      engagement_rate: 0.1,
      date: new Date().toISOString().slice(0, 10),
    });
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as unknown as NextApiRequest;
    const res = createMockRes();
    await insightsHandler(req, res);
    expect(evaluateCommunityAiInsights).toHaveBeenCalledWith(
      expect.objectContaining({
        kpis: expect.objectContaining({ by_platform: [] }),
      })
    );
  });
});

describe('Community-AI Forecast', () => {
  beforeEach(() => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => buildQuery(table));
    (getProfile as jest.Mock).mockResolvedValue(null);
    resetCommunityAiStores();
  });

  it('requires tenant/org', async () => {
    setRole('VIEW_ONLY');
    const req = { method: 'GET' } as unknown as NextApiRequest;
    const res = createMockRes();
    await forecastHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns forecast array', async () => {
    setRole('VIEW_ONLY');
    const postId = 'forecast-1';
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
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as unknown as NextApiRequest;
    const res = createMockRes();
    await forecastHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        forecast: expect.any(Array),
        risk_flags: expect.any(Array),
      })
    );
  });

  it('filters by platform and content type', async () => {
    setRole('VIEW_ONLY');
    const postIdA = 'forecast-3';
    const postIdB = 'forecast-4';
    scheduledPostStore.push(
      { id: postIdA, company_id: 'tenant-1', engagement_goals: { likes: 1 }, content: 'Post content' },
      { id: postIdB, company_id: 'tenant-1', engagement_goals: { likes: 1 }, content: 'Post content' }
    );
    const today = new Date();
    for (let i = 1; i <= 10; i += 1) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      analyticsStore.push({
        scheduled_post_id: postIdA,
        platform: 'linkedin',
        content_type: 'text',
        likes: 4,
        comments: 1,
        shares: 1,
        views: 40,
        engagement_rate: 0.5,
        date: date.toISOString().slice(0, 10),
      });
      analyticsStore.push({
        scheduled_post_id: postIdB,
        platform: 'instagram',
        content_type: 'image',
        likes: 6,
        comments: 2,
        shares: 1,
        views: 60,
        engagement_rate: 0.6,
        date: date.toISOString().slice(0, 10),
      });
    }
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1', platform: 'linkedin', content_type: 'text' },
    } as unknown as NextApiRequest;
    const res = createMockRes();
    await forecastHandler(req, res);
    const payload = (res.json as jest.Mock).mock.calls[0][0];
    expect(payload.forecast.every((row: any) => row.platform === 'linkedin')).toBe(true);
    expect(payload.forecast.every((row: any) => row.content_type === 'text')).toBe(true);
  });

  it('returns export-friendly forecast and risk reason data', async () => {
    setRole('VIEW_ONLY');
    const postId = 'forecast-risk-reason';
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
        likes: i <= 7 ? 2 : 50,
        comments: i <= 7 ? 1 : 20,
        shares: i <= 7 ? 1 : 10,
        views: i <= 7 ? 20 : 200,
        engagement_rate: 0.5,
        date: date.toISOString().slice(0, 10),
      });
    }
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1', platform: 'linkedin' },
    } as unknown as NextApiRequest;
    const res = createMockRes();
    await forecastHandler(req, res);
    const payload = (res.json as jest.Mock).mock.calls[0][0];
    expect(payload.forecast.length).toBeGreaterThan(0);
    expect(payload.risk_flags.length).toBeGreaterThan(0);
    expect(payload.risk_flags[0]).toHaveProperty('reason');
  });

  it('blocks cross-tenant access', async () => {
    setRole('VIEW_ONLY');
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-2' },
    } as unknown as NextApiRequest;
    const res = createMockRes();
    await forecastHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
