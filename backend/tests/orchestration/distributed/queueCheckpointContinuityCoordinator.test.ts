/**
 * Phase 23E — QueueCheckpointContinuityCoordinator unit tests.
 */

import {
  createQueueCheckpointContinuityCoordinator,
} from '../../../services/orchestration/distributed/queueCheckpointContinuityCoordinator';
import type {
  HydratedQueuePayload,
  QueuePayloadV1,
} from '../../../services/orchestration/distributed/workflowExecutionTypes';

function makeHydrated(opts: {
  executionStatus?: 'pending' | 'running' | 'recovering' | 'waiting' | 'completed' | 'failed' | 'abandoned';
  workflowType?: QueuePayloadV1['workflowType'];
  checkpointRef?: string;
  chain?: string[];
  pending?: string[];
  completed?: string[];
  integrity?: 'intact' | 'partial' | 'corrupted' | 'missing';
}): HydratedQueuePayload {
  const chain = (opts.chain ?? []).map((id) => ({
    checkpointId: id, executionId: 'e',
    takenAt: '2026-01-01T00:00:00Z',
    phase: 'generation' as const,
    completedNodeOperationIds: [], pendingNodeOperationIds: [],
    pendingTopologyMutationIds: [], recoveryProgress: null, replayContinuity: null,
  }));
  return {
    payload: {
      schemaVersion: 1, workflowType: opts.workflowType ?? 'content_generation',
      executionId: 'e', companyId: 'co',
      ...(opts.checkpointRef ? { checkpointReference: { checkpointId: opts.checkpointRef } } : {}),
    },
    queueEntry: {
      queueEntryId: 'qe', executionId: 'e', companyId: 'co',
      kind: 'execution_start', status: 'claimed', priority: 50,
      runAtIso: '2026-01-01T00:00:00Z', visibilityDeadlineIso: null,
      claimedByWorkerId: 'w', attemptCount: 1, maxAttempts: 5,
      dedupKey: 'k', payload: null, resultPayload: null,
      failureReason: null,
      createdAtIso: '2026-01-01T00:00:00Z',
      updatedAtIso: '2026-01-01T00:00:00Z',
    },
    execution: {
      executionId: 'e', runtimeSessionId: 'rs', threadId: 'thr',
      companyId: 'co', orchestrationPhase: 'precheck',
      executionStatus: opts.executionStatus ?? 'running',
      executionOwner: null, retryCount: 0, recoveryState: 'idle',
      startedAt: '2026-01-01T00:00:00Z',
      heartbeatAt: null, completedAt: null,
      failureReason: null, replayCheckpointId: null,
    },
    restored: chain.length > 0 ? {
      executionId: 'e',
      latestCheckpointId: chain[chain.length - 1].checkpointId,
      phase: 'generation',
      completedNodeOperationIds: opts.completed ?? [],
      pendingNodeOperationIds: opts.pending ?? [],
      pendingTopologyMutationIds: [],
      recoveryProgress: null, replayContinuity: null,
      chain,
      integrity: {
        status: opts.integrity ?? 'intact',
        integrityScore: opts.integrity === 'corrupted' ? 0 : 100,
        issues: opts.integrity === 'corrupted' ? ['simulated corruption'] : [],
        phaseTransitions: 0, windowStartIso: null, windowEndIso: null,
      },
    } : null,
  };
}

describe('QueueCheckpointContinuityCoordinator.validate', () => {
  test('execution completed → suppress', () => {
    const c = createQueueCheckpointContinuityCoordinator({ telemetry: { emit: () => {} } });
    const v = c.validate(makeHydrated({ executionStatus: 'completed' }));
    expect(v.code).toBe('execution_completed');
    expect(v.recommendedAction).toBe('suppress');
  });

  test('execution failed → fail', () => {
    const c = createQueueCheckpointContinuityCoordinator({ telemetry: { emit: () => {} } });
    const v = c.validate(makeHydrated({ executionStatus: 'failed' }));
    expect(v.recommendedAction).toBe('fail');
  });

  test('stale payload (checkpointRef not latest) → suppress', () => {
    const c = createQueueCheckpointContinuityCoordinator({ telemetry: { emit: () => {} } });
    const v = c.validate(makeHydrated({
      checkpointRef: 'cp_a',
      chain: ['cp_a', 'cp_b'],
    }));
    expect(v.code).toBe('stale_payload');
    expect(v.recommendedAction).toBe('suppress');
  });

  test('checkpointRef references unknown checkpoint → fail (divergence)', () => {
    const c = createQueueCheckpointContinuityCoordinator({ telemetry: { emit: () => {} } });
    const v = c.validate(makeHydrated({
      checkpointRef: 'cp_nope',
      chain: ['cp_a', 'cp_b'],
    }));
    expect(v.code).toBe('checkpoint_divergence');
    expect(v.recommendedAction).toBe('fail');
  });

  test('replay_continuation with empty pending → duplicate_replay (suppress)', () => {
    const c = createQueueCheckpointContinuityCoordinator({ telemetry: { emit: () => {} } });
    const v = c.validate(makeHydrated({
      workflowType: 'replay_continuation',
      chain: ['cp_a'],
      completed: ['s1', 's2'], pending: [],
    }));
    expect(v.code).toBe('duplicate_replay');
  });

  test('replay_continuation with pending → proceed', () => {
    const c = createQueueCheckpointContinuityCoordinator({ telemetry: { emit: () => {} } });
    const v = c.validate(makeHydrated({
      workflowType: 'replay_continuation',
      chain: ['cp_a'],
      completed: ['s1'], pending: ['s2'],
    }));
    expect(v.ok).toBe(true);
    expect(v.recommendedAction).toBe('proceed');
  });

  test('corrupted checkpoint chain → fail', () => {
    const c = createQueueCheckpointContinuityCoordinator({ telemetry: { emit: () => {} } });
    const v = c.validate(makeHydrated({
      chain: ['cp_a'], integrity: 'corrupted',
    }));
    expect(v.code).toBe('checkpoint_divergence');
  });

  test('happy path → continuous + proceed', () => {
    const c = createQueueCheckpointContinuityCoordinator({ telemetry: { emit: () => {} } });
    const v = c.validate(makeHydrated({}));
    expect(v.code).toBe('continuous');
    expect(v.recommendedAction).toBe('proceed');
  });
});
