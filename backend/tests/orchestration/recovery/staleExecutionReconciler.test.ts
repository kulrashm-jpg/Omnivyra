/**
 * Phase 19C — StaleExecutionReconciler unit tests.
 */

import {
  createStaleExecutionReconciler,
} from '../../../services/orchestration/recovery/staleExecutionReconciler';
import {
  createInMemoryExecutionStore,
} from '../../../services/threadRuntime/executionStore';
import {
  createDurableExecutionCoordinator,
} from '../../../services/threadRuntime/durableExecutionCoordinator';

async function startExec(store: ReturnType<typeof createInMemoryExecutionStore>, opts: {
  id: string; status: 'running' | 'pending' | 'recovering' | 'abandoned' | 'waiting';
  heartbeatAtIso?: string; startedAtIso?: string;
  recoveryState?: 'idle' | 'attempting' | 'stabilizing' | 'reconciled' | 'failed';
  retryCount?: number;
}) {
  await store.createExecution({
    executionId: opts.id,
    runtimeSessionId: 'rs', threadId: 'thr',
    companyId: '00000000-0000-0000-0000-000000000001',
    orchestrationPhase: 'precheck',
    executionStatus: opts.status,
    executionOwner: null, retryCount: opts.retryCount ?? 0,
    recoveryState: opts.recoveryState ?? 'idle',
    startedAt: opts.startedAtIso ?? '2026-05-26T00:00:00.000Z',
    heartbeatAt: opts.heartbeatAtIso ?? null,
    completedAt: null, failureReason: null, replayCheckpointId: null,
  });
}

describe('StaleExecutionReconciler — detect', () => {
  test('detects expired lease', async () => {
    const store = createInMemoryExecutionStore();
    await startExec(store, { id: 'exec_1', status: 'running', heartbeatAtIso: '2026-05-26T00:00:00.000Z' });
    await store.acquireLease({ executionId: 'exec_1', workerId: 'w_dead', durationMs: 50, nowMs: 1000 });
    const r = createStaleExecutionReconciler({
      store,
      coordinator: createDurableExecutionCoordinator({ store }),
      telemetry: { emit: () => {} },
      heartbeatStaleMs: 60_000,
    });
    const findings = await r.detect({ nowMs: 5000 });
    expect(findings).toHaveLength(1);
    expect(findings[0].reason).toBe('lease_expired');
    expect(findings[0].currentOwnerWorkerId).toBe('w_dead');
  });

  test('detects heartbeat stale on running execution', async () => {
    const store = createInMemoryExecutionStore();
    const longAgo = new Date(Date.now() - 60_000).toISOString();
    await startExec(store, { id: 'exec_2', status: 'running', heartbeatAtIso: longAgo });
    const r = createStaleExecutionReconciler({
      store,
      coordinator: createDurableExecutionCoordinator({ store }),
      telemetry: { emit: () => {} },
      heartbeatStaleMs: 1_000,
    });
    const findings = await r.detect();
    expect(findings).toHaveLength(1);
    expect(findings[0].reason).toBe('heartbeat_stale');
  });

  test('detects abandoned marker', async () => {
    const store = createInMemoryExecutionStore();
    await startExec(store, { id: 'exec_3', status: 'abandoned' });
    const r = createStaleExecutionReconciler({
      store,
      coordinator: createDurableExecutionCoordinator({ store }),
      telemetry: { emit: () => {} },
    });
    const findings = await r.detect();
    expect(findings).toHaveLength(1);
    expect(findings[0].reason).toBe('abandoned_marker');
  });

  test('healthy executions are NOT flagged', async () => {
    const store = createInMemoryExecutionStore();
    await startExec(store, {
      id: 'exec_healthy', status: 'running',
      heartbeatAtIso: new Date().toISOString(),
    });
    await store.acquireLease({ executionId: 'exec_healthy', workerId: 'w', durationMs: 60_000 });
    const r = createStaleExecutionReconciler({
      store,
      coordinator: createDurableExecutionCoordinator({ store }),
      telemetry: { emit: () => {} },
    });
    const findings = await r.detect();
    expect(findings).toHaveLength(0);
  });
});

describe('StaleExecutionReconciler — chooseAction', () => {
  test('lease_expired → reclaim by default', async () => {
    const store = createInMemoryExecutionStore();
    await startExec(store, { id: 'e', status: 'running' });
    await store.acquireLease({ executionId: 'e', workerId: 'w', durationMs: 50, nowMs: 1000 });
    const r = createStaleExecutionReconciler({
      store,
      coordinator: createDurableExecutionCoordinator({ store }),
      telemetry: { emit: () => {} },
    });
    const [f] = await r.detect({ nowMs: 5000 });
    expect(r.chooseAction(f)).toBe('reclaim');
  });

  test('exhausted retryCount → mark_failed', async () => {
    const store = createInMemoryExecutionStore();
    await startExec(store, { id: 'e', status: 'running', retryCount: 99 });
    await store.acquireLease({ executionId: 'e', workerId: 'w', durationMs: 50, nowMs: 1000 });
    const r = createStaleExecutionReconciler({
      store,
      coordinator: createDurableExecutionCoordinator({ store }),
      telemetry: { emit: () => {} },
      maxRetryCount: 3,
    });
    const [f] = await r.detect({ nowMs: 5000 });
    expect(r.chooseAction(f)).toBe('mark_failed');
  });

  test('recovery_stalled → reopen', async () => {
    const store = createInMemoryExecutionStore();
    const longAgo = new Date(Date.now() - 60_000).toISOString();
    await startExec(store, {
      id: 'e', status: 'recovering',
      heartbeatAtIso: longAgo, recoveryState: 'attempting',
    });
    const r = createStaleExecutionReconciler({
      store,
      coordinator: createDurableExecutionCoordinator({ store }),
      telemetry: { emit: () => {} },
      recoveryStalledMs: 1_000,
      heartbeatStaleMs: 60_000_000, // ensure recovery_stalled wins over heartbeat_stale
    });
    const [f] = await r.detect();
    expect(f.reason).toBe('recovery_stalled');
    expect(r.chooseAction(f)).toBe('reopen');
  });
});

describe('StaleExecutionReconciler — apply', () => {
  test('mark_failed action transitions to failed', async () => {
    const store = createInMemoryExecutionStore();
    await startExec(store, { id: 'e', status: 'running', retryCount: 10 });
    const coordinator = createDurableExecutionCoordinator({ store });
    const r = createStaleExecutionReconciler({
      store, coordinator, telemetry: { emit: () => {} }, maxRetryCount: 3,
    });
    await store.acquireLease({ executionId: 'e', workerId: 'w', durationMs: 50, nowMs: 1000 });
    const [f] = await r.detect({ nowMs: 5000 });
    await r.apply(f, 'mark_failed');
    const after = await store.getExecution('e');
    expect(after?.executionStatus).toBe('failed');
  });

  test('dryRun mode does not mutate', async () => {
    const store = createInMemoryExecutionStore();
    await startExec(store, { id: 'e', status: 'abandoned' });
    const coordinator = createDurableExecutionCoordinator({ store });
    const r = createStaleExecutionReconciler({
      store, coordinator, telemetry: { emit: () => {} },
    });
    await r.reconcile({ dryRun: true });
    const after = await store.getExecution('e');
    expect(after?.executionStatus).toBe('abandoned'); // unchanged
  });
});
