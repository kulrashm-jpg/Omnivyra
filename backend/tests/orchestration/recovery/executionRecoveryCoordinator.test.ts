/**
 * Phase 19A — ExecutionRecoveryCoordinator integration tests.
 */

import {
  createExecutionRecoveryCoordinator,
} from '../../../services/orchestration/recovery/executionRecoveryCoordinator';
import {
  createInMemoryExecutionStore,
  setDefaultExecutionStore,
} from '../../../services/threadRuntime/executionStore';
import {
  createDurableExecutionCoordinator,
  setDefaultDurableExecutionCoordinator,
} from '../../../services/threadRuntime/durableExecutionCoordinator';
import {
  createExecutionCheckpointManager,
  setDefaultExecutionCheckpointManager,
} from '../../../services/threadRuntime/executionCheckpointManager';
import {
  createExecutionLeaseGovernor,
  setDefaultExecutionLeaseGovernor,
} from '../../../services/threadRuntime/executionLeaseGovernor';
import {
  createResumableWorkflowEngine,
  setDefaultResumableWorkflowEngine,
} from '../../../services/threadRuntime/resumableWorkflowEngine';
import {
  createExecutionIdempotencyGovernor,
  setDefaultExecutionIdempotencyGovernor,
} from '../../../services/threadRuntime/executionIdempotencyGovernor';
import {
  createCheckpointRestorationEngine,
  setDefaultCheckpointRestorationEngine,
} from '../../../services/orchestration/recovery/checkpointRestorationEngine';
import {
  createLeaseRecoveryGovernor,
  setDefaultLeaseRecoveryGovernor,
} from '../../../services/orchestration/recovery/leaseRecoveryGovernor';
import {
  createStaleExecutionReconciler,
  setDefaultStaleExecutionReconciler,
} from '../../../services/orchestration/recovery/staleExecutionReconciler';
import {
  createReplayContinuationEngine,
  setDefaultReplayContinuationEngine,
} from '../../../services/orchestration/recovery/replayContinuationEngine';
import type { ReplayableWorkflowStep } from '../../../services/orchestration/recovery/replayContinuationEngine';

beforeEach(() => {
  // Wire fresh instances for each test so module-level defaults don't leak.
  setDefaultExecutionStore(createInMemoryExecutionStore());
  setDefaultDurableExecutionCoordinator(createDurableExecutionCoordinator());
  setDefaultExecutionCheckpointManager(createExecutionCheckpointManager());
  setDefaultExecutionLeaseGovernor(createExecutionLeaseGovernor());
  setDefaultResumableWorkflowEngine(createResumableWorkflowEngine());
  setDefaultExecutionIdempotencyGovernor(createExecutionIdempotencyGovernor());
  setDefaultCheckpointRestorationEngine(createCheckpointRestorationEngine({ telemetry: { emit: () => {} } }));
  setDefaultLeaseRecoveryGovernor(createLeaseRecoveryGovernor({ telemetry: { emit: () => {} } }));
  setDefaultStaleExecutionReconciler(createStaleExecutionReconciler({
    telemetry: { emit: () => {} }, heartbeatStaleMs: 200, recoveryStalledMs: 500,
  }));
  setDefaultReplayContinuationEngine(createReplayContinuationEngine({ telemetry: { emit: () => {} } }));
});

async function startAndStall(workerId = 'w_orig'): Promise<string> {
  const { getDefaultDurableExecutionCoordinator } = await import(
    '../../../services/threadRuntime/durableExecutionCoordinator'
  );
  const coord = getDefaultDurableExecutionCoordinator();
  const exec = await coord.start({
    runtimeSessionId: 'rs', threadId: 'thr',
    companyId: '00000000-0000-0000-0000-000000000001',
    workerId,
  });
  const { getDefaultExecutionStore } = await import(
    '../../../services/threadRuntime/executionStore'
  );
  await getDefaultExecutionStore().acquireLease({
    executionId: exec.executionId, workerId, durationMs: 30,
  });
  await coord.transition({ executionId: exec.executionId, to: 'running' });
  await new Promise((r) => setTimeout(r, 80));
  return exec.executionId;
}

describe('ExecutionRecoveryCoordinator', () => {
  test('completed execution returns status=already_completed', async () => {
    const { getDefaultDurableExecutionCoordinator } = await import('../../../services/threadRuntime/durableExecutionCoordinator');
    const coord = getDefaultDurableExecutionCoordinator();
    const exec = await coord.start({
      runtimeSessionId: 'rs', threadId: 'thr',
      companyId: '00000000-0000-0000-0000-000000000001',
    });
    await coord.transition({ executionId: exec.executionId, to: 'running' });
    await coord.transition({ executionId: exec.executionId, to: 'completed' });

    const reco = createExecutionRecoveryCoordinator({ telemetry: { emit: () => {} } });
    const r = await reco.recoverExecution({
      executionId: exec.executionId,
      workerId: 'w_recovery',
      steps: [{ id: 's', phase: 'generation', async run() { throw new Error('must not run'); } }],
      context: {},
    });
    expect(r.status).toBe('already_completed');
  });

  test('missing execution returns status=failed', async () => {
    const reco = createExecutionRecoveryCoordinator({ telemetry: { emit: () => {} } });
    const r = await reco.recoverExecution({
      executionId: 'nope', workerId: 'w', steps: [], context: {},
    });
    expect(r.status).toBe('failed');
  });

  test('non-stale execution returns no_action_needed', async () => {
    const { getDefaultDurableExecutionCoordinator } = await import('../../../services/threadRuntime/durableExecutionCoordinator');
    const coord = getDefaultDurableExecutionCoordinator();
    const exec = await coord.start({
      runtimeSessionId: 'rs', threadId: 'thr',
      companyId: '00000000-0000-0000-0000-000000000001',
      workerId: 'w_healthy',
    });
    const { getDefaultExecutionStore } = await import('../../../services/threadRuntime/executionStore');
    await getDefaultExecutionStore().acquireLease({
      executionId: exec.executionId, workerId: 'w_healthy', durationMs: 60_000,
    });
    await coord.transition({ executionId: exec.executionId, to: 'running' });

    const reco = createExecutionRecoveryCoordinator({ telemetry: { emit: () => {} } });
    const r = await reco.recoverExecution({
      executionId: exec.executionId,
      workerId: 'w_recovery', steps: [], context: {},
    });
    expect(r.status).toBe('no_action_needed');
  });

  test('stale execution → takeover → replay → recovered', async () => {
    const executionId = await startAndStall();
    const { getDefaultExecutionCheckpointManager } = await import('../../../services/threadRuntime/executionCheckpointManager');
    await getDefaultExecutionCheckpointManager().capture({
      executionId, phase: 'generation',
      newlyCompleted: ['s1'], pending: ['s2'],
    });

    let s2Ran = 0;
    const steps: ReplayableWorkflowStep<unknown>[] = [
      { id: 's1', phase: 'generation', async run() { throw new Error('s1 must not re-run'); } },
      { id: 's2', phase: 'generation', async run() { s2Ran += 1; } },
    ];
    const reco = createExecutionRecoveryCoordinator({ telemetry: { emit: () => {} } });
    const r = await reco.recoverExecution({
      executionId, workerId: 'w_recovery', steps, context: {},
    });
    expect(r.status).toBe('recovered');
    expect(s2Ran).toBe(1);
    expect(r.finalExecution?.executionStatus).toBe('completed');
  });

  test('detectInterruptedExecutions surfaces stale ones', async () => {
    const id = await startAndStall();
    const reco = createExecutionRecoveryCoordinator({ telemetry: { emit: () => {} } });
    const findings = await reco.detectInterruptedExecutions({ limit: 50 });
    expect(findings.find((f) => f.executionId === id)).toBeDefined();
  });

  test('sweepAndRecover processes findings in bounded batch', async () => {
    // Create 3 stale executions.
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) ids.push(await startAndStall(`w_${i}`));
    const { getDefaultExecutionCheckpointManager } = await import('../../../services/threadRuntime/executionCheckpointManager');
    for (const id of ids) {
      await getDefaultExecutionCheckpointManager().capture({
        executionId: id, phase: 'generation',
        newlyCompleted: [], pending: ['s'],
      });
    }

    const reco = createExecutionRecoveryCoordinator({ telemetry: { emit: () => {} } });
    const outcomes = await reco.sweepAndRecover({
      workerId: 'w_sweeper',
      buildSteps: async () => [{ id: 's', phase: 'generation', async run() {} }],
      buildContext: async () => ({}),
      maxExecutionsPerSweep: 2,
    });
    expect(outcomes.length).toBeLessThanOrEqual(2);
  });
});
