/**
 * Phase 20B — DistributedWorkerCoordinator unit tests.
 */

import {
  createDistributedWorkerCoordinator,
  type WorkerCoordinatorTelemetrySink,
} from '../../../services/orchestration/distributed/distributedWorkerCoordinator';

function sink(): { sink: WorkerCoordinatorTelemetrySink; events: Array<{ event: string; payload: Record<string, unknown> }> } {
  const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
  return { events, sink: { emit(event, payload) { events.push({ event, payload }); } } };
}

describe('DistributedWorkerCoordinator — registration', () => {
  test('register creates an active worker', async () => {
    const c = createDistributedWorkerCoordinator({ telemetry: sink().sink });
    const w = await c.register({
      workerId: 'w_1', workerKind: 'queue_worker', capabilities: [{ name: 'all' }],
    });
    expect(w.status).toBe('active');
    expect(w.workerId).toBe('w_1');
    expect(w.activeExecutionCount).toBe(0);
  });

  test('register is idempotent on same workerId', async () => {
    const c = createDistributedWorkerCoordinator({ telemetry: sink().sink });
    const a = await c.register({ workerId: 'w_1', workerKind: 'queue_worker', capabilities: [] });
    const b = await c.register({
      workerId: 'w_1', workerKind: 'queue_worker', capabilities: [{ name: 'updated' }],
    });
    expect(b.workerId).toBe(a.workerId);
    expect(b.capabilities[0]?.name).toBe('updated');
  });
});

describe('DistributedWorkerCoordinator — heartbeat + lifecycle', () => {
  test('heartbeat updates heartbeatAt + counters', async () => {
    const c = createDistributedWorkerCoordinator({ telemetry: sink().sink });
    await c.register({ workerId: 'w', workerKind: 'queue_worker', capabilities: [] });
    const beat = await c.heartbeat({ workerId: 'w', activeExecutionCount: 3, recoveryLoad: 1 });
    expect(beat?.activeExecutionCount).toBe(3);
    expect(beat?.recoveryLoad).toBe(1);
  });

  test('heartbeat after stale resurrects to active', async () => {
    const c = createDistributedWorkerCoordinator({ telemetry: sink().sink, defaultStaleThresholdMs: 50 });
    await c.register({ workerId: 'w', workerKind: 'queue_worker', capabilities: [] });
    await new Promise((r) => setTimeout(r, 80));
    await c.sweepStale();
    const after = await c.get('w');
    expect(after?.status).toBe('stale');
    const beat = await c.heartbeat({ workerId: 'w' });
    expect(beat?.status).toBe('active');
  });

  test('drain flips to draining + records timestamp', async () => {
    const c = createDistributedWorkerCoordinator({ telemetry: sink().sink });
    await c.register({ workerId: 'w', workerKind: 'queue_worker', capabilities: [] });
    const d = await c.drain('w');
    expect(d?.status).toBe('draining');
    expect(d?.drainStartedAtIso).not.toBeNull();
  });

  test('offline marks worker offline (idempotent)', async () => {
    const c = createDistributedWorkerCoordinator({ telemetry: sink().sink });
    await c.register({ workerId: 'w', workerKind: 'queue_worker', capabilities: [] });
    await c.offline('w');
    const w1 = await c.get('w');
    expect(w1?.status).toBe('offline');
    await c.offline('w'); // idempotent
    const w2 = await c.get('w');
    expect(w2?.offlineAtIso).toBe(w1?.offlineAtIso); // unchanged
  });
});

describe('DistributedWorkerCoordinator — counters + sweep', () => {
  test('noteExecutionStarted/Finished tracks active count', async () => {
    const c = createDistributedWorkerCoordinator({ telemetry: sink().sink });
    await c.register({ workerId: 'w', workerKind: 'queue_worker', capabilities: [] });
    await c.noteExecutionStarted('w');
    await c.noteExecutionStarted('w');
    expect((await c.get('w'))?.activeExecutionCount).toBe(2);
    await c.noteExecutionFinished('w');
    expect((await c.get('w'))?.activeExecutionCount).toBe(1);
    // Floors at 0.
    await c.noteExecutionFinished('w');
    await c.noteExecutionFinished('w');
    expect((await c.get('w'))?.activeExecutionCount).toBe(0);
  });

  test('sweepStale flips workers whose heartbeat is older than threshold', async () => {
    const c = createDistributedWorkerCoordinator({
      telemetry: sink().sink, defaultStaleThresholdMs: 30,
    });
    await c.register({ workerId: 'w_stale', workerKind: 'queue_worker', capabilities: [] });
    await new Promise((r) => setTimeout(r, 60));
    await c.register({ workerId: 'w_fresh', workerKind: 'queue_worker', capabilities: [] });
    const r = await c.sweepStale();
    expect(r.markedStale).toContain('w_stale');
    expect(r.markedStale).not.toContain('w_fresh');
  });

  test('list filters by status + kind', async () => {
    const c = createDistributedWorkerCoordinator({ telemetry: sink().sink });
    await c.register({ workerId: 'q1', workerKind: 'queue_worker', capabilities: [] });
    await c.register({ workerId: 'q2', workerKind: 'queue_worker', capabilities: [] });
    await c.register({ workerId: 'r1', workerKind: 'recovery_worker', capabilities: [] });
    await c.drain('q1');
    const drainingQs = await c.list({ status: 'draining', kind: 'queue_worker' });
    expect(drainingQs.map((w) => w.workerId)).toEqual(['q1']);
  });
});
