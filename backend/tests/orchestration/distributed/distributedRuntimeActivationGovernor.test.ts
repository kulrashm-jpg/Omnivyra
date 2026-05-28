/**
 * Phase 22B — DistributedRuntimeActivationGovernor unit tests.
 */

import {
  createDistributedRuntimeActivationGovernor,
  DistributedRuntimeActivationError,
} from '../../../services/orchestration/distributed/distributedRuntimeActivationGovernor';
import {
  createInMemoryExecutionQueue,
} from '../../../services/orchestration/distributed/distributedExecutionQueue';
import {
  createDistributedWorkerCoordinator,
} from '../../../services/orchestration/distributed/distributedWorkerCoordinator';
import {
  createDurableQueueReplayCoordinator,
} from '../../../services/orchestration/distributed/durableQueueReplayCoordinator';
import {
  createRuntimePersistenceCompactor,
} from '../../../services/orchestration/distributed/runtimePersistenceCompactor';

function buildHarness() {
  const queue = createInMemoryExecutionQueue({ telemetry: { emit: () => {} } });
  const workerCoord = createDistributedWorkerCoordinator({ telemetry: { emit: () => {} } });
  const replay = createDurableQueueReplayCoordinator({ queue, workerCoordinator: workerCoord, telemetry: { emit: () => {} } });
  const compactor = createRuntimePersistenceCompactor({ telemetry: { emit: () => {} } });
  const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
  const gov = createDistributedRuntimeActivationGovernor({
    queue, workerCoordinator: workerCoord, replayCoordinator: replay, compactor,
    telemetry: { emit(event, payload) { events.push({ event, payload }); } },
  });
  return { queue, workerCoord, replay, compactor, gov, events };
}

describe('DistributedRuntimeActivationGovernor — happy path', () => {
  test('all validators pass against in-memory infrastructure', async () => {
    const h = buildHarness();
    const result = await h.gov.activate();
    expect(result.ok).toBe(true);
    expect(result.validators.length).toBeGreaterThanOrEqual(6);
    expect(result.validators.every((v) => v.ok)).toBe(true);
    expect(result.failedValidatorName).toBeNull();
    expect(result.cached).toBe(false);
  });

  test('activation succeeded telemetry emitted', async () => {
    const h = buildHarness();
    await h.gov.activate();
    expect(h.events.some((e) => e.event === 'distributed_runtime_activation_started')).toBe(true);
    expect(h.events.some((e) => e.event === 'distributed_runtime_activation_succeeded')).toBe(true);
  });

  test('second activate() returns cached result', async () => {
    const h = buildHarness();
    const first = await h.gov.activate();
    const second = await h.gov.activate();
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(h.gov.isActivated()).toBe(true);
  });

  test('force: true re-runs validators', async () => {
    const h = buildHarness();
    await h.gov.activate();
    const r = await h.gov.activate({ force: true });
    expect(r.cached).toBe(false);
  });
});

describe('DistributedRuntimeActivationGovernor — hard-fail on validator failure', () => {
  test('broken queue.countByStatus → activation throws', async () => {
    const brokenQueue = {
      enqueue: async () => { throw new Error('not used'); },
      claim: async () => [], ack: async () => null, retry: async () => null,
      reclaimExpired: async () => [], get: async () => null,
      listByExecution: async () => [], listByClaimer: async () => [],
      countByStatus: async () => { throw new Error('queue broken'); },
      depth: async () => 0,
    };
    const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
    const gov = createDistributedRuntimeActivationGovernor({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      queue: brokenQueue as any,
      telemetry: { emit(event, payload) { events.push({ event, payload }); } },
    });
    await expect(gov.activate()).rejects.toBeInstanceOf(DistributedRuntimeActivationError);
    expect(gov.isActivated()).toBe(false);
    expect(events.some((e) => e.event === 'distributed_runtime_activation_failed')).toBe(true);
  });

  test('partial validator failure halts at first failure', async () => {
    // Worker registry connectivity passes; queue write fails.
    const brokenQueue = {
      enqueue: async () => { throw new Error('insert refused'); },
      claim: async () => [], ack: async () => null, retry: async () => null,
      reclaimExpired: async () => [], get: async () => null,
      listByExecution: async () => [], listByClaimer: async () => [],
      countByStatus: async () => ({ queued: 0, claimed: 0, completed: 0, failed: 0, dead_lettered: 0, cancelled: 0 }),
      depth: async () => 0,
    };
    const gov = createDistributedRuntimeActivationGovernor({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      queue: brokenQueue as any,
      telemetry: { emit: () => {} },
    });
    let err: unknown;
    try { await gov.activate(); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(DistributedRuntimeActivationError);
    // The failed validator should be queue_write_capability (post connectivity).
    expect((err as DistributedRuntimeActivationError).stage).toMatch(/queue_write_capability|queue_connectivity/);
  });

  test('watchdog timeout flags as watchdog failure', async () => {
    const slowQueue = {
      enqueue: async () => { throw new Error(); }, claim: async () => [], ack: async () => null,
      retry: async () => null, reclaimExpired: async () => [], get: async () => null,
      listByExecution: async () => [], listByClaimer: async () => [],
      async countByStatus() {
        await new Promise((r) => setTimeout(r, 200));
        return { queued: 0, claimed: 0, completed: 0, failed: 0, dead_lettered: 0, cancelled: 0 };
      },
      depth: async () => 0,
    };
    const gov = createDistributedRuntimeActivationGovernor({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      queue: slowQueue as any,
      telemetry: { emit: () => {} },
      watchdogMs: 100, // tighter than the slow validator
    });
    await expect(gov.activate()).rejects.toBeInstanceOf(DistributedRuntimeActivationError);
  });
});

describe('DistributedRuntimeActivationGovernor — failure does not cache', () => {
  test('after a failed activation, subsequent successful one is fresh', async () => {
    const h = buildHarness();
    // First, swap in a broken queue temporarily to force a failure.
    const brokenQueue = {
      enqueue: async () => { throw new Error(); }, claim: async () => [], ack: async () => null,
      retry: async () => null, reclaimExpired: async () => [], get: async () => null,
      listByExecution: async () => [], listByClaimer: async () => [],
      countByStatus: async () => { throw new Error('boom'); },
      depth: async () => 0,
    };
    const failGov = createDistributedRuntimeActivationGovernor({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      queue: brokenQueue as any,
      telemetry: { emit: () => {} },
    });
    await expect(failGov.activate()).rejects.toThrow();
    expect(failGov.isActivated()).toBe(false);
    // Now run the happy-path governor; it should still report cached=false.
    const ok = await h.gov.activate();
    expect(ok.ok).toBe(true);
    expect(ok.cached).toBe(false);
  });
});
