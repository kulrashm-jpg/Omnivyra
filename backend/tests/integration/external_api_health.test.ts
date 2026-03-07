import {
  fetchTrendsFromApis,
  getExternalApiRuntimeSnapshot,
  resetExternalApiRuntime,
} from '../../services/externalApiService';
import { resetCacheStats, getCacheStats } from '../../services/redisExternalApiCache';
import { supabase } from '../../db/supabaseClient';

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));

const sources = [
  {
    id: 'api-1',
    name: 'YouTube Trends',
    base_url: 'https://api-one.example.com',
    purpose: 'trends',
    category: null,
    is_active: true,
    auth_type: 'none',
    api_key_name: null,
    retry_count: 2,
    timeout_ms: 8000,
    rate_limit_per_min: 60,
    created_at: '2026-01-01T00:00:00Z',
  },
];

const healthStore = new Map<string, any>();

const buildQuery = (table: string) => {
  const state: { filters: Record<string, any>; inFilter?: { field: string; values: any[] } } = {
    filters: {},
  };
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
    single: jest.fn().mockReturnThis(),
    upsert: jest.fn(async (payload: any) => {
      if (table === 'external_api_health') {
        healthStore.set(payload.api_source_id, payload);
      }
      return { error: null };
    }),
    then: (resolve: any, reject: any) => {
      if (table === 'external_api_sources') {
        return Promise.resolve({ data: sources, error: null }).then(resolve, reject);
      }
      if (table === 'external_api_health') {
        if (state.inFilter?.field === 'api_source_id') {
          const rows = state.inFilter.values
            .map((id: string) => healthStore.get(id))
            .filter(Boolean);
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        }
        const id = state.filters['api_source_id'];
        const data = healthStore.get(id);
        if (!data) {
          return Promise.resolve({ data: null, error: { code: 'PGRST116' } }).then(resolve, reject);
        }
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      }
      return Promise.resolve({ data: [], error: null }).then(resolve, reject);
    },
  };
  return query;
};

describe('External API health + cache + rate limit', () => {
  beforeEach(async () => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => buildQuery(table));
    healthStore.clear();
    resetCacheStats();
    await resetExternalApiRuntime();
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('records cache hit and miss', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [{ topic: 'Trend A', velocity: 1, sentiment: 0.5, volume: 1000 }],
      }),
    });
    (global as any).fetch = fetchMock;

    await fetchTrendsFromApis('company-1', 'US', 'marketing');
    await fetchTrendsFromApis('company-1', 'US', 'marketing');

    const stats = getCacheStats();
    expect(stats.misses).toBeGreaterThan(0);
    expect(stats.hits).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries on 5xx responses', async () => {
    jest.useRealTimers();
    const fetchMock = jest.fn();
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items: [{ topic: 'Trend A' }] }),
    });
    (global as any).fetch = fetchMock;

    await fetchTrendsFromApis('company-1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  it('blocks rate limited sources', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [{ topic: 'Trend A' }] }),
    });
    (global as any).fetch = fetchMock;

    sources[0].rate_limit_per_min = 1;
    await fetchTrendsFromApis('company-1');
    await fetchTrendsFromApis('company-1');
    sources[0].rate_limit_per_min = 60;

    const snapshot = await getExternalApiRuntimeSnapshot(['api-1']);
    expect(snapshot.rate_limited_sources.length).toBeGreaterThan(0);
  });

  it('updates health score on success', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [{ topic: 'Trend A' }] }),
    });
    (global as any).fetch = fetchMock;

    await fetchTrendsFromApis('company-1');
    const record = healthStore.get('api-1');
    expect(record).toBeDefined();
    expect(record.success_count).toBe(1);
    expect(record.failure_count).toBe(0);
  });

  it('computes signal confidence', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [{ topic: 'Trend A', velocity: 1, sentiment: 0.5, volume: 1000 }],
      }),
    });
    (global as any).fetch = fetchMock;

    const trends = await fetchTrendsFromApis('company-1');
    expect(trends).toHaveLength(1);
    expect(trends[0].signal_confidence).toBeDefined();
    expect(trends[0].signal_confidence).toBeGreaterThanOrEqual(0);
  });
});
