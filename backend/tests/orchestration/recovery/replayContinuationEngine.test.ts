/**
 * Phase 19D — ReplayContinuationEngine unit tests.
 */

import {
  createReplayContinuationEngine,
  type ReplayableWorkflowStep,
} from '../../../services/orchestration/recovery/replayContinuationEngine';
import {
  createCheckpointRestorationEngine,
} from '../../../services/orchestration/recovery/checkpointRestorationEngine';
import {
  createInMemoryExecutionStore,
  setDefaultExecutionStore,
} from '../../../services/threadRuntime/executionStore';
import {
  createDurableExecutionCoordinator,
  setDefaultDurableExecutionCoordinator,
} from '../../../services/threadRuntime/durableExecutionCoordinator';
import {
  createResumableWorkflowEngine,
  setDefaultResumableWorkflowEngine,
} from '../../../services/threadRuntime/resumableWorkflowEngine';
import {
  createExecutionCheckpointManager,
  setDefaultExecutionCheckpointManager,
} from '../../../services/threadRuntime/executionCheckpointManager';
import {
  createExecutionIdempotencyGovernor,
} from '../../../services/threadRuntime/executionIdempotencyGovernor';

async function bootstrap() {
  const store = createInMemoryExecutionStore();
  setDefaultExecutionStore(store);
  const coordinator = createDurableExecutionCoordinator({ store });
  setDefaultDurableExecutionCoordinator(coordinator);
  const checkpoints = createExecutionCheckpointManager({ store });
  setDefaultExecutionCheckpointManager(checkpoints);
  const workflow = createResumableWorkflowEngine({ coordinator, checkpointManager: checkpoints });
  setDefaultResumableWorkflowEngine(workflow);
  return { store, coordinator, checkpoints, workflow };
}

describe('ReplayContinuationEngine', () => {
  test('continuation on completed execution short-circuits with already_completed', async () => {
    const { store, coordinator } = await bootstrap();
    const exec = await coordinator.start({
      runtimeSessionId: 'rs', threadId: 'thr',
      companyId: '00000000-0000-0000-0000-000000000001',
    });
    await coordinator.transition({ executionId: exec.executionId, to: 'running' });
    await coordinator.transition({ executionId: exec.executionId, to: 'completed' });
    const engine = createReplayContinuationEngine({
      coordinator,
      checkpointRestorationEngine: createCheckpointRestorationEngine({ store, telemetry: { emit: () => {} } }),
      telemetry: { emit: () => {} },
    });
    const r = await engine.continue({
      executionId: exec.executionId,
      steps: [{ id: 's', phase: 'generation', async run() { throw new Error('must not run'); } }],
      context: {},
    });
    expect(r.outcome).toBe('already_completed');
    expect(r.ranStepCount).toBe(0);
  });

  test('continuation on missing execution returns failed', async () => {
    const { store, coordinator } = await bootstrap();
    const engine = createReplayContinuationEngine({
      coordinator,
      checkpointRestorationEngine: createCheckpointRestorationEngine({ store, telemetry: { emit: () => {} } }),
      telemetry: { emit: () => {} },
    });
    const r = await engine.continue({ executionId: 'nope', steps: [], context: {} });
    expect(r.outcome).toBe('failed');
    expect(r.failureReason).toBe('execution_not_found');
  });

  test('idempotency guard suppresses duplicate side-effects', async () => {
    const { store, coordinator, checkpoints } = await bootstrap();
    const exec = await coordinator.start({
      runtimeSessionId: 'rs', threadId: 'thr',
      companyId: '00000000-0000-0000-0000-000000000001',
    });
    await coordinator.transition({ executionId: exec.executionId, to: 'running' });
    // pre-existing fingerprint via direct governor call to simulate a prior run
    const governor = createExecutionIdempotencyGovernor();
    await governor.guard({ executionId: exec.executionId, cls: 'node_insert', semanticParts: ['s1'] });

    let actualRuns = 0;
    const steps: ReplayableWorkflowStep<unknown>[] = [
      {
        id: 's1', phase: 'generation',
        idempotency: { cls: 'node_insert', semanticParts: ['s1'] },
        async run() { actualRuns += 1; },
      },
    ];
    const engine = createReplayContinuationEngine({
      coordinator,
      checkpointRestorationEngine: createCheckpointRestorationEngine({ store, telemetry: { emit: () => {} } }),
      idempotencyGovernor: governor,
      telemetry: { emit: () => {} },
    });
    void checkpoints;
    const r = await engine.continue({
      executionId: exec.executionId,
      steps, context: {},
    });
    // Step appears to run (workflow advances), but the guarded side-effect is suppressed.
    expect(actualRuns).toBe(0);
    expect(r.duplicateSuppressions).toBeGreaterThanOrEqual(1);
    expect(r.outcome).toBe('duplicate_suppressed');
  });

  test('failed step propagates as outcome=failed', async () => {
    const { store, coordinator } = await bootstrap();
    const exec = await coordinator.start({
      runtimeSessionId: 'rs', threadId: 'thr',
      companyId: '00000000-0000-0000-0000-000000000001',
    });
    await coordinator.transition({ executionId: exec.executionId, to: 'running' });
    const engine = createReplayContinuationEngine({
      coordinator,
      checkpointRestorationEngine: createCheckpointRestorationEngine({ store, telemetry: { emit: () => {} } }),
      telemetry: { emit: () => {} },
    });
    const r = await engine.continue({
      executionId: exec.executionId,
      steps: [{ id: 's', phase: 'generation', async run() { throw new Error('boom'); } }],
      context: {},
    });
    expect(r.outcome).toBe('failed');
    expect(r.failureReason).toContain('boom');
  });
});
