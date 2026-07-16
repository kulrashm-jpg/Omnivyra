/**
 * POP — operationsCenterService read-only snapshot.
 * Verifies the Operations Center surfaces rollout flags (resolved mode/source +
 * kill), the version fingerprint, the runtime/queue/cron topology, and SPOFs —
 * without changing any runtime behaviour.
 */
import { defineRolloutFlag } from '../../../lib/platform/rollout';
import { getOperationsCenterSnapshot, summarizeAiRuntime } from '../../services/operationsCenterService';

const ENV = ['ROLLOUT_OPS_TEST_FLAG_MODE', 'ROLLOUT_OPS_TEST_FLAG_KILL', 'ROLLOUT_KILL_SWITCH'];
beforeEach(() => { for (const k of ENV) delete process.env[k]; });
afterAll(() => { for (const k of ENV) delete process.env[k]; });

describe('operationsCenterService', () => {
  test('surfaces version, topology, and SPOFs', () => {
    const s = getOperationsCenterSnapshot();
    expect(typeof s.version.fingerprint).toBe('string');
    expect(s.version.nodeVersion).toBe(process.version);
    // topology reflects committed vercel.json / railway.json
    expect(s.topology.vercelCrons.length).toBeGreaterThanOrEqual(12);
    expect(s.topology.worker.replicas).toBe(1); // railway.json numReplicas
    expect(s.topology.queues).toContain('bolt-execution');
    expect(s.singlePointsOfFailure.length).toBeGreaterThan(0);
  });

  test('surfaces registered rollout flags with resolved mode/source', () => {
    defineRolloutFlag({ key: 'ops-test-flag', description: 'ops center test flag' });
    const off = getOperationsCenterSnapshot().rolloutFlags.find((f) => f.key === 'ops-test-flag')!;
    expect(off).toBeDefined();
    expect(off.mode).toBe('off');       // default
    expect(off.killed).toBe(false);
    expect(off.envPrefix).toBe('ROLLOUT_OPS_TEST_FLAG');

    process.env.ROLLOUT_OPS_TEST_FLAG_MODE = 'shadow';
    expect(getOperationsCenterSnapshot().rolloutFlags.find((f) => f.key === 'ops-test-flag')!.mode).toBe('shadow');
  });

  test('reflects kill switch as killed', () => {
    defineRolloutFlag({ key: 'ops-test-flag', description: 'ops center test flag' });
    process.env.ROLLOUT_OPS_TEST_FLAG_MODE = 'enforce';
    process.env.ROLLOUT_OPS_TEST_FLAG_KILL = '1';
    const f = getOperationsCenterSnapshot().rolloutFlags.find((x) => x.key === 'ops-test-flag')!;
    expect(f.mode).toBe('off');
    expect(f.killed).toBe(true);
    expect(f.source).toBe('env-kill');
  });

  test('read-only: no secrets in the snapshot payload', () => {
    const json = JSON.stringify(getOperationsCenterSnapshot());
    expect(json).not.toMatch(/secret|token|password|rediss:\/\/|postgres:\/\//i);
  });
});

describe('summarizeAiRuntime (AI runtime rollup from existing signals)', () => {
  const base = {
    counters: [
      { name: 'ai.provider.count', labels: { provider: 'openai' }, value: 100 },
      { name: 'ai.provider.errors', labels: { provider: 'openai' }, value: 10 },
      { name: 'ai.provider.retries', labels: { provider: 'openai' }, value: 5 },
      { name: 'ai.provider.tokens_in', labels: { provider: 'openai' }, value: 2000 },
      { name: 'ai.provider.tokens_out', labels: { provider: 'openai' }, value: 800 },
      { name: 'ai.provider.slow', labels: { provider: 'openai' }, value: 3 },
      { name: 'ai.provider.count', labels: { provider: 'anthropic' }, value: 20 },
      { name: 'unrelated.metric', labels: { provider: 'openai' }, value: 999 }, // ignored
    ],
    histograms: [{ name: 'ai.provider.duration_ms', labels: { provider: 'openai' }, count: 100, sum: 120000 }],
    slowAi: [{ providerModel: 'openai:gpt-4o-mini', ms: 4200 }],
    providerEnv: [{ provider: 'openai', keyPresent: true }, { provider: 'anthropic', keyPresent: false }],
    defaultModel: 'gpt-4o-mini',
  };

  test('rolls up per-provider calls/errors/retries/tokens/avg from real series (no fabrication)', () => {
    const v = summarizeAiRuntime({ ...base, pools: { pool: 'all', activeCalls: 1, pendingAcquires: 0, maxAllowed: 8, recentAvgWaitMs: 5 } });
    const oa = v.byProvider.find((p) => p.provider === 'openai')!;
    expect(oa.calls).toBe(100);
    expect(oa.errors).toBe(10);
    expect(oa.errorRate).toBeCloseTo(0.1);
    expect(oa.avgDurationMs).toBe(1200); // 120000/100
    expect(v.totals.calls).toBe(120); // openai 100 + anthropic 20
    expect(v.configuredProviders).toEqual(base.providerEnv);
    expect(v.slowTop[0].providerModel).toBe('openai:gpt-4o-mini');
  });

  test('healthy verdict from real data: low error + no backpressure → healthy', () => {
    const v = summarizeAiRuntime({ ...base, pools: { pool: 'all', activeCalls: 1, pendingAcquires: 0, maxAllowed: 8, recentAvgWaitMs: 5 } });
    expect(v.healthy).toBe(true); // 10% error, no waiting
  });

  test('degraded when error rate high OR pool has pending acquires', () => {
    const highErr = summarizeAiRuntime({ ...base, counters: [{ name: 'ai.provider.count', labels: { provider: 'openai' }, value: 10 }, { name: 'ai.provider.errors', labels: { provider: 'openai' }, value: 5 }], pools: null });
    expect(highErr.healthy).toBe(false); // 50% error
    const backpressure = summarizeAiRuntime({ ...base, pools: { pool: 'all', activeCalls: 8, pendingAcquires: 4, maxAllowed: 8, recentAvgWaitMs: 900 } });
    expect(backpressure.healthy).toBe(false); // 4 waiting
  });

  test('no traffic → healthy; missing signals listed honestly', () => {
    const v = summarizeAiRuntime({ counters: [], histograms: [], slowAi: [], pools: null, providerEnv: [], defaultModel: null });
    expect(v.healthy).toBe(true);
    expect(v.totals.calls).toBe(0);
    expect(v.missingSignals.some((m) => /circuit-breaker/i.test(m))).toBe(true);
  });
});
