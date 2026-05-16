/**
 * Tests for creatorQueueReliabilityService:
 *   - computeRetryDelayMs grows exponentially + caps at 30 min
 *   - recordPublishFailure routes to DLQ at threshold
 *   - reconcileDuplicateQueueJobs cancels older duplicates
 *   - sweepQueueDrift cancels DB rows whose BullMQ peers are gone
 *   - recoverStuckProcessingJobs requeues stale processing rows
 */

let queueJobs: Array<{ id: string; scheduled_post_id: string; status: string; attempts?: number; last_error?: string; updated_at?: string }> = [];
let dlqRows: any[] = [];
let queueJobsFromBull = new Set<string>();
let updateCalls: Array<{ table: string; payload: any; filters: Record<string, any>; ids?: string[] }> = [];

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: jest.fn((table: string) => {
      const filters: Record<string, any> = {};
      const api: any = {
        select: jest.fn(() => api),
        eq: jest.fn((k: string, v: any) => { filters[k] = v; return api; }),
        in: jest.fn((k: string, v: any[]) => { filters[k] = v; return api; }),
        lt: jest.fn((k: string, v: any) => { filters[`${k}__lt`] = v; return api; }),
        order: jest.fn(() => api),
        limit: jest.fn(() => Promise.resolve({ data: queryRows(table, filters), error: null })),
        maybeSingle: jest.fn(async () => ({ data: queryRows(table, filters)[0] ?? null, error: null })),
        // Make the api itself thenable so callers that don't terminate with
        // .limit()/.maybeSingle() (e.g. .order() chained alone) still receive
        // the rows as { data, error }.
        then: (resolve: any) => Promise.resolve({ data: queryRows(table, filters), error: null }).then(resolve),
      };
      return api;
    }),
  },
}));

function queryRows(table: string, filters: Record<string, any>): any[] {
  let rows: any[] = [];
  if (table === 'queue_jobs') rows = queueJobs;
  else if (table === 'creator_dead_letter_jobs') rows = dlqRows;
  return rows.filter((r) => {
    for (const [k, v] of Object.entries(filters)) {
      if (k.endsWith('__lt')) {
        const f = k.slice(0, -4);
        if (!(r[f] && r[f] < v)) return false;
      } else if (Array.isArray(v)) {
        if (!v.includes(r[k])) return false;
      } else if (r[k] !== v) return false;
    }
    return true;
  });
}

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: jest.fn((table: string) => {
    let payload: any = null;
    const filters: Record<string, any> = {};
    let ids: string[] = [];
    const api: any = {
      insert: jest.fn(async (row: any) => {
        if (table === 'creator_dead_letter_jobs') {
          dlqRows.push({ id: `dlq-${dlqRows.length + 1}`, ...row });
        } else if (table === 'queue_jobs') {
          queueJobs.push({ ...row });
        }
        return { data: row, error: null };
      }),
      update: jest.fn((p: any) => { payload = p; return api; }),
      eq: jest.fn((k: string, v: any) => { filters[k] = v; return api; }),
      in: jest.fn((k: string, v: any[]) => { filters[k] = v; if (k === 'id') ids = v; return api; }),
      then(resolve: any) {
        if (payload) {
          if (table === 'creator_dead_letter_jobs') {
            for (const row of dlqRows) {
              if (filters.id && row.id === filters.id) Object.assign(row, payload);
              if (filters.scheduled_post_id && row.scheduled_post_id === filters.scheduled_post_id) Object.assign(row, payload);
            }
          } else if (table === 'queue_jobs') {
            for (const row of queueJobs) {
              if (ids.length > 0 && ids.includes(row.id)) Object.assign(row, payload);
              if (filters.id && row.id === filters.id) Object.assign(row, payload);
            }
          }
          updateCalls.push({ table, payload, filters, ids: ids.length > 0 ? ids : undefined });
        }
        return Promise.resolve({ data: null, error: null }).then(resolve);
      },
    };
    return api;
  }),
}));

jest.mock('../../queue/bullmqClient', () => ({
  getQueue: jest.fn(() => ({
    getJob: jest.fn(async (id: string) => queueJobsFromBull.has(id) ? { remove: async () => { queueJobsFromBull.delete(id); } } : null),
    add: jest.fn(),
  })),
  getEngagementPollingQueue: jest.fn(() => ({ add: jest.fn() })),
}));

jest.mock('../../services/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('../../services/creatorOperationalTelemetryService', () => ({
  emitCreatorEvent: jest.fn(),
  CREATOR_EVENTS: {
    QUEUE_JOB_POISONED: 'queue_job_poisoned',
    QUEUE_DRIFT_DETECTED: 'queue_drift_detected',
  },
}));
jest.mock('../../services/creatorAuditTrailService', () => ({ recordAuditEntry: jest.fn() }));

describe('creatorQueueReliabilityService', () => {
  beforeEach(() => {
    queueJobs = [];
    dlqRows = [];
    queueJobsFromBull = new Set();
    updateCalls = [];
    jest.clearAllMocks();
  });

  test('computeRetryDelayMs grows exponentially', async () => {
    const q = await import('../../services/creatorQueueReliabilityService');
    const a1 = q.computeRetryDelayMs(1);
    const a3 = q.computeRetryDelayMs(3);
    const a10 = q.computeRetryDelayMs(10);
    expect(a3).toBeGreaterThan(a1);
    expect(a10).toBeLessThanOrEqual(30 * 60 * 1000 + 5_000);
  });

  test('recordPublishFailure routes to DLQ at threshold', async () => {
    const q = await import('../../services/creatorQueueReliabilityService');
    const result = await q.recordPublishFailure({
      scheduledPostId: 'sp-1',
      queueJobId: 'qj-1',
      attemptCount: 5,
      errorCode: 'X',
      errorMessage: 'fail',
    });
    expect(result.routed_to_dlq).toBe(true);
    expect(dlqRows.length).toBe(1);
  });

  test('recordPublishFailure returns retry delay before threshold', async () => {
    const q = await import('../../services/creatorQueueReliabilityService');
    const result = await q.recordPublishFailure({
      scheduledPostId: 'sp-2',
      queueJobId: 'qj-2',
      attemptCount: 2,
      errorCode: 'X',
      errorMessage: 'fail',
    });
    expect(result.routed_to_dlq).toBe(false);
    expect((result.retry_in_ms ?? 0)).toBeGreaterThan(0);
  });

  test('reconcileDuplicateQueueJobs cancels duplicates', async () => {
    queueJobs.push({ id: 'qj-A', scheduled_post_id: 'sp-X', status: 'pending', updated_at: '2026-01-01T00:00:00Z' });
    queueJobs.push({ id: 'qj-B', scheduled_post_id: 'sp-X', status: 'pending', updated_at: '2026-01-01T01:00:00Z' });
    queueJobs.push({ id: 'qj-C', scheduled_post_id: 'sp-X', status: 'pending', updated_at: '2026-01-01T02:00:00Z' });
    const q = await import('../../services/creatorQueueReliabilityService');
    const count = await q.reconcileDuplicateQueueJobs('sp-X');
    expect(count).toBe(2);
  });

  test('sweepQueueDrift cancels rows whose BullMQ peer is missing', async () => {
    queueJobs.push({ id: 'qj-D', scheduled_post_id: 'sp-Y', status: 'pending', updated_at: '2026-01-01T00:00:00Z' });
    queueJobs.push({ id: 'qj-E', scheduled_post_id: 'sp-Y', status: 'pending', updated_at: '2026-01-01T01:00:00Z' });
    queueJobsFromBull.add('qj-D'); // qj-E is missing from bull
    const q = await import('../../services/creatorQueueReliabilityService');
    const result = await q.sweepQueueDrift({ maxScan: 100 });
    expect(result.drift_found).toBe(1);
    expect(result.drift_cancelled).toBe(1);
  });

  test('recoverStuckProcessingJobs requeues stale rows below threshold', async () => {
    queueJobs.push({
      id: 'qj-F',
      scheduled_post_id: 'sp-Z',
      status: 'processing',
      attempts: 1,
      updated_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    });
    const q = await import('../../services/creatorQueueReliabilityService');
    const result = await q.recoverStuckProcessingJobs({ staleMinutes: 15 });
    expect(result.scanned).toBe(1);
    expect(result.recovered).toBe(1);
  });
});
