/**
 * Phase 21G — DistributedRuntimeForensicAnalyzer unit tests.
 */

import {
  createDistributedRuntimeForensicAnalyzer,
} from '../../../services/orchestration/distributed/distributedRuntimeForensicAnalyzer';
import {
  createInMemoryExecutionQueue,
} from '../../../services/orchestration/distributed/distributedExecutionQueue';
import {
  createDistributedWorkerCoordinator,
} from '../../../services/orchestration/distributed/distributedWorkerCoordinator';

async function buildHarness() {
  const queue = createInMemoryExecutionQueue({ telemetry: { emit: () => {} } });
  const workerCoord = createDistributedWorkerCoordinator({ telemetry: { emit: () => {} } });
  return {
    queue, workerCoord,
    analyzer: createDistributedRuntimeForensicAnalyzer({ queue, workerCoordinator: workerCoord }),
  };
}

describe('DistributedRuntimeForensicAnalyzer — analyze', () => {
  test('no queue history → 100/100 scores with empty notes', async () => {
    const h = await buildHarness();
    const r = await h.analyzer.analyze({ executionId: 'exec_unknown' });
    expect(r.ownershipContinuityAssessment.score).toBe(100);
    expect(r.queueReplayIntegrityAssessment.score).toBe(100);
    expect(r.workerFailoverAssessment.score).toBe(100);
    expect(r.probableDistributedFailureBoundary).toBeNull();
    expect(r.oneLine).toContain('no queue history');
  });

  test('single happy-path entry → no failure boundary, no ownership transfers', async () => {
    const h = await buildHarness();
    await h.workerCoord.register({ workerId: 'w', workerKind: 'queue_worker', capabilities: [] });
    await h.queue.enqueue({ executionId: 'exec_ok', companyId: 'co', kind: 'execution_start' });
    await h.queue.claim({ workerId: 'w' });
    const r = await h.analyzer.analyze({ executionId: 'exec_ok' });
    expect(r.ownershipContinuityAssessment.ownershipTransfers).toBe(0);
    expect(r.queueReplayIntegrityAssessment.deadLetterCount).toBe(0);
    expect(r.workerFailoverAssessment.failoverEvents).toBe(0);
  });

  test('dead-letter shows up in queueReplayIntegrityAssessment', async () => {
    const h = await buildHarness();
    await h.workerCoord.register({ workerId: 'w', workerKind: 'queue_worker', capabilities: [] });
    const e = await h.queue.enqueue({
      executionId: 'exec_dl', companyId: 'co', kind: 'execution_start', maxAttempts: 2,
    });
    // Force dead-letter.
    for (let i = 0; i < 5; i += 1) {
      const cl = await h.queue.claim({ workerId: 'w', nowMs: Date.now() + i * 1_000_000 });
      if (cl.length === 0) break;
      await h.queue.ack({
        queueEntryId: e.queueEntryId, workerId: 'w',
        outcome: 'failed', retryAfterMs: 1,
      });
    }
    const r = await h.analyzer.analyze({ executionId: 'exec_dl' });
    expect(r.queueReplayIntegrityAssessment.deadLetterCount).toBeGreaterThanOrEqual(1);
    expect(r.queueReplayIntegrityAssessment.score).toBeLessThan(100);
  });

  test('dead worker shows up in workerFailoverAssessment', async () => {
    const h = await buildHarness();
    await h.workerCoord.register({ workerId: 'w_alive', workerKind: 'queue_worker', capabilities: [] });
    await h.queue.enqueue({ executionId: 'exec_dead_owner', companyId: 'co', kind: 'execution_start' });
    await h.queue.claim({ workerId: 'w_alive' });
    // Mark the worker offline.
    await h.workerCoord.offline('w_alive');
    const r = await h.analyzer.analyze({ executionId: 'exec_dead_owner' });
    expect(r.workerFailoverAssessment.suspectedDeadWorkers).toContain('w_alive');
    expect(r.workerFailoverAssessment.failoverEvents).toBeGreaterThanOrEqual(1);
  });
});

describe('DistributedRuntimeForensicAnalyzer — compareDistributedRuns', () => {
  test('identical-shape runs score 100', async () => {
    const h = await buildHarness();
    await h.workerCoord.register({ workerId: 'w_canonical', workerKind: 'queue_worker', capabilities: [] });
    await h.workerCoord.register({ workerId: 'w_recovered', workerKind: 'queue_worker', capabilities: [] });
    const a = await h.queue.enqueue({ executionId: 'canon', companyId: 'co', kind: 'execution_start' });
    await h.queue.claim({ workerId: 'w_canonical' });
    await h.queue.ack({ queueEntryId: a.queueEntryId, workerId: 'w_canonical', outcome: 'completed' });
    const b = await h.queue.enqueue({ executionId: 'reco', companyId: 'co', kind: 'execution_start' });
    await h.queue.claim({ workerId: 'w_recovered' });
    await h.queue.ack({ queueEntryId: b.queueEntryId, workerId: 'w_recovered', outcome: 'completed' });
    const cmp = await h.analyzer.compareDistributedRuns({
      canonicalExecutionId: 'canon', recoveredExecutionId: 'reco',
    });
    expect(cmp.score).toBe(100);
    expect(cmp.matchedQueueEvents).toBeGreaterThan(0);
  });

  test('divergent owners surface in notes', async () => {
    const h = await buildHarness();
    await h.workerCoord.register({ workerId: 'w_a', workerKind: 'queue_worker', capabilities: [] });
    await h.workerCoord.register({ workerId: 'w_b', workerKind: 'queue_worker', capabilities: [] });
    await h.queue.enqueue({ executionId: 'canon', companyId: 'co', kind: 'execution_start' });
    await h.queue.claim({ workerId: 'w_a' });
    await h.queue.enqueue({ executionId: 'reco', companyId: 'co', kind: 'execution_start' });
    await h.queue.claim({ workerId: 'w_b' });
    const cmp = await h.analyzer.compareDistributedRuns({
      canonicalExecutionId: 'canon', recoveredExecutionId: 'reco',
    });
    expect(cmp.divergentOwners).toContain('w_b');
  });
});
