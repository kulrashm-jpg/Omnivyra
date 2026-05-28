/**
 * Phase 20C — ExecutionClaimingEngine unit tests.
 */

import {
  createExecutionClaimingEngine,
} from '../../../services/orchestration/distributed/executionClaimingEngine';
import {
  createInMemoryExecutionQueue,
} from '../../../services/orchestration/distributed/distributedExecutionQueue';
import {
  createDistributedWorkerCoordinator,
} from '../../../services/orchestration/distributed/distributedWorkerCoordinator';
import {
  createLeaseRecoveryGovernor,
} from '../../../services/orchestration/recovery/leaseRecoveryGovernor';
import {
  createInMemoryExecutionStore,
} from '../../../services/threadRuntime/executionStore';
import {
  createDurableExecutionCoordinator,
} from '../../../services/threadRuntime/durableExecutionCoordinator';
import {
  createExecutionLeaseGovernor,
} from '../../../services/threadRuntime/executionLeaseGovernor';

async function buildHarness() {
  const store = createInMemoryExecutionStore();
  const durable = createDurableExecutionCoordinator({ store });
  const leaseGov = createExecutionLeaseGovernor({ store });
  const queue = createInMemoryExecutionQueue({ telemetry: { emit: () => {} } });
  const workerCoord = createDistributedWorkerCoordinator({ telemetry: { emit: () => {} } });
  const recoveryGov = createLeaseRecoveryGovernor({ store, leaseGovernor: leaseGov, telemetry: { emit: () => {} } });
  const engine = createExecutionClaimingEngine({
    queue, workerCoordinator: workerCoord, leaseGovernor: recoveryGov, durableExecution: durable,
    telemetry: { emit: () => {} },
  });
  return { store, durable, leaseGov, queue, workerCoord, recoveryGov, engine };
}

async function seedExecutionAndEnqueue(h: Awaited<ReturnType<typeof buildHarness>>, opts?: { workerId?: string }) {
  const exec = await h.durable.start({
    runtimeSessionId: 'rs', threadId: 'thr',
    companyId: '00000000-0000-0000-0000-000000000001',
    workerId: opts?.workerId,
  });
  await h.queue.enqueue({
    executionId: exec.executionId, companyId: exec.companyId, kind: 'execution_start',
  });
  return exec;
}

describe('ExecutionClaimingEngine', () => {
  test('worker not registered → ineligible', async () => {
    const h = await buildHarness();
    await seedExecutionAndEnqueue(h);
    const r = await h.engine.claimNext({ workerId: 'unknown_worker' });
    expect(r).toBeNull();
  });

  test('happy path: queue claim + lease takeover succeed', async () => {
    const h = await buildHarness();
    await h.workerCoord.register({ workerId: 'w_a', workerKind: 'queue_worker', capabilities: [] });
    await seedExecutionAndEnqueue(h);
    const r = await h.engine.claimNext({ workerId: 'w_a' });
    expect(r).not.toBeNull();
    expect(r!.ownership.ok).toBe(true);
    if (r!.ownership.ok) {
      expect(r!.ownership.workerId).toBe('w_a');
      expect(r!.ownership.previousOwnerId).toBeNull();
    }
  });

  test('concurrent claim — exactly one worker wins the queue entry', async () => {
    const h = await buildHarness();
    await h.workerCoord.register({ workerId: 'w_a', workerKind: 'queue_worker', capabilities: [] });
    await h.workerCoord.register({ workerId: 'w_b', workerKind: 'queue_worker', capabilities: [] });
    await seedExecutionAndEnqueue(h);
    const [a, b] = await Promise.all([
      h.engine.claimNext({ workerId: 'w_a' }),
      h.engine.claimNext({ workerId: 'w_b' }),
    ]);
    const okClaims = [a, b].filter((c) => c?.ownership.ok === true);
    expect(okClaims).toHaveLength(1);
  });

  test('execution missing → claim succeeded for queue but ownership reports execution_missing', async () => {
    const h = await buildHarness();
    await h.workerCoord.register({ workerId: 'w', workerKind: 'queue_worker', capabilities: [] });
    // Enqueue with no matching execution row.
    await h.queue.enqueue({
      executionId: 'ghost', companyId: 'co', kind: 'execution_start',
    });
    const r = await h.engine.claimNext({ workerId: 'w' });
    expect(r).not.toBeNull();
    expect(r!.ownership.ok).toBe(false);
    if (!r!.ownership.ok) expect(r!.ownership.reason).toBe('execution_missing');
  });

  test('split-brain: live lease causes takeover refusal + queue entry release', async () => {
    const h = await buildHarness();
    await h.workerCoord.register({ workerId: 'w_a', workerKind: 'queue_worker', capabilities: [] });
    await h.workerCoord.register({ workerId: 'w_b', workerKind: 'queue_worker', capabilities: [] });
    const exec = await seedExecutionAndEnqueue(h);
    // w_a takes a long live lease outside the engine.
    await h.store.acquireLease({ executionId: exec.executionId, workerId: 'w_a', durationMs: 60_000 });
    const r = await h.engine.claimNext({ workerId: 'w_b' });
    expect(r).not.toBeNull();
    expect(r!.ownership.ok).toBe(false);
    if (!r!.ownership.ok) expect(r!.ownership.reason).toBe('lease_takeover_refused');
    // Queue entry should be back to queued for a future attempt.
    const after = await h.queue.get(r!.queueEntry.queueEntryId);
    expect(after?.status).toBe('queued');
  });

  test('releaseClaim acks queue as failed + releases lease', async () => {
    const h = await buildHarness();
    await h.workerCoord.register({ workerId: 'w', workerKind: 'queue_worker', capabilities: [] });
    await seedExecutionAndEnqueue(h);
    const r = await h.engine.claimNext({ workerId: 'w' });
    expect(r!.ownership.ok).toBe(true);
    await h.engine.releaseClaim({
      queueEntryId: r!.queueEntry.queueEntryId,
      workerId: 'w',
      reason: 'test_release',
    });
    const after = await h.queue.get(r!.queueEntry.queueEntryId);
    // failed ack with retries remaining → re-queued.
    expect(after?.status === 'queued' || after?.status === 'failed').toBe(true);
  });
});
