/**
 * Tests for creatorObservabilityService:
 *   - aggregates counts + latencies from a synthetic event stream
 *   - computes rates correctly
 *   - detects anomalies vs baseline window
 *   - classifies workflow status (healthy / degraded / incident)
 */

type SyntheticEvent = { event_type: string; latency_ms?: number | null; severity?: string | null; created_at: string };

let CURRENT_WINDOW_ROWS: SyntheticEvent[] = [];
let BASELINE_ROWS: SyntheticEvent[] = [];
let queryCount = 0;

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: jest.fn(() => {
      let _gte = '';
      const api: any = {
        select: jest.fn(() => api),
        gte: jest.fn((_k: string, v: string) => { _gte = v; return api; }),
        eq: jest.fn(() => api),
        order: jest.fn(() => api),
        limit: jest.fn(() => {
          queryCount++;
          // First query = current window; subsequent = baseline.
          const rows = queryCount === 1 ? CURRENT_WINDOW_ROWS : BASELINE_ROWS;
          return Promise.resolve({ data: rows, error: null });
        }),
      };
      return api;
    }),
  },
}));

jest.mock('../../services/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

function makeEvent(event_type: string, mins_ago: number, latency_ms?: number): SyntheticEvent {
  return {
    event_type,
    latency_ms: latency_ms ?? null,
    severity: 'info',
    created_at: new Date(Date.now() - mins_ago * 60 * 1000).toISOString(),
  };
}

describe('creatorObservabilityService', () => {
  beforeEach(() => {
    CURRENT_WINDOW_ROWS = [];
    BASELINE_ROWS = [];
    queryCount = 0;
    jest.clearAllMocks();
  });

  test('aggregateCreatorMetrics computes counts + rates', async () => {
    CURRENT_WINDOW_ROWS = [
      makeEvent('upload_started', 5),
      makeEvent('upload_started', 10),
      makeEvent('upload_completed', 6, 200),
      makeEvent('upload_completed', 11, 400),
      makeEvent('upload_failed', 8, 100),
    ];
    BASELINE_ROWS = CURRENT_WINDOW_ROWS;
    const o = await import('../../services/creatorObservabilityService');
    const snap = await o.aggregateCreatorMetrics({ window: '1h' });
    expect(snap.total_events).toBe(5);
    expect(snap.counts_by_event.upload_started).toBe(2);
    expect(snap.counts_by_event.upload_completed).toBe(2);
    expect(snap.rates.upload_success).toBeCloseTo(1, 1); // 2 completed / 2 started
    expect(snap.rates.upload_failure).toBeGreaterThan(0);
    expect(snap.latencies_ms.upload_completed.samples).toBe(2);
    expect(snap.latencies_ms.upload_completed.p50).toBeGreaterThan(0);
    expect(snap.health_score).toBeGreaterThan(0);
    expect(snap.health_score).toBeLessThanOrEqual(100);
  });

  test('detects upload_failure_spike anomaly when failures spike vs baseline', async () => {
    CURRENT_WINDOW_ROWS = Array.from({ length: 30 }, () => makeEvent('upload_failed', 5, 150));
    BASELINE_ROWS = Array.from({ length: 5 }, () => makeEvent('upload_failed', 2 * 24 * 60, 150));
    const o = await import('../../services/creatorObservabilityService');
    const snap = await o.aggregateCreatorMetrics({ window: '1h' });
    const anomaly = snap.anomalies.find((a) => a.kind === 'upload_failure_spike');
    expect(anomaly).toBeTruthy();
    expect(snap.health_score).toBeLessThan(80);
  });

  test('classifyWorkflowStatus reflects anomaly severity', async () => {
    CURRENT_WINDOW_ROWS = Array.from({ length: 50 }, () => makeEvent('publish_validation_failed', 5));
    BASELINE_ROWS = [];
    const o = await import('../../services/creatorObservabilityService');
    const snap = await o.aggregateCreatorMetrics({ window: '1h' });
    expect(snap.anomalies.find((a) => a.kind === 'publish_failure_spike')).toBeTruthy();
    const cls = o.classifyWorkflowStatus(snap);
    expect(cls).toBe('incident');
  });

  test('healthy when no events and no anomalies', async () => {
    CURRENT_WINDOW_ROWS = [];
    BASELINE_ROWS = [];
    const o = await import('../../services/creatorObservabilityService');
    const snap = await o.aggregateCreatorMetrics({ window: '1h' });
    expect(snap.anomalies.length).toBe(0);
    expect(o.classifyWorkflowStatus(snap)).toBe('healthy');
  });
});
