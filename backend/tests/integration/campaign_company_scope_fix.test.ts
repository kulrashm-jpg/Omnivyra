import { NextApiRequest, NextApiResponse } from 'next';
import { createApiRequestMock, createMockRes } from '../utils';

jest.mock('../../../utils/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));

jest.mock('../../../backend/db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}));

jest.mock('../../../backend/services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: jest.fn().mockResolvedValue({ user: { id: 'user-1' }, error: null }),
}));

jest.mock('../../../backend/services/userContextService', () => ({
  resolveUserContext: jest.fn().mockResolvedValue({
    userId: 'user-1',
    companyIds: ['company-a', 'company-b'],
    defaultCompanyId: 'company-a',
    role: 'admin',
  }),
  enforceCompanyAccess: jest.fn().mockImplementation(async ({ res, companyId, campaignId }: any) => {
    if (companyId === 'company-b' && campaignId === 'c1') {
      res.status(403).json({ error: 'CAMPAIGN_NOT_IN_COMPANY', code: 'CAMPAIGN_NOT_IN_COMPANY' });
      return null;
    }
    return { userId: 'user-1' };
  }),
}));

jest.mock('../../../backend/services/rbacService', () => {
  const actual = jest.requireActual('../../../backend/services/rbacService');
  return {
    ...actual,
    enforceRole: jest.fn().mockResolvedValue({ userId: 'user-1', role: actual.Role.CONTENT_CREATOR }),
    isSuperAdmin: jest.fn().mockResolvedValue(false),
    isPlatformSuperAdmin: jest.fn().mockResolvedValue(false),
    getUserRole: jest.fn().mockResolvedValue({ role: actual.Role.CONTENT_CREATOR, error: null }),
    getUserCompanyRole: jest.fn().mockResolvedValue({ role: actual.Role.CONTENT_CREATOR, userId: 'user-1' }),
    hasPermission: jest.fn().mockResolvedValue(true),
  };
});

const { supabase } = jest.requireMock('../../../utils/supabaseClient');
const { createClient } = jest.requireMock('@supabase/supabase-js');

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
    maybeSingle: jest.fn(function () {
      state.maybeSingle = true;
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
  if (table === 'user_company_roles') {
    const companyId = state.filters.company_id;
    const rows = (state.roleRows || []).filter((r: any) => r.company_id === companyId);
    const data = state.maybeSingle ? (rows[0] || null) : rows;
    return { data, error: null };
  }
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
    jest.clearAllMocks();
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
      buildQuery(table, { filters: {}, rows: mappingRows, campaignRows, roleRows: [] })
    );
    const handler = (await import('../../../pages/api/campaigns/list')).default;

    const req = createApiRequestMock({ method: 'GET', companyId: 'company-a' });
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
      buildQuery(table, { filters: {}, rows: mappingRows, campaignRows, roleRows: [] })
    );
    const handler = (await import('../../../pages/api/campaigns/list')).default;

    const req = createApiRequestMock({ method: 'GET', companyId: 'company-a' });
    const res = createMockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
  });

  it('returns empty list for other company', async () => {
    const mappingRows = [{ company_id: 'company-a', campaign_id: 'c1' }];
    const campaignRows = [{ id: 'c1', name: 'Campaign One', weekly_themes: [] }];
    (supabase.from as jest.Mock).mockImplementation((table: string) =>
      buildQuery(table, { filters: {}, rows: mappingRows, campaignRows, roleRows: [] })
    );
    const handler = (await import('../../../pages/api/campaigns/list')).default;

    const req = createApiRequestMock({ method: 'GET', companyId: 'company-b' });
    const res = createMockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body?.campaigns).toHaveLength(0);
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
        const req = createApiRequestMock({ method: 'GET', id: 'c1', companyId: 'company-b' });
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

  it('returns 403 when campaign not linked to company', async () => {
    const { Role } = require('../../../backend/services/rbacService');
    const userContextService = require('../../../backend/services/userContextService');
    const rbacService = require('../../../backend/services/rbacService');

    const mappingRows = [{ company_id: 'company-b', campaign_id: 'c1' }];
    const campaignRows = [{ id: 'c1', name: 'Campaign One', weekly_themes: [] }];
    const roleRows = [{ company_id: 'company-a', role: 'COMPANY_ADMIN', status: 'active' }];
    const indexSupabase = {
      from: jest.fn((table: string) =>
        buildQuery(table, {
          filters: {},
          rows: [...mappingRows],
          campaignRows: [...campaignRows],
          roleRows: [...roleRows],
        })
      ),
    };
    (createClient as jest.Mock).mockReturnValue(indexSupabase);
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://example.com';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';

    await new Promise<void>((resolve, reject) => {
      jest.isolateModules(async () => {
        (userContextService.resolveUserContext as jest.Mock).mockResolvedValue({
          userId: 'user-1',
          companyIds: ['company-a'],
          defaultCompanyId: 'company-a',
          role: Role.CONTENT_CREATOR,
        });
        (rbacService.getUserCompanyRole as jest.Mock).mockResolvedValue({
          role: Role.CONTENT_CREATOR,
          userId: 'user-1',
        });

        const handler = (await import('../../../pages/api/campaigns/index')).default;
        const req = createApiRequestMock({
          method: 'GET',
          companyId: 'company-a',
          query: { type: 'campaign', campaignId: 'c1' },
        });
        const res = createMockRes();
        await handler(req, res);
        try {
          expect(res.statusCode).toBe(403);
          expect(res.body).toBeDefined();
          expect(res.body?.code).toBe('CAMPAIGN_NOT_IN_COMPANY');
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
  });

  it('dashboard only shows company campaigns', async () => {
    jest.resetModules();
    const { createClient: createClientAfterReset } = jest.requireMock('@supabase/supabase-js');
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
        buildQuery(table, {
          filters: {},
          rows: mappingRows,
          campaignRows,
          roleRows: [{ company_id: 'company-a', role: 'COMPANY_ADMIN', status: 'active' }],
        })
      ),
    };
    (createClientAfterReset as jest.Mock).mockReturnValue(indexSupabase);
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://example.com';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';

    await new Promise<void>((resolve, reject) => {
      jest.isolateModules(async () => {
        (createClientAfterReset as jest.Mock).mockReturnValue(indexSupabase);
        const handler = (await import('../../../pages/api/campaigns/index')).default;
        const req = createApiRequestMock({ method: 'GET', companyId: 'company-a' });
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

});
