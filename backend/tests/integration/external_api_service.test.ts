import { NextApiRequest, NextApiResponse } from 'next';
import { fetchTrendsFromApis } from '../../services/externalApiService';
import { createApiRequestMock } from '../utils';
import { supabase } from '../../db/supabaseClient';
import externalApisHandler from '../../../pages/api/external-apis/index';
import validateHandler from '../../../pages/api/external-apis/[id]/validate';
import trendsFetchHandler from '../../../pages/api/trends/fetch';

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));
jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: jest.fn(),
}));
jest.mock('../../services/rbacService', () => ({
  ...jest.requireActual('../../services/rbacService'),
  getUserRole: jest.fn(),
  hasPermission: jest.fn(),
  isPlatformSuperAdmin: jest.fn(),
  isSuperAdmin: jest.fn(),
}));
jest.mock('../../services/userContextService', () => ({
  resolveUserContext: jest.fn(),
}));

const { getSupabaseUserFromRequest } = jest.requireMock('../../services/supabaseAuthService');
const { getUserRole, hasPermission, isPlatformSuperAdmin, isSuperAdmin } = jest.requireMock(
  '../../services/rbacService'
);
const { resolveUserContext } = jest.requireMock('../../services/userContextService');

const sourcesStore = new Map<string, any>();
const healthStore = new Map<string, any>();

const buildQuery = (table: string) => {
  const state: {
    filters: Record<string, any>;
    inFilter?: { field: string; values: any[] };
    payload?: any;
    op?: 'insert' | 'update' | 'delete' | 'upsert';
  } = { filters: {} };
  const query: any = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn((field: string, value: any) => {
      state.filters[field] = value;
      return query;
    }),
    in: jest.fn((field: string, values: any[]) => {
      state.inFilter = { field, values };
      return query;
    }),
    or: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    single: jest.fn().mockReturnThis(),
    insert: jest.fn((payload: any) => {
      state.op = 'insert';
      state.payload = payload;
      return query;
    }),
    update: jest.fn((payload: any) => {
      state.op = 'update';
      state.payload = payload;
      return query;
    }),
    delete: jest.fn(() => {
      state.op = 'delete';
      return query;
    }),
    upsert: jest.fn((payload: any) => {
      state.op = 'upsert';
      state.payload = payload;
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
  if (table === 'external_api_sources') {
    if (state.op === 'insert') {
      const payload = { id: 'api-new', ...state.payload };
      sourcesStore.set(payload.id, payload);
      return { data: payload, error: null };
    }
    if (state.op === 'update') {
      const id = state.filters.id;
      const existing = sourcesStore.get(id);
      if (!existing) return { data: null, error: { code: 'PGRST116' } };
      const updated = { ...existing, ...state.payload };
      sourcesStore.set(id, updated);
      return { data: updated, error: null };
    }
    if (state.op === 'delete') {
      sourcesStore.delete(state.filters.id);
      return { data: null, error: null };
    }
    if (state.filters.id) {
      const row = sourcesStore.get(state.filters.id);
      if (!row) return { data: null, error: { code: 'PGRST116' } };
      return { data: row, error: null };
    }
    return { data: Array.from(sourcesStore.values()), error: null };
  }

  if (table === 'external_api_health') {
    if (state.op === 'upsert') {
      const payload = state.payload;
      healthStore.set(payload.api_source_id, payload);
      return { data: payload, error: null };
    }
    if (state.inFilter?.field === 'api_source_id') {
      const rows = state.inFilter.values
        .map((id: string) => healthStore.get(id))
        .filter(Boolean);
      return { data: rows, error: null };
    }
    const id = state.filters.api_source_id;
    const row = id ? healthStore.get(id) : null;
    if (!row) return { data: null, error: { code: 'PGRST116' } };
    return { data: row, error: null };
  }

  return { data: [], error: null };
};

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

describe('External API service', () => {
  beforeEach(() => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => buildQuery(table));
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: true, error: null });
    (getSupabaseUserFromRequest as jest.Mock).mockResolvedValue({ user: { id: 'user-1' }, error: null });
    (resolveUserContext as jest.Mock).mockResolvedValue({
      userId: 'user-1',
      defaultCompanyId: 'company-1',
      companyIds: ['company-1'],
    });
    (isPlatformSuperAdmin as jest.Mock).mockResolvedValue(false);
    (isSuperAdmin as jest.Mock).mockResolvedValue(false);
    (getUserRole as jest.Mock).mockResolvedValue({ role: 'COMPANY_ADMIN', error: null });
    (hasPermission as jest.Mock).mockResolvedValue(true);
    sourcesStore.clear();
    healthStore.clear();
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          {
            topic: 'AI marketing',
            geo: 'US',
            velocity: 0.8,
            sentiment: 0.2,
            volume: 1200,
          },
        ],
      }),
    });
  });

  it('fetches and normalizes trend signals', async () => {
    sourcesStore.set('api-1', {
      id: 'api-1',
      name: 'YouTube Trends',
      base_url: 'https://example.com/trends',
      purpose: 'trends',
      category: null,
      is_active: true,
      auth_type: 'none',
      api_key_name: null,
      created_at: new Date().toISOString(),
    });

    const trends = await fetchTrendsFromApis('US', 'marketing');
    expect(trends).toHaveLength(1);
    expect(trends[0]).toEqual({
      topic: 'AI marketing',
      source: 'YouTube Trends',
      geo: 'US',
      velocity: 0.8,
      sentiment: 0.2,
      volume: 1200,
      signal_confidence: expect.any(Number),
      trend_source_health: {
        freshness_score: 1,
        reliability_score: 1,
      },
    });
  });

  it('blocks non-admin from creating API sources', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: false, error: null });
    (hasPermission as jest.Mock).mockReturnValue(false);
    const req = createApiRequestMock({
      method: 'POST',
      companyId: 'company-1',
      body: { name: 'Test', base_url: 'https://api.test', purpose: 'trends', companyId: 'company-1' },
    });
    const res = createMockRes();

    await externalApisHandler(req, res);
    expect(res.statusCode).toBe(403);
  });

  it('creates API source when auth is required (handler does not validate env)', async () => {
    const req = createApiRequestMock({
      method: 'POST',
      companyId: 'company-1',
      body: {
        name: 'Secure API',
        base_url: 'https://secure.test',
        purpose: 'trends',
        auth_type: 'query',
        api_key_name: 'MISSING_KEY',
        companyId: 'company-1',
      },
    });
    const res = createMockRes();

    await externalApisHandler(req, res);
    expect(res.statusCode).toBe(201);
    expect(res.body?.api?.name).toBe('Secure API');
  });

  it('validate endpoint updates external_api_health', async () => {
    (isSuperAdmin as jest.Mock).mockResolvedValue(true);
    (resolveUserContext as jest.Mock).mockResolvedValue({
      userId: 'user-1',
      defaultCompanyId: 'company-1',
      companyIds: ['company-1'],
    });
    sourcesStore.set('api-1', {
      id: 'api-1',
      name: 'Validate API',
      base_url: 'https://validate.test',
      purpose: 'trends',
      category: null,
      is_active: true,
      auth_type: 'none',
      api_key_name: null,
      created_at: new Date().toISOString(),
    });
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });

    const req = createApiRequestMock({
      method: 'GET',
      companyId: 'company-1',
      query: { id: 'api-1' },
    });
    (req as any).cookies = { super_admin_session: '1' };
    const res = createMockRes();

    await validateHandler(req, res);
    const health = healthStore.get('api-1');
    expect(res.statusCode).toBe(200);
    expect(health?.success_count).toBe(1);
  });

  it('skips unreliable APIs when fetching trends', async () => {
    (resolveUserContext as jest.Mock).mockResolvedValue({
      userId: 'user-1',
      defaultCompanyId: 'company-1',
      companyIds: ['company-1'],
    });
    sourcesStore.set('api-1', {
      id: 'api-1',
      name: 'Unreliable',
      base_url: 'https://unreliable.test',
      purpose: 'trends',
      category: null,
      is_active: true,
      auth_type: 'none',
      api_key_name: null,
      created_at: new Date().toISOString(),
    });
    sourcesStore.set('api-2', {
      id: 'api-2',
      name: 'Reliable',
      base_url: 'https://reliable.test',
      purpose: 'trends',
      category: null,
      is_active: true,
      auth_type: 'none',
      api_key_name: null,
      created_at: new Date().toISOString(),
    });
    healthStore.set('api-1', { api_source_id: 'api-1', reliability_score: 0.2, freshness_score: 1 });
    healthStore.set('api-2', { api_source_id: 'api-2', reliability_score: 0.8, freshness_score: 1 });

    const req = createApiRequestMock({
      method: 'GET',
      companyId: 'company-1',
    });
    const res = createMockRes();

    await trendsFetchHandler(req, res);
    expect((global as any).fetch).toHaveBeenCalledTimes(1);
  });
});
