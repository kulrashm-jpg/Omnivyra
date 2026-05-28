/**
 * Phase 22D — DistributedReclaimSafetyGovernor unit tests.
 */

import {
  createDistributedReclaimSafetyGovernor,
} from '../../../services/orchestration/distributed/distributedReclaimSafetyGovernor';
import {
  createInMemoryExecutionQueue,
} from '../../../services/orchestration/distributed/distributedExecutionQueue';
import {
  createDistributedWorkerCoordinator,
} from '../../../services/orchestration/distributed/distributedWorkerCoordinator';
import {
  createInMemoryExecutionStore,
} from '../../../services/threadRuntime/executionStore';
import {
  createDurableExecutionCoordinator,
} from '../../../services/threadRuntime/durableExecutionCoordinator';
import {
  createExecutionLeaseGovernor,
} from '../../../services/threadRuntime/executionLeaseGovernor';
import {
  createLeaseRecoveryGovernor,
} from '../../../services/orchestration/recovery/leaseRecoveryGovernor';

async function buildHarness() {
  const store = createInMemoryExecutionStore();
  const execCoord = createDurableExecutionCoordinator({ store });
  const leaseGov = createExecutionLeaseGovernor({ store });
  const queue = createInMemoryExecutionQueue({ telemetry: { emit: () => {} } });
  const workerCoord = createDistributedWorkerCoordinator({ telemetry: { emit: () => {} } });
  const recoveryGov = createLeaseRecoveryGovernor({ store, leaseGovernor: leaseGov, telemetry: { emit: () => {} } });
  const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
  const gov = createDistributedReclaimSafetyGovernor({
    queue, workerCoordinator: workerCoord, leaseRecoveryGovernor: recoveryGov,
    telemetry: { emit(event, payload) { events.push({ event, payload }); } },
    defaultStaleConfirmationMs: 0,
    defaultSuppressionWindowMs: 1,
  });
  return { store, execCoord, queue, workerCoord, recoveryGov, gov, events };
}

async function setup(h: Awaited<ReturnType<typeof buildHarness>>, opts?: { workerStatus?: 'active' | 'stale' | 'offline'; claim?: boolean }) {
  const status = opts?.workerStatus ?? 'offline';
  await h.workerCoord.register({ workerId: 'w_dead', workerKind: 'queue_worker', capabilities: [] });
  if (status === 'offline') await h.workerCoord.offline('w_dead');
  // Note: 'stale' isn't a direct API transition; sweepStale flips active → stale.
  // For test simplicity we use 'offline' which is a stable terminal.
  const exec = await h.execCoord.start({
    runtimeSessionId: 'rs', threadId: 'thr',
    companyId: '00000000-0000-0000-0000-000000000001',
  });
  const entry = await h.queue.enqueue({
    executionId: exec.executionId, companyId: exec.companyId, kind: 'execution_start',
  });
  if (opts?.claim !== false) {
    await h.queue.claim({ workerId: 'w_dead' });
  }
  return { exec, entry };
}

describe('DistributedReclaimSafetyGovernor — safe reclaim', () => {
  test('offline worker with claimed entry → verdict.ok', async () => {
    const h = await buildHarness();
    const { entry } = await setup(h);
    const v = await h.gov.validateReclaim({
      queueEntryId: entry.queueEntryId, targetWorkerId: 'w_dead',
    });
    expect(v.ok).toBe(true);
    expect(v.reason).toBe('safe');
    expect(h.events.some((e) => e.event === 'reclaim_validation_succeeded')).toBe(true);
  });
});

describe('DistributedReclaimSafetyGovernor — refused', () => {
  test('queue entry missing → execution_missing? No — queue_entry_missing', async () => {
    const h = await buildHarness();
    const v = await h.gov.validateReclaim({
      queueEntryId: 'unknown_queue_entry', targetWorkerId: 'w',
    });
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('queue_entry_missing');
  });

  test('entry not in claimed state → queue_entry_not_claimed', async () => {
    const h = await buildHarness();
    const { entry } = await setup(h, { claim: false });
    const v = await h.gov.validateReclaim({
      queueEntryId: entry.queueEntryId, targetWorkerId: 'w_dead',
    });
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('queue_entry_not_claimed');
  });

  test('entry claimed by different worker → split-brain prevented', async () => {
    const h = await buildHarness();
    await h.workerCoord.register({ workerId: 'w_actual', workerKind: 'queue_worker', capabilities: [] });
    await h.workerCoord.register({ workerId: 'w_target_dead', workerKind: 'queue_worker', capabilities: [] });
    await h.workerCoord.offline('w_target_dead');
    const exec = await h.execCoord.start({
      runtimeSessionId: 'rs', threadId: 'thr',
      companyId: '00000000-0000-0000-0000-000000000001',
    });
    const entry = await h.queue.enqueue({
      executionId: exec.executionId, companyId: exec.companyId, kind: 'execution_start',
    });
    await h.queue.claim({ workerId: 'w_actual' }); // wrong worker holds the claim
    const v = await h.gov.validateReclaim({
      queueEntryId: entry.queueEntryId, targetWorkerId: 'w_target_dead',
    });
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('queue_entry_not_owned_by_target');
    expect(h.events.some((e) => e.event === 'reclaim_split_brain_prevented')).toBe(true);
  });

  test('worker still active → worker_still_alive', async () => {
    const h = await buildHarness();
    await h.workerCoord.register({ workerId: 'w_alive', workerKind: 'queue_worker', capabilities: [] });
    const exec = await h.execCoord.start({
      runtimeSessionId: 'rs', threadId: 'thr',
      companyId: '00000000-0000-0000-0000-000000000001',
    });
    const entry = await h.queue.enqueue({
      executionId: exec.executionId, companyId: exec.companyId, kind: 'execution_start',
    });
    await h.queue.claim({ workerId: 'w_alive' });
    const v = await h.gov.validateReclaim({
      queueEntryId: entry.queueEntryId, targetWorkerId: 'w_alive',
    });
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('worker_still_alive');
  });

  test('suppression window blocks rapid re-validation', async () => {
    const h = await buildHarness();
    const { entry } = await setup(h);
    const a = await h.gov.validateReclaim({
      queueEntryId: entry.queueEntryId, targetWorkerId: 'w_dead',
      suppressionWindowMs: 5_000,
    });
    expect(a.ok).toBe(true);
    const b = await h.gov.validateReclaim({
      queueEntryId: entry.queueEntryId, targetWorkerId: 'w_dead',
      suppressionWindowMs: 5_000,
    });
    expect(b.ok).toBe(false);
    expect(b.reason).toBe('reclaim_within_suppression_window');
  });

  test('execution missing → execution_missing', async () => {
    const h = await buildHarness();
    await h.workerCoord.register({ workerId: 'w_dead', workerKind: 'queue_worker', capabilities: [] });
    await h.workerCoord.offline('w_dead');
    // Enqueue WITHOUT creating the execution row.
    const entry = await h.queue.enqueue({
      executionId: 'ghost_exec', companyId: 'co', kind: 'execution_start',
    });
    await h.queue.claim({ workerId: 'w_dead' });
    const v = await h.gov.validateReclaim({
      queueEntryId: entry.queueEntryId, targetWorkerId: 'w_dead',
    });
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('execution_missing');
  });
});

describe('DistributedReclaimSafetyGovernor — _reset', () => {
  test('_reset clears suppression history', async () => {
    const h = await buildHarness();
    const { entry } = await setup(h);
    await h.gov.validateReclaim({
      queueEntryId: entry.queueEntryId, targetWorkerId: 'w_dead',
      suppressionWindowMs: 60_000,
    });
    h.gov._reset();
    const v = await h.gov.validateReclaim({
      queueEntryId: entry.queueEntryId, targetWorkerId: 'w_dead',
      suppressionWindowMs: 60_000,
    });
    expect(v.ok).toBe(true); // suppression cleared
  });
});
