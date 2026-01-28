import { fetchTrendsFromApis } from '../../services/externalApiService';
import * as externalApiService from '../../services/externalApiService';
import { generateRecommendations } from '../../services/recommendationEngine';
import { supabase } from '../../db/supabaseClient';
import { getHistoricalAccuracyScore } from '../../services/performanceFeedbackService';

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));
jest.mock('../../services/performanceFeedbackService', () => ({
  getHistoricalAccuracyScore: jest.fn().mockResolvedValue(0.5),
}));

const sources = [
  {
    id: 'api-1',
    name: 'API One',
    base_url: 'https://api-one.example.com',
    purpose: 'trends',
    category: null,
    is_active: true,
    auth_type: 'none',
    api_key_name: null,
    created_at: '2026-01-01T00:00:00Z',
  },
];

const healthStore = new Map<string, any>();

const buildQuery = (table: string) => {
  const state: { filters: Record<string, any> } = { filters: {} };
  const query: any = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn((field: string, value: any) => {
      state.filters[field] = value;
      return query;
    }),
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

describe('External API health', () => {
  beforeEach(() => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => buildQuery(table));
    healthStore.clear();
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00Z'));
    jest.spyOn(externalApiService, 'getPlatformStrategies').mockResolvedValue([]);
    (getHistoricalAccuracyScore as jest.Mock).mockResolvedValue(0.5);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.resetAllMocks();
  });

  it('records success and failure with freshness and reliability', async () => {
    const fetchMock = jest.fn();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [{ topic: 'Trend A', velocity: 1, sentiment: 0.5, volume: 1000 }],
      }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    });
    (global as any).fetch = fetchMock;

    await fetchTrendsFromApis();
    const first = healthStore.get('api-1');
    expect(first.success_count).toBe(1);
    expect(first.failure_count).toBe(0);
    expect(first.freshness_score).toBe(1);
    expect(first.reliability_score).toBe(1);

    jest.setSystemTime(new Date('2026-01-03T00:00:00Z'));
    await fetchTrendsFromApis();
    const second = healthStore.get('api-1');
    expect(second.success_count).toBe(1);
    expect(second.failure_count).toBe(1);
    expect(second.reliability_score).toBeCloseTo(0.5, 3);
    expect(second.freshness_score).toBeLessThan(1);
  });

  it('applies health scores to recommendation trend score', async () => {
    (global as any).fetch = jest.fn();
    const recommendations = await generateRecommendations({
      companyProfile: null,
      trendSignals: [
        {
          topic: 'Trend A',
          source: 'API One',
          volume: 1000,
          velocity: 1,
          sentiment: 0.5,
          trend_source_health: {
            freshness_score: 0.5,
            reliability_score: 0.5,
          },
        },
      ],
    });

    expect(recommendations[0].scores.trend_score).toBeCloseTo(1, 2);
    expect(recommendations[0].scores.health_multiplier).toBeCloseTo(0.25, 2);
    expect(recommendations[0].scores.final_score).toBeCloseTo(0.26, 2);
  });
});
