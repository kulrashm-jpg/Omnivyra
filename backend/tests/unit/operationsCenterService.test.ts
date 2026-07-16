/**
 * POP — operationsCenterService read-only snapshot.
 * Verifies the Operations Center surfaces rollout flags (resolved mode/source +
 * kill), the version fingerprint, the runtime/queue/cron topology, and SPOFs —
 * without changing any runtime behaviour.
 */
import { defineRolloutFlag } from '../../../lib/platform/rollout';
import { getOperationsCenterSnapshot } from '../../services/operationsCenterService';

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
