/**
 * PHASE 168 — the stale-execution sweep must survive an idle platform.
 *
 * Root cause proven in Phase 167: `staleExecutionSweep` is wired on a 5-minute
 * interval but never fired. `getIntentGate` blocks every job outside
 * `ALWAYS_RUN_JOBS` when no company has been active in the activity window —
 * and `getActiveCompanyIds()` also returns `[]` when Redis simply ERRORS. So
 * the one mechanism that rescues a stuck BOLT run was gated behind the very
 * signal a stalled or degraded platform stops producing.
 *
 * These tests drive the REAL gate through the REAL context-warm path.
 */

const zrangebyscoreResult: { value: string[] | Error } = { value: [] };

jest.mock('../../queue/standaloneRedisClient', () => ({
  getInstrumentedStandaloneRedisClient: jest.fn(() => ({
    // No active companies (or a Redis fault) — both collapse to [].
    zrangebyscore: jest.fn(async () => {
      if (zrangebyscoreResult.value instanceof Error) throw zrangebyscoreResult.value;
      return zrangebyscoreResult.value;
    }),
    zadd: jest.fn(async () => 1),
    zremrangebyscore: jest.fn(async () => 0),
    get: jest.fn(async () => null),
    set: jest.fn(async () => 'OK'),
    del: jest.fn(async () => 1),
    hincrby: jest.fn(async () => 1),
    hgetall: jest.fn(async () => ({})),
    expire: jest.fn(async () => 1),
    // Trigger-key scan must terminate on the first cursor sweep.
    scan: jest.fn(async () => ['0', [] as string[]]),
    pipeline: jest.fn(() => ({ hincrby: jest.fn(), expire: jest.fn(), exec: jest.fn(async () => []) })),
  })),
}));

import { warmIntentContext, getIntentGate } from '../../services/intentExecutionService';

describe('stale-execution sweep is exempt from the inactive-company gate', () => {
  beforeEach(() => { zrangebyscoreResult.value = []; });

  test('with NO active companies, staleExecutionSweep is still allowed', async () => {
    await warmIntentContext();
    const gate = getIntentGate('staleExecutionSweep');
    expect(gate.allowed).toBe(true);
    expect(gate.reason).toBeNull();
  });

  test('when Redis ERRORS (indistinguishable from idle), recovery still runs', async () => {
    zrangebyscoreResult.value = new Error('redis unavailable');
    await warmIntentContext();
    expect(getIntentGate('staleExecutionSweep').allowed).toBe(true);
  });

  test('ordinary feature jobs remain gated — the exemption is not global', async () => {
    await warmIntentContext();
    const ordinary = getIntentGate('signalClustering');
    expect(ordinary.allowed).toBe(false);
    expect(ordinary.reason).toBe('no_active_companies');
  });

  test('the exemption did not silently enable every cron job', async () => {
    await warmIntentContext();
    const blocked = ['signalIntelligence', 'strategicTheme', 'campaignOpportunity', 'narrativeEngine']
      .filter((k) => getIntentGate(k).allowed === false);
    expect(blocked).toHaveLength(4);
  });

  test('pre-existing always-run jobs are unaffected', async () => {
    await warmIntentContext();
    for (const key of ['findDuePostsAndEnqueue', 'leadThreadQueueCleanup', 'confidenceCalibration']) {
      expect(getIntentGate(key).allowed).toBe(true);
    }
  });
});
