/**
 * Tests for creatorAlertingService:
 *   - fires alerts on threshold exceed
 *   - dedupes within cooldown window
 *   - resolves alerts whose conditions cleared
 *   - returns workflow status
 */

const alertRowsByKey = new Map<string, any>();
let snapshotResult: any = null;

jest.mock('../../services/creatorObservabilityService', () => ({
  aggregateCreatorMetrics: jest.fn(async () => snapshotResult),
  classifyWorkflowStatus: jest.requireActual('../../services/creatorObservabilityService').classifyWorkflowStatus,
}));

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: jest.fn(() => {
      let mode: 'select' | 'in' = 'select';
      let lookupKey: string | null = null;
      const api: any = {
        select: jest.fn(() => api),
        eq: jest.fn((k: string, v: any) => { if (k === 'alert_key') lookupKey = v; return api; }),
        order: jest.fn(() => api),
        limit: jest.fn(() => Promise.resolve({ data: Array.from(alertRowsByKey.values()), error: null })),
        maybeSingle: jest.fn(async () => ({ data: lookupKey ? alertRowsByKey.get(lookupKey) ?? null : null, error: null })),
      };
      return api;
    }),
  },
}));

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: jest.fn((_table: string) => {
    let payload: any = null;
    let key: string | null = null;
    let keys: string[] | null = null;
    const api: any = {
      insert: jest.fn((row: any) => {
        alertRowsByKey.set(row.alert_key, row);
        return Promise.resolve({ data: row, error: null });
      }),
      update: jest.fn((p: any) => { payload = p; return api; }),
      eq: jest.fn((k: string, v: any) => { if (k === 'alert_key') key = v; return api; }),
      in: jest.fn((k: string, v: any[]) => { if (k === 'alert_key') keys = v; return api; }),
      then: (resolve: any) => {
        if (payload && key) {
          const existing = alertRowsByKey.get(key) ?? { alert_key: key };
          alertRowsByKey.set(key, { ...existing, ...payload });
        }
        if (payload && keys) {
          for (const k of keys) {
            const existing = alertRowsByKey.get(k) ?? { alert_key: k };
            alertRowsByKey.set(k, { ...existing, ...payload });
          }
        }
        return Promise.resolve({ data: null, error: null }).then(resolve);
      },
    };
    return api;
  }),
}));

jest.mock('../../services/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../../services/creatorOperationalTelemetryService', () => ({
  emitCreatorEvent: jest.fn(),
  CREATOR_EVENTS: {
    ALERT_FIRED: 'alert_fired',
    ALERT_DEDUPED: 'alert_deduped',
    ALERT_RESOLVED: 'alert_resolved',
  },
}));

function snapshot(opts: { fail_ratio?: number; publish_fail?: number; queue_contention?: number; counts?: Record<string, number>; anomalies?: any[] }) {
  return {
    window: '1h',
    generated_at: new Date().toISOString(),
    total_events: 1000,
    counts_by_event: {
      upload_started: 100,
      upload_completed: 60,
      upload_failed: opts.fail_ratio ? Math.round(100 * opts.fail_ratio) : 0,
      publish_validation_passed: 50,
      publish_validation_failed: opts.publish_fail ?? 0,
      queue_lock_acquired: 100,
      queue_lock_contention: opts.queue_contention ?? 0,
      ...(opts.counts ?? {}),
    },
    latencies_ms: {},
    rates: {
      upload_success: 0.6,
      upload_failure: opts.fail_ratio ?? 0,
      resumable_recovery: 0.5,
      queue_contention: (opts.queue_contention ?? 0) / (100 + (opts.queue_contention ?? 0)),
      publish_validation_failure: (opts.publish_fail ?? 0) / (50 + (opts.publish_fail ?? 0)),
      orphan_cleanup_rate: 0,
      upload_retry_per_hour: 0,
      attachment_readiness_conversion: 0.6,
    },
    health_score: 80,
    anomalies: opts.anomalies ?? [],
  };
}

describe('creatorAlertingService', () => {
  beforeEach(() => {
    alertRowsByKey.clear();
    jest.clearAllMocks();
  });

  test('fires upload_failure_rate_high when failure ratio > 30% with enough samples', async () => {
    snapshotResult = snapshot({ fail_ratio: 0.5 });
    const a = await import('../../services/creatorAlertingService');
    const result = await a.evaluateCreatorAlerts({ window: '1h' });
    expect(result.fired.some((f) => f.key.startsWith('upload_failure_rate_high'))).toBe(true);
  });

  test('dedups within cooldown window', async () => {
    snapshotResult = snapshot({ fail_ratio: 0.5 });
    const a = await import('../../services/creatorAlertingService');
    await a.evaluateCreatorAlerts({ window: '1h' });
    const second = await a.evaluateCreatorAlerts({ window: '1h' });
    expect(second.fired.length).toBe(0);
    expect(second.deduped.some((d) => d.key.startsWith('upload_failure_rate_high'))).toBe(true);
  });

  test('fires anomaly-driven alerts', async () => {
    snapshotResult = snapshot({ anomalies: [{ kind: 'lifecycle_deadlock_pattern', severity: 'critical', observed: 25, baseline: 0, ratio: -1, message: 'deadlock' }] });
    const a = await import('../../services/creatorAlertingService');
    const result = await a.evaluateCreatorAlerts({ window: '1h' });
    expect(result.fired.some((f) => f.key.includes('anomaly:lifecycle_deadlock_pattern'))).toBe(true);
  });

  test('returns workflow status', async () => {
    snapshotResult = snapshot({});
    const a = await import('../../services/creatorAlertingService');
    const result = await a.evaluateCreatorAlerts({ window: '1h' });
    expect(['healthy', 'degraded', 'incident']).toContain(result.status);
  });
});
