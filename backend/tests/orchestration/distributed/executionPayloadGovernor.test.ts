/**
 * Phase 23D — ExecutionPayloadGovernor unit tests.
 */

import {
  createExecutionPayloadGovernor,
} from '../../../services/orchestration/distributed/executionPayloadGovernor';
import {
  createWorkflowStepRegistry,
} from '../../../services/orchestration/distributed/workflowStepRegistry';
import type {
  HydratedQueuePayload,
  QueuePayloadV1,
  WorkflowType,
} from '../../../services/orchestration/distributed/workflowExecutionTypes';

function makeHydrated(
  payloadOver: Partial<QueuePayloadV1> = {},
  opts?: { chain?: Array<{ checkpointId: string; phase?: string; takenAtIso?: string }> },
): HydratedQueuePayload {
  const payload: QueuePayloadV1 = {
    schemaVersion: 1, workflowType: 'content_generation',
    executionId: 'e', companyId: 'co',
    ...payloadOver,
  };
  return {
    payload,
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
      executionStatus: 'pending', executionOwner: null,
      retryCount: 0, recoveryState: 'idle',
      startedAt: '2026-01-01T00:00:00Z',
      heartbeatAt: null, completedAt: null,
      failureReason: null, replayCheckpointId: null,
    },
    restored: opts?.chain ? {
      executionId: 'e',
      latestCheckpointId: opts.chain[opts.chain.length - 1]?.checkpointId ?? null,
      phase: 'generation', completedNodeOperationIds: [],
      pendingNodeOperationIds: [], pendingTopologyMutationIds: [],
      recoveryProgress: null, replayContinuity: null,
      chain: opts.chain.map((c) => ({
        checkpointId: c.checkpointId, executionId: 'e',
        takenAt: c.takenAtIso ?? '2026-01-01T00:00:00Z',
        phase: (c.phase ?? 'generation') as 'generation',
        completedNodeOperationIds: [], pendingNodeOperationIds: [],
        pendingTopologyMutationIds: [], recoveryProgress: null, replayContinuity: null,
      })),
      integrity: { status: 'intact', integrityScore: 100, issues: [], phaseTransitions: 0, windowStartIso: null, windowEndIso: null },
    } : null,
  };
}

function buildGov(wf?: WorkflowType) {
  const reg = createWorkflowStepRegistry({ telemetry: { emit: () => {} } });
  // Register a builder for the requested type so the governor's compat check passes.
  reg.register({
    workflowType: wf ?? 'content_generation', name: 'test',
    async build() { return { steps: [], context: {} }; },
  });
  return createExecutionPayloadGovernor({ registry: reg, telemetry: { emit: () => {} } });
}

describe('ExecutionPayloadGovernor.validate', () => {
  test('well-formed payload passes', () => {
    const g = buildGov();
    const v = g.validate(makeHydrated());
    expect(v.ok).toBe(true);
  });

  test('schemaVersion drift fails with unsupported_schema_version', () => {
    const g = buildGov();
    const v = g.validate(makeHydrated({ schemaVersion: 99 as unknown as 1 }));
    expect(v.code).toBe('unsupported_schema_version');
  });

  test('workflowType with no registered builder fails', () => {
    // Use topology_mutation (NOT in requireIdempotencyFor by default) so
    // the idempotency check passes and the registry-compat check fires.
    const g = buildGov('content_generation');
    const v = g.validate(makeHydrated({ workflowType: 'topology_mutation' }));
    expect(v.code).toBe('unknown_workflow_type');
  });

  test('recovery payload without idempotencyHints fails', () => {
    const g = buildGov('recovery');
    const v = g.validate(makeHydrated({ workflowType: 'recovery' }));
    expect(v.code).toBe('idempotency_keys_invalid');
  });

  test('recovery payload with idempotencyHints passes', () => {
    const g = buildGov('recovery');
    const v = g.validate(makeHydrated({
      workflowType: 'recovery',
      idempotencyHints: [{ stepId: 's', cls: 'recovery_action', semanticParts: ['s'] }],
    }));
    expect(v.ok).toBe(true);
  });

  test('checkpointReference not in chain fails', () => {
    const g = buildGov();
    const v = g.validate(makeHydrated(
      { checkpointReference: { checkpointId: 'cp_nope' } },
      { chain: [{ checkpointId: 'cp_a' }, { checkpointId: 'cp_b' }] },
    ));
    expect(v.code).toBe('checkpoint_reference_missing');
  });

  test('checkpointReference present in chain passes', () => {
    const g = buildGov();
    const v = g.validate(makeHydrated(
      { checkpointReference: { checkpointId: 'cp_b' } },
      { chain: [{ checkpointId: 'cp_a' }, { checkpointId: 'cp_b' }] },
    ));
    expect(v.ok).toBe(true);
  });
});
