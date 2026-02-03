import { NextApiRequest, NextApiResponse } from 'next';
import externalApisHandler from '../../../pages/api/external-apis/index';
import * as externalApiService from '../../services/externalApiService';

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

jest.mock('../../services/userContextService', () => ({
  resolveUserContext: jest.fn(),
}));

const { supabase } = jest.requireMock('../../db/supabaseClient');
const { resolveUserContext } = jest.requireMock('../../services/userContextService');

const sourcesStore = new Map<string, any>();

const buildQuery = (table: string) => {
  const state: {
    filters: Record<string, any>;
    inFilter?: { field: string; values: any[] };
  } = { filters: {} };
  const query: any = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn((field: string, value: any) => {
      state.filters[field] = value;
      return query;
    }),
    gte: jest.fn(() => query),
    in: jest.fn((field: string, values: any[]) => {
      state.inFilter = { field, values };
      return query;
    }),
    order: jest.fn().mockReturnThis(),
    single: jest.fn().mockReturnThis(),
    then: (resolve: any, reject: any) => {
      const result = resolveQuery(table, state);
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  return query;
};

const resolveQuery = (table: string, state: any) => {
  if (table === 'external_api_sources') {
    const rows = Array.from(sourcesStore.values());
    const companyId = state.filters.company_id;
    const filtered = companyId ? rows.filter((row) => row.company_id === companyId) : rows;
    return { data: filtered, error: null };
  }
  if (table === 'external_api_user_access' || table === 'external_api_usage') {
    return { data: [], error: null };
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

describe('External API company scope', () => {
  beforeEach(() => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => buildQuery(table));
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: true, error: null });
    sourcesStore.clear();
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [{ topic: 'AI trends' }] }),
    });
  });

  it('returns APIs for selected company only', async () => {
    resolveUserContext.mockResolvedValue({
      defaultCompanyId: 'company-a',
      userId: 'user-1',
    });
    sourcesStore.set('a1', {
      id: 'a1',
      name: 'YouTube Trends',
      company_id: 'company-a',
      is_active: true,
      base_url: 'https://example.com',
      purpose: 'trends',
      auth_type: 'none',
      created_at: new Date().toISOString(),
    });
    sourcesStore.set('b1', {
      id: 'b1',
      name: 'NewsAPI',
      company_id: 'company-b',
      is_active: true,
      base_url: 'https://example.com',
      purpose: 'trends',
      auth_type: 'none',
      created_at: new Date().toISOString(),
    });

    const req = { method: 'GET' } as NextApiRequest;
    const res = createMockRes();
    await externalApisHandler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body?.apis).toHaveLength(1);
    expect(res.body?.apis[0].company_id).toBe('company-a');
  });

  it('returns 400 when companyId missing', async () => {
    resolveUserContext.mockResolvedValue({
      defaultCompanyId: null,
      userId: 'user-1',
    });
    const req = { method: 'GET' } as NextApiRequest;
    const res = createMockRes();
    await externalApisHandler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body?.error).toBe('companyId required');
  });

  it('fetchExternalApis uses company scope', async () => {
    sourcesStore.set('a1', {
      id: 'a1',
      name: 'YouTube Trends',
      company_id: 'company-a',
      is_active: true,
      base_url: 'https://example.com',
      purpose: 'trends',
      auth_type: 'none',
      created_at: new Date().toISOString(),
    });
    sourcesStore.set('b1', {
      id: 'b1',
      name: 'NewsAPI',
      company_id: 'company-b',
      is_active: true,
      base_url: 'https://example.com',
      purpose: 'trends',
      auth_type: 'none',
      created_at: new Date().toISOString(),
    });

    const summary = await externalApiService.fetchExternalApis('company-a', 'US', 'tech', {
      recordHealth: false,
    });
    expect(summary.results.length).toBeGreaterThan(0);
    summary.results.forEach((result) => {
      expect(result.source.company_id).toBe('company-a');
    });
  });

  it('recommendation engine falls back with no_external_signals', async () => {
    await new Promise<void>((resolve, reject) => {
      jest.isolateModules(() => {
        jest.doMock('../../services/externalApiService', () => ({
          fetchExternalApis: jest.fn().mockResolvedValue({
            results: [],
            missing_env_placeholders: [],
            cache_stats: { hits: 0, misses: 0, per_api_hits: {}, per_api_misses: {} },
            rate_limited_sources: [],
            signal_confidence_summary: null,
          }),
          getEnabledApis: jest.fn().mockResolvedValue([]),
          getExternalApiRuntimeSnapshot: jest.fn().mockResolvedValue({
            health_snapshot: [],
            cache_stats: { hits: 0, misses: 0, per_api_hits: {}, per_api_misses: {} },
            rate_limited_sources: [],
            signal_confidence_summary: null,
          }),
          getPlatformStrategies: jest.fn().mockResolvedValue([]),
          recordSignalConfidenceSummary: jest.fn(),
        }));
        jest.doMock('../../services/companyProfileService', () => ({
          getProfile: jest.fn().mockResolvedValue({ geography: 'US', industry_list: [], goals_list: [], content_themes_list: [] }),
        }));
        jest.doMock('../../services/campaignMemoryService', () => ({
          getCampaignMemory: jest.fn().mockResolvedValue({}),
        }));
        jest.doMock('../../services/campaignRecommendationService', () => ({
          generateCampaignStrategy: jest.fn().mockResolvedValue({ weekly_plan: [], daily_plan: [] }),
        }));
        jest.doMock('../../services/omnivyraClientV1', () => ({
          isOmniVyraEnabled: jest.fn().mockReturnValue(false),
          getOmniVyraHealthReport: jest.fn().mockReturnValue({ status: 'disabled' }),
        }));
        jest.doMock('../../services/omnivyraHealthService', () => ({
          getLastFallbackReason: jest.fn().mockReturnValue(null),
          getLastMeta: jest.fn().mockReturnValue(null),
          setLastFallbackReason: jest.fn(),
        }));
        jest.doMock('../../services/omnivyraFeedbackService', () => ({
          sendLearningSnapshot: jest.fn().mockResolvedValue({ status: 'skipped' }),
        }));

        const { generateRecommendations } = require('../../services/recommendationEngineService');
        generateRecommendations({
          companyId: 'company-a',
          campaignId: 'campaign-1',
        })
          .then((value: any) => {
            expect(value.omnivyra_metadata?.placeholders).toContain('no_external_signals');
            expect(value.confidence_score).toBe(30);
            resolve();
          })
          .catch(reject);
      });
    });
  });
});
