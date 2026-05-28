/**
 * Phase 21H — durableDistributedRuntimeDiagnostics tests.
 */

import {
  recordEvent,
  getDurableDistributedRuntimeSnapshot,
  _resetDurableDistributedRuntimeDiagnostics,
  durableDistributedRuntimeTelemetrySink,
} from '../../../services/orchestration/distributed/durableDistributedRuntimeDiagnostics';

beforeEach(() => { _resetDurableDistributedRuntimeDiagnostics(); });

describe('durableDistributedRuntimeDiagnostics — queue latency', () => {
  test('enqueue → claim records queue persistence latency', async () => {
    recordEvent('execution_enqueued', { queueEntryId: 'qe', executionId: 'e' });
    await new Promise((r) => setTimeout(r, 5));
    recordEvent('execution_claimed', { queueEntryId: 'qe', executionId: 'e', workerId: 'w' });
    const s = getDurableDistributedRuntimeSnapshot();
    expect(s.queuePersistenceLatency.count).toBe(1);
    expect(s.queuePersistenceLatency.lastMs).toBeGreaterThanOrEqual(1);
  });

  test('claim → complete records atomic claim latency', async () => {
    recordEvent('execution_claimed', { queueEntryId: 'qe', executionId: 'e', workerId: 'w' });
    await new Promise((r) => setTimeout(r, 5));
    recordEvent('execution_completed', { queueEntryId: 'qe', executionId: 'e', workerId: 'w' });
    const s = getDurableDistributedRuntimeSnapshot();
    expect(s.atomicClaimLatency.count).toBe(1);
  });
});

describe('durableDistributedRuntimeDiagnostics — counters', () => {
  test('visibility reclaim event counted', () => {
    recordEvent('execution_visibility_reclaimed', { queueEntryId: 'qe', executionId: 'e' });
    expect(getDurableDistributedRuntimeSnapshot().visibilityReclaimEvents).toBe(1);
  });

  test('dead-letter event counted', () => {
    recordEvent('execution_dead_lettered', { queueEntryId: 'qe', executionId: 'e' });
    expect(getDurableDistributedRuntimeSnapshot().deadLetterEvents).toBe(1);
  });

  test('worker_marked_stale + worker_offline both count as failover', () => {
    recordEvent('worker_marked_stale', { workerId: 'w1' });
    recordEvent('worker_offline', { workerId: 'w2' });
    expect(getDurableDistributedRuntimeSnapshot().workerFailoverEvents).toBe(2);
  });

  test('worker_status_changed to stale/offline counts as failover', () => {
    recordEvent('worker_status_changed', { workerId: 'w', previous: 'active', current: 'stale' });
    recordEvent('worker_status_changed', { workerId: 'w', previous: 'active', current: 'offline' });
    expect(getDurableDistributedRuntimeSnapshot().workerFailoverEvents).toBe(2);
  });

  test('ownership_transfer_succeeded increments cross-instance counter', () => {
    recordEvent('ownership_transfer_succeeded', {
      executionId: 'e', previousOwnerId: 'old', newOwnerId: 'new', reason: 'lease_takeover',
    });
    expect(getDurableDistributedRuntimeSnapshot().crossInstanceOwnershipTransfers).toBe(1);
  });

  test('queue_replay_completed counted; reclaim_count aggregates', () => {
    recordEvent('queue_replay_completed', { reclaimed: 3 });
    recordEvent('queue_replay_reclaim', { count: 5 });
    const s = getDurableDistributedRuntimeSnapshot();
    expect(s.queueReplaySweeps).toBe(1);
    expect(s.visibilityReclaimEvents).toBe(5);
  });

  test('compaction events bump counters per-target', () => {
    recordEvent('compaction_archive_summary', { target: 'queue', deleted: 10 });
    recordEvent('compaction_archive_summary', { target: 'workers', deleted: 4 });
    recordEvent('compaction_archive_summary', { target: 'checkpoints', deleted: 7 });
    recordEvent('compaction_completed', { totalArchived: 21 });
    const s = getDurableDistributedRuntimeSnapshot();
    expect(s.queueArchivedTotal).toBe(10);
    expect(s.workerArchivedTotal).toBe(4);
    expect(s.checkpointArchivedTotal).toBe(7);
    expect(s.queueCompactionEvents).toBe(1);
  });
});

describe('durableDistributedRuntimeDiagnostics — timelines', () => {
  test('distributed queue lifecycle records enqueue + claimed + completed', () => {
    recordEvent('execution_enqueued', { queueEntryId: 'qe', executionId: 'e' });
    recordEvent('execution_claimed', { queueEntryId: 'qe', executionId: 'e', workerId: 'w' });
    recordEvent('execution_completed', { queueEntryId: 'qe', executionId: 'e', workerId: 'w' });
    const s = getDurableDistributedRuntimeSnapshot();
    expect(s.distributedQueueLifecycle.map((e) => e.event)).toEqual(['enqueued', 'claimed', 'completed']);
  });

  test('ownership transfer chain accumulates entries', () => {
    recordEvent('ownership_transfer_succeeded', {
      executionId: 'e1', previousOwnerId: 'a', newOwnerId: 'b', reason: 'lease',
    });
    const s = getDurableDistributedRuntimeSnapshot();
    expect(s.ownershipTransferChain).toHaveLength(1);
    expect(s.ownershipTransferChain[0].toWorkerId).toBe('b');
  });

  test('replay reclamation chain accumulates visibility reclaim events', () => {
    recordEvent('execution_visibility_reclaimed', { queueEntryId: 'qe', executionId: 'e' });
    const s = getDurableDistributedRuntimeSnapshot();
    expect(s.replayReclamationChain).toHaveLength(1);
    expect(s.replayReclamationChain[0].reason).toBe('visibility_expired');
  });
});

describe('durableDistributedRuntimeDiagnostics — sink integration', () => {
  test('sink emit() routes to recordEvent', () => {
    durableDistributedRuntimeTelemetrySink.emit('execution_enqueued', { queueEntryId: 'qe', executionId: 'e' });
    const s = getDurableDistributedRuntimeSnapshot();
    expect(s.distributedQueueLifecycle).toHaveLength(1);
  });

  test('unknown events ignored', () => {
    recordEvent('totally_made_up', { foo: 'bar' });
    expect(getDurableDistributedRuntimeSnapshot().distributedQueueLifecycle).toHaveLength(0);
  });
});
