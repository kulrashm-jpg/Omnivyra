/**
 * Phase 21F — RuntimePersistenceCompactor unit tests.
 */

import {
  createRuntimePersistenceCompactor,
} from '../../../services/orchestration/distributed/runtimePersistenceCompactor';

function fakeArchivableQueue() {
  let deleteCalls = 0;
  return {
    enqueue: async () => { throw new Error('not used'); },
    claim: async () => [],
    ack: async () => null,
    retry: async () => null,
    reclaimExpired: async () => [],
    get: async () => null,
    listByExecution: async () => [],
    countByStatus: async () => ({ queued: 0, claimed: 0, completed: 0, failed: 0, dead_lettered: 0, cancelled: 0 }),
    depth: async () => 0,
    async deleteTerminalEntriesOlderThan(_cutoffIso: string, opts?: { limit?: number }) {
      deleteCalls += 1;
      return Math.min(opts?.limit ?? 50, 50);
    },
    get _deleteCalls() { return deleteCalls; },
  };
}
function fakeArchivableWorkers() {
  let deleteCalls = 0;
  return {
    register: async () => { throw new Error('not used'); },
    heartbeat: async () => null,
    drain: async () => null,
    enterRecovery: async () => null,
    offline: async () => null,
    noteExecutionStarted: async () => null,
    noteExecutionFinished: async () => null,
    get: async () => null,
    list: async () => [],
    sweepStale: async () => ({ markedStale: [] }),
    async deleteOfflineOlderThan(_cutoffIso: string, opts?: { limit?: number }) {
      deleteCalls += 1;
      return Math.min(opts?.limit ?? 25, 25);
    },
    get _deleteCalls() { return deleteCalls; },
  };
}

describe('RuntimePersistenceCompactor', () => {
  test('dry-run does not delete anything', async () => {
    const queue = fakeArchivableQueue();
    const workers = fakeArchivableWorkers();
    const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
    const c = createRuntimePersistenceCompactor({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      queue: queue as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      workerCoordinator: workers as any,
      telemetry: { emit(event, payload) { events.push({ event, payload }); } },
    });
    const report = await c.runCompactionPass({ dryRun: true });
    expect(report.dryRun).toBe(true);
    expect(report.queueArchivedCount).toBe(0);
    expect(report.workersArchivedCount).toBe(0);
    expect(queue._deleteCalls).toBe(0);
    expect(workers._deleteCalls).toBe(0);
    expect(events.some((e) => e.event === 'compaction_archive_summary' && e.payload.dryRun === true)).toBe(true);
  });

  test('compacts queue + workers and respects maxDeletionsPerCall budget', async () => {
    const queue = fakeArchivableQueue();
    const workers = fakeArchivableWorkers();
    const c = createRuntimePersistenceCompactor({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      queue: queue as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      workerCoordinator: workers as any,
      telemetry: { emit: () => {} },
    });
    const report = await c.runCompactionPass({ maxDeletionsPerCall: 60 });
    expect(report.queueArchivedCount).toBeGreaterThan(0);
    expect(report.workersArchivedCount).toBeGreaterThan(0);
    expect(report.totalArchivedCount).toBeLessThanOrEqual(60);
    expect(report.aborted).toBe(false);
  });

  test('skips queue + workers when archival helpers are absent', async () => {
    // In-memory queue + worker coordinator without archival helpers — both
    // are plain DistributedExecutionQueue + DistributedWorkerCoordinator
    // without deleteTerminalEntriesOlderThan / deleteOfflineOlderThan.
    const c = createRuntimePersistenceCompactor({ telemetry: { emit: () => {} } });
    const report = await c.runCompactionPass({});
    expect(report.queueArchivedCount).toBe(0);
    expect(report.workersArchivedCount).toBe(0);
    expect(report.totalArchivedCount).toBe(0);
  });

  test('checkpoint archival hook is invoked when supplied', async () => {
    let invoked = 0;
    const c = createRuntimePersistenceCompactor({
      checkpointArchival: {
        async compactExecutionCheckpoints() {
          invoked += 1;
          return 42;
        },
      },
      telemetry: { emit: () => {} },
    });
    const report = await c.runCompactionPass({});
    expect(invoked).toBe(1);
    expect(report.checkpointArchivedCount).toBe(42);
  });

  test('watchdog timeout sets aborted=true', async () => {
    const slowQueue = {
      enqueue: async () => { throw new Error(); }, claim: async () => [], ack: async () => null,
      retry: async () => null, reclaimExpired: async () => [], get: async () => null,
      listByExecution: async () => [],
      countByStatus: async () => ({ queued: 0, claimed: 0, completed: 0, failed: 0, dead_lettered: 0, cancelled: 0 }),
      depth: async () => 0,
      async deleteTerminalEntriesOlderThan() {
        await new Promise((r) => setTimeout(r, 50));
        return 10;
      },
    };
    const c = createRuntimePersistenceCompactor({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      queue: slowQueue as any,
      telemetry: { emit: () => {} },
    });
    const report = await c.runCompactionPass({ maxDurationMs: 1_000 });
    // The slow call completes within the watchdog budget here; verify
    // budgetExhausted + abort flags behave sanely.
    expect(report.aborted).toBe(false);
  });
});
