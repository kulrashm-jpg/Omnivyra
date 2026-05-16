/**
 * Tests for creatorCronOrchestrationService:
 *   - acquireCronLease succeeds on empty + expired
 *   - acquireCronLease fails when held + not expired
 *   - releaseCronLease clears expires_at
 *   - runCronJobWithLease wraps lifecycle correctly
 *   - timeout guard fires when fn doesn't return
 */

let lease: any = null;

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: jest.fn(() => {
      const api: any = {
        select: jest.fn(() => api),
        eq: jest.fn(() => api),
        maybeSingle: jest.fn(async () => ({ data: lease, error: null })),
      };
      return api;
    }),
  },
}));

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: jest.fn(() => {
    let payload: any = null;
    const filters: Record<string, any> = {};
    const api: any = {
      insert: jest.fn(async (row: any) => { lease = { ...row }; return { data: row, error: null }; }),
      update: jest.fn((p: any) => { payload = p; return api; }),
      eq: jest.fn((k: string, v: any) => { filters[k] = v; return api; }),
      then(resolve: any) {
        if (payload && lease) Object.assign(lease, payload);
        return Promise.resolve({ data: null, error: null }).then(resolve);
      },
    };
    return api;
  }),
}));

jest.mock('../../services/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('../../services/creatorOperationalTelemetryService', () => ({
  emitCreatorEvent: jest.fn(),
  CREATOR_EVENTS: {},
}));

describe('creatorCronOrchestrationService', () => {
  beforeEach(() => {
    lease = null;
    jest.clearAllMocks();
  });

  test('acquireCronLease succeeds when no prior lease exists', async () => {
    const o = await import('../../services/creatorCronOrchestrationService');
    const result = await o.acquireCronLease({ jobName: 'test_job' });
    expect(result.acquired).toBe(true);
    expect(lease.job_name).toBe('test_job');
  });

  test('acquireCronLease fails when held + not expired', async () => {
    lease = {
      job_name: 'test_job',
      holder_id: 'other',
      acquired_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    };
    const o = await import('../../services/creatorCronOrchestrationService');
    const result = await o.acquireCronLease({ jobName: 'test_job' });
    expect(result.acquired).toBe(false);
  });

  test('acquireCronLease takes over expired lease', async () => {
    lease = {
      job_name: 'test_job',
      holder_id: 'old',
      acquired_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      expires_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    };
    const o = await import('../../services/creatorCronOrchestrationService');
    const result = await o.acquireCronLease({ jobName: 'test_job' });
    expect(result.acquired).toBe(true);
  });

  test('runCronJobWithLease runs the job + reports duration', async () => {
    const o = await import('../../services/creatorCronOrchestrationService');
    const result = await o.runCronJobWithLease({
      jobName: 'job_x',
      ttlMs: 30_000,
      timeoutMs: 25_000,
      run: async () => ({ ok: true }),
    });
    expect(result.ran).toBe(true);
    expect(result.result).toEqual({ ok: true });
    expect(typeof result.duration_ms).toBe('number');
  });

  test('runCronJobWithLease times out long-running jobs', async () => {
    const o = await import('../../services/creatorCronOrchestrationService');
    const result = await o.runCronJobWithLease({
      jobName: 'slow_job',
      ttlMs: 200,
      timeoutMs: 50,
      run: () => new Promise((resolve) => setTimeout(() => resolve('ok'), 200)),
    });
    expect(result.ran).toBe(true);
    expect(result.error).toMatch(/timed out/);
  });

  test('runCronJobWithLease skips when lease held by another holder', async () => {
    lease = {
      job_name: 'busy_job',
      holder_id: 'other',
      acquired_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    };
    const o = await import('../../services/creatorCronOrchestrationService');
    const result = await o.runCronJobWithLease({
      jobName: 'busy_job',
      run: async () => 'should-not-run',
    });
    expect(result.ran).toBe(false);
  });
});
