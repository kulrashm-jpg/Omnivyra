import handler from '../../../pages/api/recommendations/[id]/create-campaign';

/** TENANT: the campaigns insert, captured so its payload can be asserted. */
const campaignInsertMock = jest.fn();
/** The recommendation's company: uuid-shaped, as the tenant seam (tenantContextFor) requires. */
const COMPANY_ID = 'c0a00000-0000-4000-8000-00000000def0';
/** TENANT: the recommendation's company for the next request (null = a company-less recommendation). */
let recommendationCompanyId: string | null = COMPANY_ID;
import { runCampaignAiPlan } from '../../services/campaignAiOrchestrator';
import { supabase } from '../../db/supabaseClient';
import type { NextApiRequest, NextApiResponse } from 'next';

jest.mock('../../services/campaignAiOrchestrator', () => ({
  runCampaignAiPlan: jest.fn(),
}));

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));
jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: jest.fn(),
}));
jest.mock('../../services/userContextService', () => ({
  resolveUserContext: jest.fn().mockResolvedValue({ userId: 'user-1' }),
}));
jest.mock('../../services/rbacService', () => ({
  ...jest.requireActual('../../services/rbacService'),
  isSuperAdmin: jest.fn().mockResolvedValue(true),
  getUserRole: jest.fn().mockResolvedValue({ role: 'SUPER_ADMIN', error: null }),
}));
jest.mock('../../middleware/withRBAC', () => ({ withRBAC: (handler: any) => handler }));
const { getSupabaseUserFromRequest } = jest.requireMock('../../services/supabaseAuthService');

const createMockRes = () => {
  const res: Partial<NextApiResponse> & { json: jest.Mock } = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  return res as NextApiResponse;
};

describe('Recommendation create campaign API', () => {
  beforeEach(() => {
    campaignInsertMock.mockClear();
    recommendationCompanyId = COMPANY_ID;
    (getSupabaseUserFromRequest as jest.Mock).mockResolvedValue({ user: { id: 'user-1' }, error: null });
    const recommendationRecord = {
      id: 'rec-1',
      get company_id() { return recommendationCompanyId; },
      trend_topic: 'AI marketing',
      category: 'marketing',
      audience: { segment: 'founders' },
      geo: 'US',
      platforms: [{ platform: 'linkedin' }],
      promotion_mode: 'organic',
    };
    const campaignRecord = { id: 'camp-1', name: 'Trend: AI marketing' };

    // The tenant seam adds `.eq('company_id', tenant)` before the route's `.eq('id', ...)`: every `.eq` returns the
    // builder, and the builder resolves (as PostgREST's does).
    const updateMock = jest.fn(() => {
      const u: any = {};
      u.eq = jest.fn(() => u);
      u.then = (onOk: any, onErr: any) => Promise.resolve({ error: null }).then(onOk, onErr);
      return u;
    });

    const chain = (data: any, error: any = null) => ({
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockResolvedValue({ error: null }),
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data, error }),
      maybeSingle: jest.fn().mockResolvedValue({ data: data?.[0] ?? null, error }),
      then: (resolve: any) => Promise.resolve({ data: Array.isArray(data) ? data : [data], error }).then(resolve),
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
          insert: campaignInsertMock.mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: campaignRecord, error: null }),
            }),
          }),
        };
      }
      if (table === 'audit_logs') {
        return chain([], null);
      }
      if (table === 'campaign_versions') {
        return chain(null, null);
      }
      return chain([]);
    });

    (runCampaignAiPlan as jest.Mock).mockResolvedValue({
      snapshot_hash: 'hash123',
      omnivyre_decision: { decision_id: 'dec-1', recommendation: 'GO' },
    });
  });

  it('creates campaign, links recommendation, and returns response', async () => {
    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer test' },
      query: { id: 'rec-1', companyId: COMPANY_ID },
      body: { durationWeeks: 12, companyId: COMPANY_ID },
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
    // TENANT (NULL company_id trace, e9 2026-11-12): the campaign row is owned by the recommendation's company.
    expect(campaignInsertMock).toHaveBeenCalledTimes(1);
    expect(campaignInsertMock.mock.calls[0][0]).toMatchObject({ company_id: COMPANY_ID });
  });

  it('TENANT: a company-less recommendation is refused (400) and no campaign is created', async () => {
    recommendationCompanyId = null;
    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer test' },
      query: { id: 'rec-1' },
      body: { durationWeeks: 12 },
    } as unknown as NextApiRequest;
    const res = createMockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect((res.json as jest.Mock).mock.calls[0][0]).toMatchObject({ code: 'COMPANY_REQUIRED' });
    expect(campaignInsertMock).not.toHaveBeenCalled();
  });
});
