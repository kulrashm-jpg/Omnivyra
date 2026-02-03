import { NextApiRequest, NextApiResponse } from 'next';

jest.mock('../../../utils/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}));

jest.mock('../../../backend/services/userContextService', () => ({
  enforceCompanyAccess: jest.fn(),
}));

const { supabase } = jest.requireMock('../../../utils/supabaseClient');
const { createClient } = jest.requireMock('@supabase/supabase-js');
const { enforceCompanyAccess } = jest.requireMock('../../../backend/services/userContextService');

const createMockRes = () => {
  const res: Partial<NextApiResponse> & { statusCode?: number; body?: any } = {};
  res.status = (code: number) => {
    res.statusCode = code;
    return res as NextApiResponse;
  };
  res.json = (payload: any) => {
    res.body = payload;
    return res as NextApiResponse;
  };
  return res as NextApiResponse & { statusCode?: number; body?: any };
};

const buildQuery = (table: string, state: any) => {
  const query: any = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn((field: string, value: any) => {
      if (table === 'campaigns' && field === 'company_id') {
        throw new Error('campaigns.company_id referenced');
      }
      state.filters[field] = value;
      return query;
    }),
    in: jest.fn((field: string, values: any[]) => {
      state.inFilter = { field, values };
      return query;
    }),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    single: jest.fn(() => {
      state.single = true;
      return query;
    }),
    then: (resolve: any, reject: any) => {
      const result = resolveQuery(table, state);
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  return query;
};

const resolveQuery = (table: string, state: any) => {
  if (table === 'campaign_versions') {
    const companyId = state.filters.company_id;
    const campaignId = state.filters.campaign_id;
    const rows = (state.rows || []).filter((row: any) => {
      if (companyId && row.company_id !== companyId) return false;
      if (campaignId && row.campaign_id !== campaignId) return false;
      return true;
    });
    const data = state.single ? rows[0] || null : rows;
    return { data, error: null };
  }
  if (table === 'campaigns') {
    const ids = state.inFilter?.values;
    let rows = state.campaignRows || [];
    if (ids && ids.length > 0) {
      rows = rows.filter((row: any) => ids.includes(row.id));
    }
    if (state.filters.id) {
      rows = rows.filter((row: any) => row.id === state.filters.id);
    }
    const data = state.single ? rows[0] || null : rows;
    return { data, error: null };
  }
  if (table === 'scheduled_posts') {
    return { count: 0, error: null };
  }
  return { data: [], error: null };
};

describe('Campaign company scope fix', () => {
  beforeEach(() => {
    (enforceCompanyAccess as jest.Mock).mockResolvedValue({ userId: 'user-1' });
  });

  it('returns campaigns for correct company', async () => {
    const mappingRows = [
      { company_id: 'company-a', campaign_id: 'c1' },
      { company_id: 'company-a', campaign_id: 'c2' },
      { company_id: 'company-b', campaign_id: 'c3' },
    ];
    const campaignRows = [
      { id: 'c1', name: 'Campaign One', weekly_themes: [] },
      { id: 'c2', name: 'Campaign Two', weekly_themes: [] },
      { id: 'c3', name: 'Campaign Three', weekly_themes: [] },
    ];
    (supabase.from as jest.Mock).mockImplementation((table: string) =>
      buildQuery(table, { filters: {}, rows: mappingRows, campaignRows })
    );
    const handler = (await import('../../../pages/api/campaigns/list')).default;

    const req = { method: 'GET', query: { companyId: 'company-a' } } as unknown as NextApiRequest;
    const res = createMockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body?.campaigns).toHaveLength(2);
    expect(res.body?.campaigns.map((c: any) => c.id)).toEqual(['c1', 'c2']);
  });

  it('does not reference campaigns.company_id', async () => {
    const mappingRows = [{ company_id: 'company-a', campaign_id: 'c1' }];
    const campaignRows = [{ id: 'c1', name: 'Campaign One', weekly_themes: [] }];
    (supabase.from as jest.Mock).mockImplementation((table: string) =>
      buildQuery(table, { filters: {}, rows: mappingRows, campaignRows })
    );
    const handler = (await import('../../../pages/api/campaigns/list')).default;

    const req = { method: 'GET', query: { companyId: 'company-a' } } as unknown as NextApiRequest;
    const res = createMockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
  });

  it('returns empty list for other company', async () => {
    const mappingRows = [{ company_id: 'company-a', campaign_id: 'c1' }];
    const campaignRows = [{ id: 'c1', name: 'Campaign One', weekly_themes: [] }];
    (supabase.from as jest.Mock).mockImplementation((table: string) =>
      buildQuery(table, { filters: {}, rows: mappingRows, campaignRows })
    );
    const handler = (await import('../../../pages/api/campaigns/list')).default;

    const req = { method: 'GET', query: { companyId: 'company-b' } } as unknown as NextApiRequest;
    const res = createMockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body?.campaigns).toHaveLength(0);
  });

  it('dashboard only shows company campaigns', async () => {
    const mappingRows = [
      { company_id: 'company-a', campaign_id: 'c1' },
      { company_id: 'company-a', campaign_id: 'c2' },
      { company_id: 'company-b', campaign_id: 'c3' },
    ];
    const campaignRows = [
      { id: 'c1', name: 'Campaign One', weekly_themes: [] },
      { id: 'c2', name: 'Campaign Two', weekly_themes: [] },
      { id: 'c3', name: 'Campaign Three', weekly_themes: [] },
    ];
    const indexSupabase = {
      from: jest.fn((table: string) =>
        buildQuery(table, { filters: {}, rows: mappingRows, campaignRows })
      ),
    };
    (createClient as jest.Mock).mockReturnValue(indexSupabase);
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://example.com';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';

    await new Promise<void>((resolve, reject) => {
      jest.isolateModules(async () => {
        const handler = (await import('../../../pages/api/campaigns/index')).default;
        const req = { method: 'GET', query: { companyId: 'company-a' } } as unknown as NextApiRequest;
        const res = createMockRes();
        await handler(req, res);
        try {
          expect(res.statusCode).toBe(200);
          expect(res.body?.campaigns.map((c: any) => c.id)).toEqual(['c1', 'c2']);
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
  });

  it('returns 403 when campaign not linked to company', async () => {
    const mappingRows = [{ company_id: 'company-a', campaign_id: 'c1' }];
    const campaignRows = [{ id: 'c1', name: 'Campaign One', weekly_themes: [] }];
    const indexSupabase = {
      from: jest.fn((table: string) =>
        buildQuery(table, { filters: {}, rows: mappingRows, campaignRows })
      ),
    };
    (createClient as jest.Mock).mockReturnValue(indexSupabase);
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://example.com';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';

    await new Promise<void>((resolve, reject) => {
      jest.isolateModules(async () => {
        const handler = (await import('../../../pages/api/campaigns/index')).default;
        const req = {
          method: 'GET',
          query: { companyId: 'company-b', type: 'campaign', campaignId: 'c1' },
        } as unknown as NextApiRequest;
        const res = createMockRes();
        await handler(req, res);
        try {
          expect(res.statusCode).toBe(403);
          expect(res.body?.code).toBe('CAMPAIGN_NOT_IN_COMPANY');
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
  });

  it('returns 403 for mismatched campaignId in progress', async () => {
    const progressSupabase = {
      from: jest.fn((table: string) =>
        buildQuery(table, { filters: {}, rows: [], campaignRows: [] })
      ),
    };
    (createClient as jest.Mock).mockReturnValue(progressSupabase);

    await new Promise<void>((resolve, reject) => {
      jest.isolateModules(async () => {
        const handler = (await import('../../../pages/api/campaigns/[id]/progress')).default;
        const req = {
          method: 'GET',
          query: { id: 'c1', companyId: 'company-b' },
        } as unknown as NextApiRequest;
        const res = createMockRes();
        await handler(req, res);
        try {
          expect(res.statusCode).toBe(403);
          expect(res.body?.code).toBe('CAMPAIGN_NOT_IN_COMPANY');
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
  });
});
