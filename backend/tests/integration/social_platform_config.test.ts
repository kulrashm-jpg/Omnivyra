import { NextApiRequest, NextApiResponse } from 'next';
import externalApisHandler from '../../../pages/api/external-apis/index';
import { publishScheduledPost } from '../../services/socialPlatformPublisher';
import { supabase } from '../../db/supabaseClient';
import { createApiRequestMock } from '../utils';

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));
jest.mock('../../services/externalApiService', () => ({
  ...jest.requireActual('../../services/externalApiService'),
  getExternalApiRuntimeSnapshot: jest.fn().mockResolvedValue({
    health_snapshot: [],
    cache_stats: { hits: 0, misses: 0, per_api_hits: {}, per_api_misses: {} },
    rate_limited_sources: [],
    signal_confidence_summary: null,
  }),
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

const { getSupabaseUserFromRequest } = jest.requireMock('../../services/supabaseAuthService');
const { getUserRole, hasPermission, isPlatformSuperAdmin, isSuperAdmin } = jest.requireMock(
  '../../services/rbacService'
);

const sourcesStore = new Map<string, any>();
const healthStore = new Map<string, any>();

const buildQuery = (table: string) => {
  const state: {
    filters: Record<string, any>;
    orFilter?: string;
    limit?: number;
    payload?: any;
    op?: 'insert' | 'update' | 'delete' | 'upsert';
  } = { filters: {} };
  const query: any = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn((field: string, value: any) => {
      state.filters[field] = value;
      return query;
    }),
    or: jest.fn((filter: string) => {
      state.orFilter = filter;
      return query;
    }),
    in: jest.fn((field: string, values: any[]) => {
      state.filters[field] = values;
      return query;
    }),
    gte: jest.fn((field: string, value: any) => {
      state.filters[field] = value;
      return query;
    }),
    is: jest.fn((field: string, value: any) => {
      state.filters[field] = value;
      return query;
    }),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn((value: number) => {
      state.limit = value;
      return query;
    }),
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
    if (state.orFilter) {
      if (state.orFilter.includes('company_id')) {
        const companyMatch = state.orFilter.match(/company_id\.eq\.([^,]+)/);
        const companyId = companyMatch?.[1] || null;
        const rows = Array.from(sourcesStore.values()).filter(
          (row) => row.company_id === companyId || row.company_id == null
        );
        return { data: rows, error: null };
      }
      const platform = state.orFilter.split('.')[2]?.replace('%', '') || '';
      const match = Array.from(sourcesStore.values()).find((row) => {
        const category = (row.category || '').toLowerCase();
        const name = (row.name || '').toLowerCase();
        return category === platform.toLowerCase() || name.includes(platform.toLowerCase());
      });
      return { data: match ? [match] : [], error: null };
    }
    return { data: Array.from(sourcesStore.values()), error: null };
  }

  if (table === 'external_api_health') {
    if (state.op === 'upsert') {
      const payload = state.payload;
      healthStore.set(payload.api_source_id, payload);
      return { data: payload, error: null };
    }
    if (Array.isArray(state.filters.api_source_id)) {
      const rows = state.filters.api_source_id
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

describe('Social platform config', () => {
  beforeEach(() => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => buildQuery(table));
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: true, error: null });
    (getSupabaseUserFromRequest as jest.Mock).mockResolvedValue({ user: { id: 'user-1' }, error: null });
    (isPlatformSuperAdmin as jest.Mock).mockResolvedValue(false);
    (isSuperAdmin as jest.Mock).mockResolvedValue(false);
    (getUserRole as jest.Mock).mockResolvedValue({ role: 'COMPANY_ADMIN', error: null });
    (hasPermission as jest.Mock).mockResolvedValue(true);
    sourcesStore.clear();
    healthStore.clear();
  });

  it('creates and fetches platform config', async () => {
    const req = createApiRequestMock({
      method: 'POST',
      companyId: 'company-1',
      body: {
        companyId: 'company-1',
        name: 'Facebook',
        base_url: 'page-123',
        purpose: 'posting',
        platform_type: 'social',
        supported_content_types: ['text'],
        promotion_modes: ['organic'],
        required_metadata: { hashtags: true },
        posting_constraints: { max_length: 2200 },
        is_active: true,
        requires_admin: true,
      },
      headers: { authorization: 'Bearer test-token' },
    });
    const res = createMockRes();

    await externalApisHandler(req, res);
    expect(res.statusCode).toBe(201);

    const listReq = createApiRequestMock({
      method: 'GET',
      companyId: 'company-1',
      headers: { authorization: 'Bearer test-token' },
    });
    const listRes = createMockRes();
    await externalApisHandler(listReq, listRes);
    expect(listRes.statusCode).toBe(200);
    expect(listRes.body?.apis?.length).toBe(1);
  });

  it('publisher rejects unsupported content type', async () => {
    sourcesStore.set('api-1', {
      id: 'api-1',
      name: 'Video Platform',
      base_url: 'video',
      purpose: 'posting',
      category: 'youtube',
      is_active: true,
      auth_type: 'none',
      api_key_name: null,
      platform_type: 'video',
      supported_content_types: ['video'],
      promotion_modes: ['organic'],
      required_metadata: {},
      posting_constraints: {},
      requires_admin: false,
      created_at: '2026-01-01T00:00:00Z',
    });
    healthStore.set('api-1', {
      api_source_id: 'api-1',
      reliability_score: 0.9,
      freshness_score: 1,
    });

    const result = await publishScheduledPost(
      {
        post_id: 'post-1',
        platform: 'youtube',
        content: 'Text only',
        content_type: 'text',
        scheduled_time: '2026-01-01T00:00:00Z',
        campaign_id: 'camp-1',
      },
      { dry_run: false, admin_override: true }
    );
    expect(result.status).toBe('SKIPPED');
  });

  it('skips inactive platform', async () => {
    sourcesStore.set('api-2', {
      id: 'api-2',
      name: 'LinkedIn',
      base_url: 'urn:li:person:abc',
      purpose: 'posting',
      category: 'linkedin',
      is_active: false,
      auth_type: 'none',
      api_key_name: null,
      platform_type: 'social',
      supported_content_types: ['text'],
      promotion_modes: ['organic'],
      required_metadata: {},
      posting_constraints: {},
      requires_admin: false,
      created_at: '2026-01-01T00:00:00Z',
    });

    const result = await publishScheduledPost(
      {
        post_id: 'post-2',
        platform: 'linkedin',
        content: 'Hello',
        content_type: 'text',
        scheduled_time: '2026-01-01T00:00:00Z',
        campaign_id: 'camp-1',
      },
      { dry_run: false, admin_override: true }
    );
    expect(result.status).toBe('SKIPPED');
  });
});
