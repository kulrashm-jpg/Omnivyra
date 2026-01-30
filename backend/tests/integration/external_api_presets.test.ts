import { NextApiRequest, NextApiResponse } from 'next';
import { externalApiPresets } from '../../services/externalApiPresets';
import presetsHandler from '../../../pages/api/external-apis/presets';
import externalApisHandler from '../../../pages/api/external-apis/index';
import { buildExternalApiRequest } from '../../services/externalApiService';
import { supabase } from '../../db/supabaseClient';

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

const sourcesStore = new Map<string, any>();

const buildQuery = (table: string) => {
  const state: { filters: Record<string, any>; payload?: any; op?: 'insert' } = { filters: {} };
  const query: any = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn((field: string, value: any) => {
      state.filters[field] = value;
      return query;
    }),
    single: jest.fn().mockReturnThis(),
    insert: jest.fn((payload: any) => {
      state.op = 'insert';
      state.payload = payload;
      return query;
    }),
    then: (resolve: any, reject: any) => {
      if (table === 'external_api_sources' && state.op === 'insert') {
        const payload = { id: 'preset-1', ...state.payload };
        sourcesStore.set(payload.id, payload);
        return Promise.resolve({ data: payload, error: null }).then(resolve, reject);
      }
      return Promise.resolve({ data: [], error: null }).then(resolve, reject);
    },
  };
  return query;
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

describe('External API presets', () => {
  beforeEach(() => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => buildQuery(table));
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: true, error: null });
    sourcesStore.clear();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('returns 4 presets from GET /api/external-apis/presets', async () => {
    const req = { method: 'GET' } as NextApiRequest;
    const res = createMockRes();

    await presetsHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body?.presets?.length).toBe(4);
  });

  it('imports a preset via POST /api/external-apis', async () => {
    const preset = externalApiPresets[0];
    if (preset.api_key_env_name) {
      process.env[preset.api_key_env_name] = 'test-key';
    }
    const req = {
      method: 'POST',
      body: {
        name: preset.name,
        base_url: preset.base_url,
        purpose: 'trends',
        method: preset.method,
        auth_type: preset.auth_type,
        api_key_env_name: preset.api_key_env_name,
        headers: preset.headers,
        query_params: preset.query_params,
        is_preset: true,
      },
    } as NextApiRequest;
    const res = createMockRes();

    await externalApisHandler(req, res);

    expect(res.statusCode).toBe(201);
    expect(res.body?.api?.name).toBe(preset.name);
    expect(res.body?.api?.is_preset).toBe(true);
    if (preset.api_key_env_name) {
      delete process.env[preset.api_key_env_name];
    }
  });

  it('builds request from preset with runtime placeholders', () => {
    const preset = externalApiPresets[0];
    const envName = preset.api_key_env_name || '';
    process.env[envName] = 'test-key';

    const request = buildExternalApiRequest(
      {
        id: 'preset',
        name: preset.name,
        base_url: preset.base_url,
        purpose: 'trends',
        category: null,
        is_active: true,
        method: preset.method,
        auth_type: preset.auth_type,
        api_key_env_name: preset.api_key_env_name || null,
        headers: preset.headers,
        query_params: preset.query_params,
        created_at: new Date().toISOString(),
      },
      { queryParams: { geo: 'US', category: 'ai' } }
    );

    expect(request.details.url).toContain('regionCode=US');
    expect(request.details.url).toContain('q=ai');
    delete process.env[envName];
  });

  it('reports missing env vars safely', () => {
    const preset = externalApiPresets[1];
    const request = buildExternalApiRequest(
      {
        id: 'preset',
        name: preset.name,
        base_url: preset.base_url,
        purpose: 'trends',
        category: null,
        is_active: true,
        method: preset.method,
        auth_type: preset.auth_type,
        api_key_env_name: preset.api_key_env_name || null,
        headers: preset.headers,
        query_params: preset.query_params,
        created_at: new Date().toISOString(),
      },
      { queryParams: { geo: 'US', category: 'ai' } }
    );

    expect(request.missingEnv).toContain('NEWS_API_KEY');
  });
});
