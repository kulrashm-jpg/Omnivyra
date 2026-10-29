/**
 * CSA-002 — the daily readiness snapshot must not depend on recorded company activity.
 *
 * Root cause (production, build c4e4e9bb): `readinessSnapshot` sat behind the
 * inactive-company gate, whose only input is the Redis activity set written by
 * `recordUserActivity` — a function with no callers. The gate therefore never
 * opened, the job never ran, and `customer_readiness_snapshots` stayed empty.
 *
 * These tests drive the REAL gate through the REAL context-warm path and the REAL
 * `shouldRunCronJob`, with only the Redis client stubbed (same harness as
 * boltStaleSweepIntentGate.test.ts).
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
    scan: jest.fn(async () => ['0', [] as string[]]),
    pipeline: jest.fn(() => ({ hincrby: jest.fn(), expire: jest.fn(), exec: jest.fn(async () => []) })),
  })),
}));

import { warmIntentContext, getIntentGate, ALWAYS_RUN_JOBS } from '../../services/intentExecutionService';
import { shouldRunCronJob } from '../../services/adminRuntimeConfig';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('readinessSnapshot is exempt from the inactive-company gate', () => {
  beforeEach(() => { zrangebyscoreResult.value = []; });

  test('with an EMPTY activity set, readinessSnapshot is allowed', async () => {
    await warmIntentContext();
    const gate = getIntentGate('readinessSnapshot');
    expect(gate.allowed).toBe(true);
    expect(gate.reason).toBeNull();
  });

  test('when Redis ERRORS (indistinguishable from idle), readinessSnapshot is still allowed', async () => {
    zrangebyscoreResult.value = new Error('redis unavailable');
    await warmIntentContext();
    expect(getIntentGate('readinessSnapshot').allowed).toBe(true);
  });

  test('the sibling snapshot jobs whose tables are absent in production stay gated', async () => {
    await warmIntentContext();
    for (const key of ['healthSnapshot', 'lifecycleSnapshot']) {
      const gate = getIntentGate(key);
      expect(gate.allowed).toBe(false);
      expect(gate.reason).toBe('no_active_companies');
    }
  });

  test('ordinary gated jobs remain gated — the exemption is not global', async () => {
    await warmIntentContext();
    const blocked = ['signalClustering', 'signalIntelligence', 'strategicTheme', 'campaignOpportunity', 'narrativeEngine', 'autoOptimization', 'weeklyPricingAnalysis']
      .filter((k) => getIntentGate(k).allowed === false);
    expect(blocked).toHaveLength(7);
  });

  test('the always-run set is exactly the previous ten jobs plus readinessSnapshot', () => {
    expect([...ALWAYS_RUN_JOBS].sort()).toEqual([
      'confidenceCalibration', 'connectorTokenRefresh', 'conversationTriageWorker', 'engagementSignalArchive',
      'findDuePostsAndEnqueue', 'governanceAudit', 'intelligenceEventCleanup', 'leadThreadQueueCleanup',
      'performanceAggregation', 'readinessSnapshot', 'staleExecutionSweep',
    ].sort());
  });
});

describe('readinessSnapshot keeps its daily cadence', () => {
  beforeEach(async () => { zrangebyscoreResult.value = []; await warmIntentContext(); });

  test('never run (fresh worker, last run 0) → due', () => {
    expect(shouldRunCronJob('readinessSnapshot', DAY_MS, 0)).toBe(true);
  });

  test('ran just now → not due', () => {
    expect(shouldRunCronJob('readinessSnapshot', DAY_MS, Date.now())).toBe(false);
  });

  test('ran 23h ago → not due; ran 25h ago → due', () => {
    expect(shouldRunCronJob('readinessSnapshot', DAY_MS, Date.now() - 23 * 60 * 60 * 1000)).toBe(false);
    expect(shouldRunCronJob('readinessSnapshot', DAY_MS, Date.now() - 25 * 60 * 60 * 1000)).toBe(true);
  });

  test('a still-gated job is refused by the gate even when its interval has elapsed', () => {
    expect(shouldRunCronJob('healthSnapshot', DAY_MS, 0)).toBe(false);
  });
});
