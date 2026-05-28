/**
 * Phase 19B — CheckpointRestorationEngine unit tests.
 *
 * Hermetic: uses the in-memory execution store. No DB, no network.
 */

import {
  createCheckpointRestorationEngine,
  CheckpointRestorationError,
  type CheckpointRestoreTelemetrySink,
} from '../../../services/orchestration/recovery/checkpointRestorationEngine';
import { createInMemoryExecutionStore } from '../../../services/threadRuntime/executionStore';
import type { ExecutionCheckpoint } from '../../../services/threadRuntime/threadRuntimeTypes';

function recordingSink(): { sink: CheckpointRestoreTelemetrySink; events: Array<{ event: string; payload: Record<string, unknown> }> } {
  const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
  return { events, sink: { emit(event, payload) { events.push({ event, payload }); } } };
}

async function seedExec(store: ReturnType<typeof createInMemoryExecutionStore>, id = 'exec_1') {
  await store.createExecution({
    executionId: id,
    runtimeSessionId: 'rs', threadId: 'thr',
    companyId: '00000000-0000-0000-0000-000000000001',
    orchestrationPhase: 'precheck',
    executionStatus: 'pending',
    executionOwner: null,
    retryCount: 0,
    recoveryState: 'idle',
    startedAt: '2026-05-26T00:00:00.000Z',
    heartbeatAt: null,
    completedAt: null,
    failureReason: null,
    replayCheckpointId: null,
  });
  return id;
}

function cp(over: Partial<ExecutionCheckpoint>): ExecutionCheckpoint {
  return {
    checkpointId: 'cp_x',
    executionId: 'exec_1',
    takenAt: '2026-05-26T00:00:00.000Z',
    phase: 'generation',
    completedNodeOperationIds: [],
    pendingNodeOperationIds: [],
    pendingTopologyMutationIds: [],
    recoveryProgress: null,
    replayContinuity: null,
    ...over,
  };
}

describe('CheckpointRestorationEngine — basic restore', () => {
  test('empty chain returns missing status with score 0', async () => {
    const store = createInMemoryExecutionStore();
    await seedExec(store);
    const engine = createCheckpointRestorationEngine({ store, telemetry: recordingSink().sink });
    const out = await engine.restore('exec_1');
    expect(out.chain).toHaveLength(0);
    expect(out.integrity.status).toBe('missing');
    expect(out.integrity.integrityScore).toBe(0);
    expect(out.phase).toBeNull();
  });

  test('single intact checkpoint returns intact status', async () => {
    const store = createInMemoryExecutionStore();
    await seedExec(store);
    await store.recordCheckpoint(cp({
      checkpointId: 'cp_1', takenAt: '2026-05-26T01:00:00.000Z',
      phase: 'generation', completedNodeOperationIds: ['n1'],
      pendingNodeOperationIds: ['n2'],
    }));
    const engine = createCheckpointRestorationEngine({ store, telemetry: recordingSink().sink });
    const out = await engine.restore('exec_1');
    expect(out.integrity.status).toBe('intact');
    expect(out.integrity.integrityScore).toBe(100);
    expect(out.completedNodeOperationIds).toEqual(['n1']);
    expect(out.pendingNodeOperationIds).toEqual(['n2']);
    expect(out.latestCheckpointId).toBe('cp_1');
  });
});

describe('CheckpointRestorationEngine — coalescing', () => {
  test('multiple checkpoints coalesce completed sets', async () => {
    const store = createInMemoryExecutionStore();
    await seedExec(store);
    await store.recordCheckpoint(cp({
      checkpointId: 'cp_a', takenAt: '2026-05-26T01:00:00.000Z',
      completedNodeOperationIds: ['n1'], pendingNodeOperationIds: ['n2', 'n3'],
    }));
    await store.recordCheckpoint(cp({
      checkpointId: 'cp_b', takenAt: '2026-05-26T02:00:00.000Z',
      completedNodeOperationIds: ['n2'], pendingNodeOperationIds: ['n3'],
    }));
    const engine = createCheckpointRestorationEngine({ store, telemetry: recordingSink().sink });
    const out = await engine.restore('exec_1');
    expect(out.completedNodeOperationIds.sort()).toEqual(['n1', 'n2']);
    expect(out.pendingNodeOperationIds).toEqual(['n3']);
    expect(out.latestCheckpointId).toBe('cp_b');
  });

  test('deterministic chain ordering: taken_at ASC, checkpoint_id ASC tiebreak', async () => {
    const store = createInMemoryExecutionStore();
    await seedExec(store);
    // Insert in reverse order; restoration must sort.
    await store.recordCheckpoint(cp({ checkpointId: 'cp_b', takenAt: '2026-05-26T02:00:00.000Z' }));
    await store.recordCheckpoint(cp({ checkpointId: 'cp_a', takenAt: '2026-05-26T01:00:00.000Z' }));
    const engine = createCheckpointRestorationEngine({ store, telemetry: recordingSink().sink });
    const out = await engine.restore('exec_1');
    expect(out.chain.map((c) => c.checkpointId)).toEqual(['cp_a', 'cp_b']);
  });
});

describe('CheckpointRestorationEngine — integrity detection', () => {
  test('node id in both completed and pending flags partial', async () => {
    const store = createInMemoryExecutionStore();
    await seedExec(store);
    await store.recordCheckpoint(cp({
      checkpointId: 'cp_bad', takenAt: '2026-05-26T01:00:00.000Z',
      completedNodeOperationIds: ['nA'], pendingNodeOperationIds: ['nA', 'nB'],
    }));
    const engine = createCheckpointRestorationEngine({ store, telemetry: recordingSink().sink });
    const out = await engine.restore('exec_1');
    expect(out.integrity.issues.length).toBeGreaterThanOrEqual(1);
    expect(out.integrity.status).toBe('partial');
    expect(out.integrity.integrityScore).toBeLessThan(100);
  });

  test('phase regression (not recovery) flags an issue', async () => {
    const store = createInMemoryExecutionStore();
    await seedExec(store);
    await store.recordCheckpoint(cp({ checkpointId: 'cp_1', takenAt: '2026-05-26T01:00:00.000Z', phase: 'persistence' }));
    await store.recordCheckpoint(cp({ checkpointId: 'cp_2', takenAt: '2026-05-26T02:00:00.000Z', phase: 'generation' }));
    const engine = createCheckpointRestorationEngine({ store, telemetry: recordingSink().sink });
    const out = await engine.restore('exec_1');
    expect(out.integrity.issues.some((i) => i.includes('phase regression'))).toBe(true);
  });

  test('phase descent into recovery is allowed (not flagged)', async () => {
    const store = createInMemoryExecutionStore();
    await seedExec(store);
    await store.recordCheckpoint(cp({ checkpointId: 'cp_1', takenAt: '2026-05-26T01:00:00.000Z', phase: 'persistence' }));
    await store.recordCheckpoint(cp({ checkpointId: 'cp_2', takenAt: '2026-05-26T02:00:00.000Z', phase: 'recovery' }));
    const engine = createCheckpointRestorationEngine({ store, telemetry: recordingSink().sink });
    const out = await engine.restore('exec_1');
    expect(out.integrity.issues.some((i) => i.includes('phase regression'))).toBe(false);
  });
});

describe('CheckpointRestorationEngine — telemetry + rejection', () => {
  test('emits success event with chain length + integrity score', async () => {
    const store = createInMemoryExecutionStore();
    await seedExec(store);
    await store.recordCheckpoint(cp({ checkpointId: 'cp_1', takenAt: '2026-05-26T01:00:00.000Z' }));
    const { sink, events } = recordingSink();
    const engine = createCheckpointRestorationEngine({ store, telemetry: sink });
    await engine.restore('exec_1');
    const success = events.find((e) => e.event === 'checkpoint_restore_success');
    expect(success).toBeDefined();
    expect((success!.payload as { chainLength: number }).chainLength).toBe(1);
  });

  test('rejectBelowIntegrityScore throws when integrity is too low', async () => {
    const store = createInMemoryExecutionStore();
    await seedExec(store);
    await store.recordCheckpoint(cp({
      checkpointId: 'cp_bad', takenAt: '2026-05-26T01:00:00.000Z',
      completedNodeOperationIds: ['nA'], pendingNodeOperationIds: ['nA'],
    }));
    const engine = createCheckpointRestorationEngine({
      store, telemetry: recordingSink().sink, rejectBelowIntegrityScore: 95,
    });
    await expect(engine.restore('exec_1')).rejects.toBeInstanceOf(CheckpointRestorationError);
  });
});
