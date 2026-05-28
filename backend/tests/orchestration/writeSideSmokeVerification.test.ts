/**
 * Phase 18C — write-side smoke verification tests.
 *
 * Uses faked SupabaseExecutionStore / SupabaseCheckpointStore /
 * SupabaseLeaseStore instances so we can:
 *   - validate the happy path runs all stages + cleanup
 *   - validate failure mid-probe still attempts cleanup
 *   - validate cleanup failure surfaces in telemetry
 *   - validate skip flags short-circuit cleanly
 */

import {
  runWriteSideSmokeVerification,
  WriteSmokeVerificationError,
  WRITE_SMOKE_COMPANY_ID,
  WRITE_SMOKE_EXECUTION_PREFIX,
  type WriteSmokeTelemetrySink,
} from '../../services/orchestration/persistence/writeSideSmokeVerification';
import { SupabaseExecutionStore } from '../../services/orchestration/persistence/supabaseExecutionStore';
import { SupabaseCheckpointStore } from '../../services/orchestration/persistence/supabaseCheckpointStore';
import { SupabaseLeaseStore } from '../../services/orchestration/persistence/supabaseLeaseStore';
import type {
  ExecutionRecord,
  ExecutionCheckpoint,
  ExecutionLease,
} from '../../services/threadRuntime/threadRuntimeTypes';

interface FakeBundle {
  executionStore: SupabaseExecutionStore;
  checkpointStore: SupabaseCheckpointStore;
  leaseStore: SupabaseLeaseStore;
  createExecution: jest.Mock;
  updateExecution: jest.Mock;
  appendCheckpoint: jest.Mock;
  checkpointExists: jest.Mock;
  acquireLease: jest.Mock;
  releaseLease: jest.Mock;
  cleanupDelete: jest.Mock;
}

function buildBundle(overrides?: {
  updateReturns?: ExecutionRecord | null;
  acquireReturns?: ExecutionLease | null;
  checkpointExistsReturns?: boolean;
  appendThrows?: Error;
  cleanupThrows?: Error;
}): FakeBundle {
  const cleanupDelete = jest.fn(async () => ({ error: overrides?.cleanupThrows ? { message: overrides.cleanupThrows.message } : null }));
  const fakeClient = {
    from(_table: string) {
      return {
        delete() {
          return {
            eq(_col: string, _value: string) { return cleanupDelete(); },
          };
        },
      };
    },
  } as unknown as { from: (t: string) => unknown };

  const createExecution = jest.fn(async (r: ExecutionRecord): Promise<ExecutionRecord> => r);
  const updateExecution = jest.fn(async (_id: string, patch: Partial<ExecutionRecord>): Promise<ExecutionRecord | null> => {
    if (overrides?.updateReturns === null) return null;
    if (overrides?.updateReturns) return overrides.updateReturns;
    return {
      executionId: 'fake', runtimeSessionId: 'rs', threadId: 'thr',
      companyId: WRITE_SMOKE_COMPANY_ID, orchestrationPhase: 'precheck',
      executionStatus: (patch.executionStatus ?? 'running') as 'running',
      executionOwner: null, retryCount: 0, recoveryState: 'idle',
      startedAt: '2026-05-26T00:00:00.000Z', heartbeatAt: null,
      completedAt: null, failureReason: null, replayCheckpointId: null,
    };
  });

  const executionStore = {
    createExecution,
    updateExecution,
    client: fakeClient,
  } as unknown as SupabaseExecutionStore;

  const appendCheckpoint = jest.fn(async (cp: ExecutionCheckpoint): Promise<ExecutionCheckpoint> => {
    if (overrides?.appendThrows) throw overrides.appendThrows;
    return cp;
  });
  const checkpointExists = jest.fn(async (_id: string): Promise<boolean> => overrides?.checkpointExistsReturns ?? true);
  const checkpointStore = { appendCheckpoint, checkpointExists } as unknown as SupabaseCheckpointStore;

  const acquireLease = jest.fn(async (input: { executionId: string; workerId: string; durationMs: number }): Promise<ExecutionLease | null> => {
    if (overrides?.acquireReturns !== undefined) return overrides.acquireReturns;
    return {
      leaseId: 'lease_fake', executionId: input.executionId, ownerWorkerId: input.workerId,
      acquiredAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + input.durationMs).toISOString(),
      released: false,
    };
  });
  const releaseLease = jest.fn(async (_leaseId: string) => undefined);
  const leaseStore = { acquireLease, releaseLease } as unknown as SupabaseLeaseStore;

  return {
    executionStore, checkpointStore, leaseStore,
    createExecution, updateExecution,
    appendCheckpoint, checkpointExists,
    acquireLease, releaseLease,
    cleanupDelete,
  };
}

function recordingSink() {
  const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
  const sink: WriteSmokeTelemetrySink = {
    emit(event, payload) { events.push({ event, payload }); },
  };
  return { sink, events };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('runWriteSideSmokeVerification — happy path', () => {
  test('runs all stages and cleans up', async () => {
    const bundle = buildBundle();
    const { sink, events } = recordingSink();
    const result = await runWriteSideSmokeVerification({
      executionStore: bundle.executionStore,
      checkpointStore: bundle.checkpointStore,
      leaseStore: bundle.leaseStore,
      telemetry: sink,
    });
    expect(result.passed).toBe(true);
    expect(result.stagesCompleted).toEqual([
      'insert_execution', 'update_execution',
      'append_checkpoint', 'readback_checkpoint',
      'acquire_lease', 'release_lease',
    ]);
    expect(result.cleanupSucceeded).toBe(true);
    expect(bundle.createExecution).toHaveBeenCalledTimes(1);
    expect(bundle.updateExecution).toHaveBeenCalledTimes(1);
    expect(bundle.appendCheckpoint).toHaveBeenCalledTimes(1);
    expect(bundle.acquireLease).toHaveBeenCalledTimes(1);
    expect(bundle.releaseLease).toHaveBeenCalledTimes(1);
    expect(bundle.cleanupDelete).toHaveBeenCalledTimes(1);
    expect(events.some((e) => e.event === 'write_smoke_test_passed')).toBe(true);
    // Sentinel companyId was used:
    const inserted = bundle.createExecution.mock.calls[0][0] as ExecutionRecord;
    expect(inserted.companyId).toBe(WRITE_SMOKE_COMPANY_ID);
    expect(inserted.executionId.startsWith(WRITE_SMOKE_EXECUTION_PREFIX)).toBe(true);
  });
});

describe('runWriteSideSmokeVerification — partial probe modes', () => {
  test('skipCheckpoint short-circuits the checkpoint stage', async () => {
    const bundle = buildBundle();
    const result = await runWriteSideSmokeVerification({
      executionStore: bundle.executionStore,
      leaseStore: bundle.leaseStore,
      skipCheckpoint: true,
    });
    expect(result.passed).toBe(true);
    expect(result.checkpointId).toBeNull();
    expect(result.stagesCompleted).not.toContain('append_checkpoint');
    expect(bundle.appendCheckpoint).not.toHaveBeenCalled();
  });

  test('skipLease short-circuits the lease stage', async () => {
    const bundle = buildBundle();
    const result = await runWriteSideSmokeVerification({
      executionStore: bundle.executionStore,
      checkpointStore: bundle.checkpointStore,
      skipLease: true,
    });
    expect(result.passed).toBe(true);
    expect(result.leaseId).toBeNull();
    expect(result.stagesCompleted).not.toContain('acquire_lease');
    expect(bundle.acquireLease).not.toHaveBeenCalled();
  });
});

describe('runWriteSideSmokeVerification — failure paths', () => {
  test('update returning null throws NOT_FOUND but still attempts cleanup', async () => {
    const bundle = buildBundle({ updateReturns: null });
    await expect(runWriteSideSmokeVerification({
      executionStore: bundle.executionStore,
      checkpointStore: bundle.checkpointStore,
      leaseStore: bundle.leaseStore,
    })).rejects.toMatchObject({
      name: 'WriteSmokeVerificationError',
      code: 'NOT_FOUND',
    });
    expect(bundle.cleanupDelete).toHaveBeenCalledTimes(1);
  });

  test('checkpoint append failure surfaces with stage context + still cleans up', async () => {
    const bundle = buildBundle({ appendThrows: new Error('rls blocked') });
    await expect(runWriteSideSmokeVerification({
      executionStore: bundle.executionStore,
      checkpointStore: bundle.checkpointStore,
      leaseStore: bundle.leaseStore,
    })).rejects.toBeInstanceOf(WriteSmokeVerificationError);
    expect(bundle.cleanupDelete).toHaveBeenCalledTimes(1);
  });

  test('lease ALREADY_HELD throws but cleans up', async () => {
    const bundle = buildBundle({ acquireReturns: null });
    await expect(runWriteSideSmokeVerification({
      executionStore: bundle.executionStore,
      checkpointStore: bundle.checkpointStore,
      leaseStore: bundle.leaseStore,
    })).rejects.toMatchObject({ code: 'ALREADY_HELD' });
    expect(bundle.cleanupDelete).toHaveBeenCalledTimes(1);
  });

  test('cleanup failure emits cleanup_failed telemetry but still throws original error', async () => {
    const bundle = buildBundle({
      updateReturns: null,
      cleanupThrows: new Error('cleanup db down'),
    });
    const { sink, events } = recordingSink();
    await expect(runWriteSideSmokeVerification({
      executionStore: bundle.executionStore,
      checkpointStore: bundle.checkpointStore,
      leaseStore: bundle.leaseStore,
      telemetry: sink,
    })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(events.some((e) => e.event === 'write_smoke_test_cleanup_failed')).toBe(true);
  });
});
