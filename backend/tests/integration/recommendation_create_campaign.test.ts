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
/** S2: the route now runs requireCompanyAccess (middleware/authMiddleware: true, or a 403/404 sent and false) on the
 *  recommendation's OWN company (derive-then-authorize). */
const requireCompanyAccessMock = jest.fn(async (_userId: string, _companyId: string, _res: unknown): Promise<boolean> => true);
jest.mock('../../middleware/authMiddleware', () => ({
  ...jest.requireActual('../../middleware/authMiddleware'),
  requireCompanyAccess: (userId: string, companyId: string, res: unknown) => requireCompanyAccessMock(userId, companyId, res),
}));
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
        // FAITHFUL: a row matches only when every eq filter matches (the seam adds .eq('company_id', tenant); the
        // derive step, ownerCompanyOfRow, does a bounded multi-row read by id).
        const filters: Array<[string, unknown]> = [];
        const rows = () => [recommendationRecord].filter((r: any) => filters.every(([c, v]) => r[c] === v));
        const q: any = {};
        q.select = jest.fn(() => q);
        q.eq = jest.fn((c: string, v: unknown) => { filters.push([c, v]); return q; });
        q.limit = jest.fn(() => q);
        q.single = jest.fn(async () => ({ data: rows()[0] ?? null, error: rows().length ? null : { code: 'PGRST116' } }));
        q.maybeSingle = jest.fn(async () => ({ data: rows()[0] ?? null, error: null }));
        q.then = (ok: any, ko: any) => Promise.resolve({ data: rows(), error: null }).then(ok, ko);
        q.update = updateMock;
        return q;
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
    // S2: access was checked on the recommendation's OWN company, before anything was written.
    expect(requireCompanyAccessMock).toHaveBeenCalledWith('user-1', COMPANY_ID, expect.anything());
  });

  it('S2: a caller denied by requireCompanyAccess for the recommendation company creates nothing', async () => {
    requireCompanyAccessMock.mockImplementationOnce(async (_u: string, _c: string, res: any) => {
      res.status(403).json({ error: 'Access denied — you are not a member of this company' });
      return false;
    });
    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer test' },
      query: { id: 'rec-1', companyId: COMPANY_ID },
      body: { durationWeeks: 12, companyId: COMPANY_ID },
    } as unknown as NextApiRequest;
    const res = createMockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(campaignInsertMock).not.toHaveBeenCalled();
  });

  // CONTRACT CHANGE (S2 derive-then-authorize, deliberate): a company-less recommendation has no owner to authorize,
  // so ownerCompanyOfRow answers null and the route gives the uniform 404 (it used to be 400 COMPANY_REQUIRED).
  it('TENANT: a company-less recommendation is refused (uniform 404) and no campaign is created', async () => {
    recommendationCompanyId = null;
    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer test' },
      query: { id: 'rec-1' },
      body: { durationWeeks: 12 },
    } as unknown as NextApiRequest;
    const res = createMockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect((res.json as jest.Mock).mock.calls[0][0]).toEqual({ error: 'Recommendation not found' });
    expect(campaignInsertMock).not.toHaveBeenCalled();
    expect(requireCompanyAccessMock).not.toHaveBeenCalled();
  });
});
