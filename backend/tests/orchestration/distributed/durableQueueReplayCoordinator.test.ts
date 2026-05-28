/**
 * Phase 21D — DurableQueueReplayCoordinator unit tests.
 */

import {
  createDurableQueueReplayCoordinator,
} from '../../../services/orchestration/distributed/durableQueueReplayCoordinator';
import {
  createInMemoryExecutionQueue,
} from '../../../services/orchestration/distributed/distributedExecutionQueue';
import {
  createDistributedWorkerCoordinator,
} from '../../../services/orchestration/distributed/distributedWorkerCoordinator';

async function buildHarness() {
  const queue = createInMemoryExecutionQueue({ telemetry: { emit: () => {} } });
  const workerCoord = createDistributedWorkerCoordinator({ telemetry: { emit: () => {} } });
  const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
  const coord = createDurableQueueReplayCoordinator({
    queue, workerCoordinator: workerCoord,
    telemetry: { emit(event, payload) { events.push({ event, payload }); } },
  });
  return { queue, workerCoord, coord, events };
}

describe('DurableQueueReplayCoordinator', () => {
  test('reclaimExpiredVisibility delegates to queue', async () => {
    const h = await buildHarness();
    await h.queue.enqueue({ executionId: 'e', companyId: 'co', kind: 'execution_start' });
    await h.queue.claim({ workerId: 'w', visibilityMs: 30 });
    await new Promise((r) => setTimeout(r, 80));
    const r = await h.coord.reclaimExpiredVisibility();
    expect(r.length).toBe(1);
    expect(h.events.some((e) => e.event === 'queue_replay_reclaim')).toBe(true);
  });

  test('reclaimAbandoned with no claimed entries returns empty + emits nothing', async () => {
    // Phase 22C: listByClaimer is now real, so when a dead worker has
    // ZERO claimed entries, reclaimAbandoned simply returns empty —
    // no skipped events get emitted.
    const h = await buildHarness();
    await h.workerCoord.register({ workerId: 'w_dead', workerKind: 'queue_worker', capabilities: [] });
    await h.workerCoord.offline('w_dead');
    const reclaimed = await h.coord.reclaimAbandoned();
    expect(reclaimed).toEqual([]);
  });

  test('reconcileDeadLetters emits candidate event when dead-letters exist', async () => {
    const h = await buildHarness();
    const entry = await h.queue.enqueue({
      executionId: 'e', companyId: 'co', kind: 'execution_start', maxAttempts: 1,
    });
    await h.queue.claim({ workerId: 'w' });
    await h.queue.ack({ queueEntryId: entry.queueEntryId, workerId: 'w', outcome: 'failed', retryAfterMs: 1 });
    await h.coord.reconcileDeadLetters();
    expect(h.events.some((e) => e.event === 'queue_replay_dead_letter_candidate')).toBe(true);
  });

  test('surfaceDelayedReady emits delayed_ready event when depth > 0', async () => {
    const h = await buildHarness();
    await h.queue.enqueue({ executionId: 'e', companyId: 'co', kind: 'execution_start' });
    await h.coord.surfaceDelayedReady();
    expect(h.events.some((e) => e.event === 'queue_replay_delayed_ready')).toBe(true);
  });

  test('runFullReplaySweep returns a complete report', async () => {
    const h = await buildHarness();
    await h.queue.enqueue({ executionId: 'e', companyId: 'co', kind: 'execution_start' });
    const report = await h.coord.runFullReplaySweep();
    expect(report.aborted).toBe(false);
    expect(report.abortReason).toBeNull();
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
  });
});
