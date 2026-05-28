/**
 * Phase 23A — WorkflowStepRegistry unit tests.
 */

import {
  createWorkflowStepRegistry,
  PLACEHOLDER_BUILDER_TAG,
  WorkflowStepRegistryError,
} from '../../../services/orchestration/distributed/workflowStepRegistry';
import type {
  HydratedQueuePayload,
  WorkflowStepBuilder,
} from '../../../services/orchestration/distributed/workflowExecutionTypes';

function makeHydrated(): HydratedQueuePayload {
  return {
    payload: {
      schemaVersion: 1, workflowType: 'content_generation',
      executionId: 'e', companyId: 'co',
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
      executionStatus: 'pending', executionOwner: null,
      retryCount: 0, recoveryState: 'idle',
      startedAt: '2026-01-01T00:00:00Z',
      heartbeatAt: null, completedAt: null,
      failureReason: null, replayCheckpointId: null,
    },
    restored: null,
  };
}

describe('WorkflowStepRegistry — register + get + list', () => {
  test('register stores builder and get retrieves it', () => {
    const r = createWorkflowStepRegistry({ telemetry: { emit: () => {} } });
    const builder: WorkflowStepBuilder = {
      workflowType: 'content_generation', name: 'test',
      async build() { return { steps: [], context: {} }; },
    };
    r.register(builder);
    expect(r.get('content_generation')).toBe(builder);
    expect(r.list().length).toBe(1);
  });

  test('register without workflowType throws', () => {
    const r = createWorkflowStepRegistry({ telemetry: { emit: () => {} } });
    expect(() => r.register({ name: 'bad' } as unknown as WorkflowStepBuilder))
      .toThrow(WorkflowStepRegistryError);
  });

  test('second register overwrites prior entry', () => {
    const r = createWorkflowStepRegistry({ telemetry: { emit: () => {} } });
    const b1: WorkflowStepBuilder = { workflowType: 'recovery', name: 'a', async build() { return { steps: [], context: {} }; } };
    const b2: WorkflowStepBuilder = { workflowType: 'recovery', name: 'b', async build() { return { steps: [], context: {} }; } };
    r.register(b1);
    r.register(b2);
    expect(r.get('recovery')).toBe(b2);
  });
});

describe('WorkflowStepRegistry — build', () => {
  test('build with no registered builder throws NO_BUILDER', async () => {
    const r = createWorkflowStepRegistry({ telemetry: { emit: () => {} } });
    await expect(r.build(makeHydrated())).rejects.toThrow(WorkflowStepRegistryError);
  });

  test('build dispatches to registered builder', async () => {
    const r = createWorkflowStepRegistry({ telemetry: { emit: () => {} } });
    let invoked = 0;
    r.register({
      workflowType: 'content_generation', name: 'test',
      async build() { invoked += 1; return { steps: [{ id: 's', phase: 'generation', async run() {} }], context: { ctxId: 'x' } }; },
    });
    const out = await r.build(makeHydrated());
    expect(invoked).toBe(1);
    expect(out.steps.length).toBe(1);
    expect((out.context as { ctxId: string }).ctxId).toBe('x');
  });

  test('build wraps builder errors as BUILD_FAILED', async () => {
    const r = createWorkflowStepRegistry({ telemetry: { emit: () => {} } });
    r.register({
      workflowType: 'content_generation', name: 'thrower',
      async build() { throw new Error('boom'); },
    });
    let err: unknown;
    try { await r.build(makeHydrated()); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(WorkflowStepRegistryError);
    expect((err as WorkflowStepRegistryError).code).toBe('BUILD_FAILED');
  });
});

describe('WorkflowStepRegistry — assertRealBuildersPresent', () => {
  test('empty registry throws NO_BUILDER', () => {
    const r = createWorkflowStepRegistry({ telemetry: { emit: () => {} } });
    expect(() => r.assertRealBuildersPresent()).toThrow(WorkflowStepRegistryError);
  });

  test('only placeholders throws PLACEHOLDER_DETECTED', () => {
    const r = createWorkflowStepRegistry({ telemetry: { emit: () => {} } });
    r.register({
      workflowType: 'content_generation',
      name: `${PLACEHOLDER_BUILDER_TAG}_default`,
      async build() { return { steps: [], context: {} }; },
    });
    let err: unknown;
    try { r.assertRealBuildersPresent(); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(WorkflowStepRegistryError);
    expect((err as WorkflowStepRegistryError).code).toBe('PLACEHOLDER_DETECTED');
  });

  test('at least one real builder passes', () => {
    const r = createWorkflowStepRegistry({ telemetry: { emit: () => {} } });
    r.register({
      workflowType: 'content_generation',
      name: 'real_default_content_generation',
      async build() { return { steps: [], context: {} }; },
    });
    expect(() => r.assertRealBuildersPresent()).not.toThrow();
  });
});
