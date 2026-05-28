/**
 * Phase 19I — Distributed recovery stress harness.
 *
 * Twelve adversarial scenarios validating the Phase 19 recovery layer:
 *   1.  process crash mid-generation
 *   2.  restart during topology mutation
 *   3.  stale worker lease expiration
 *   4.  replay after partial checkpoint write
 *   5.  duplicate recovery attempt
 *   6.  split-brain takeover attempt
 *   7.  partial persistence completion
 *   8.  replay after deploy restart
 *   9.  recovery during transport retry storm
 *  10.  concurrent execution reclaim
 *  11.  duplicate billing replay attempt
 *  12.  orphan topology replay continuation
 *
 * Uses the in-memory ExecutionStore so the harness is hermetic — no DB,
 * no network, no scheduler dependencies. Each scenario follows a
 * deterministic recipe: set up the failure mode, invoke recovery, then
 * assert the determinism contract.
 *
 * Usage:
 *   npx tsx scripts/ops/longFormDurableRecoveryStress.ts
 */

import {
  createInMemoryExecutionStore,
  setDefaultExecutionStore,
} from '../../backend/services/threadRuntime/executionStore';
import {
  setDefaultDurableExecutionCoordinator,
  createDurableExecutionCoordinator,
} from '../../backend/services/threadRuntime/durableExecutionCoordinator';
import {
  setDefaultExecutionCheckpointManager,
  createExecutionCheckpointManager,
} from '../../backend/services/threadRuntime/executionCheckpointManager';
import {
  setDefaultExecutionLeaseGovernor,
  createExecutionLeaseGovernor,
} from '../../backend/services/threadRuntime/executionLeaseGovernor';
import {
  setDefaultResumableWorkflowEngine,
  createResumableWorkflowEngine,
} from '../../backend/services/threadRuntime/resumableWorkflowEngine';
import {
  setDefaultExecutionIdempotencyGovernor,
  createExecutionIdempotencyGovernor,
} from '../../backend/services/threadRuntime/executionIdempotencyGovernor';
import {
  createCheckpointRestorationEngine,
  setDefaultCheckpointRestorationEngine,
} from '../../backend/services/orchestration/recovery/checkpointRestorationEngine';
import {
  createLeaseRecoveryGovernor,
  setDefaultLeaseRecoveryGovernor,
} from '../../backend/services/orchestration/recovery/leaseRecoveryGovernor';
import {
  createStaleExecutionReconciler,
  setDefaultStaleExecutionReconciler,
} from '../../backend/services/orchestration/recovery/staleExecutionReconciler';
import {
  createReplayContinuationEngine,
  setDefaultReplayContinuationEngine,
} from '../../backend/services/orchestration/recovery/replayContinuationEngine';
import {
  createExecutionRecoveryCoordinator,
} from '../../backend/services/orchestration/recovery/executionRecoveryCoordinator';
import {
  createRecoveryForensicAnalyzer,
} from '../../backend/services/orchestration/recovery/recoveryForensicAnalyzer';
import type { ReplayableWorkflowStep } from '../../backend/services/orchestration/recovery/replayContinuationEngine';

// ── Test runner scaffolding ──────────────────────────────────────────

interface Assertion {
  label: string;
  actual: unknown;
  expected: string;
  ok: boolean;
}

interface ScenarioResult {
  name: string;
  passed: boolean;
  assertions: Assertion[];
  err?: string;
}

function expectEq(label: string, actual: unknown, expected: unknown): Assertion {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  return { label, actual, expected: JSON.stringify(expected), ok };
}
function expectTrue(label: string, actual: boolean, expected: string): Assertion {
  return { label, actual, expected, ok: actual === true };
}
function expectAtLeast(label: string, actual: number, threshold: number): Assertion {
  return { label, actual, expected: `>= ${threshold}`, ok: actual >= threshold };
}

function resetWorld() {
  // Fresh in-memory store + coordinator graph for each scenario.
  setDefaultExecutionStore(createInMemoryExecutionStore());
  setDefaultDurableExecutionCoordinator(createDurableExecutionCoordinator());
  setDefaultExecutionCheckpointManager(createExecutionCheckpointManager());
  setDefaultExecutionLeaseGovernor(createExecutionLeaseGovernor());
  setDefaultResumableWorkflowEngine(createResumableWorkflowEngine());
  setDefaultExecutionIdempotencyGovernor(createExecutionIdempotencyGovernor());
  setDefaultCheckpointRestorationEngine(createCheckpointRestorationEngine({
    telemetry: { emit: () => {} },
  }));
  setDefaultLeaseRecoveryGovernor(createLeaseRecoveryGovernor({
    telemetry: { emit: () => {} },
  }));
  setDefaultStaleExecutionReconciler(createStaleExecutionReconciler({
    telemetry: { emit: () => {} },
    heartbeatStaleMs: 200,        // small so tests can simulate staleness fast
    recoveryStalledMs: 500,
    maxRetryCount: 3,
  }));
  setDefaultReplayContinuationEngine(createReplayContinuationEngine({
    telemetry: { emit: () => {} },
  }));
}

async function runScenario(name: string, body: () => Promise<Assertion[]>): Promise<ScenarioResult> {
  resetWorld();
  try {
    const assertions = await body();
    const passed = assertions.every((a) => a.ok);
    return { name, passed, assertions };
  } catch (err) {
    return { name, passed: false, assertions: [], err: (err as Error).message };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

async function startExecution(workerId = 'w_orig') {
  const { getDefaultDurableExecutionCoordinator } = await import(
    '../../backend/services/threadRuntime/durableExecutionCoordinator'
  );
  const coord = getDefaultDurableExecutionCoordinator();
  return coord.start({
    runtimeSessionId: 'rs_test',
    threadId: 'thr_test',
    companyId: '00000000-0000-0000-0000-000000000001',
    workerId,
  });
}

async function acquireOrigLease(executionId: string, workerId = 'w_orig', durationMs = 1000) {
  const { getDefaultExecutionStore } = await import(
    '../../backend/services/threadRuntime/executionStore'
  );
  const store = getDefaultExecutionStore();
  return store.acquireLease({ executionId, workerId, durationMs });
}

async function makeAcheckpoint(executionId: string, phase: 'generation' | 'persistence' | 'topology_settle' | 'recovery' | 'finalize' | 'precheck',
  newlyCompleted: string[], pending: string[], extras?: { pendingTopologyMutationIds?: string[]; replayContinuity?: Record<string, unknown> }) {
  const { getDefaultExecutionCheckpointManager } = await import(
    '../../backend/services/threadRuntime/executionCheckpointManager'
  );
  return getDefaultExecutionCheckpointManager().capture({
    executionId, phase, newlyCompleted, pending,
    pendingTopologyMutationIds: extras?.pendingTopologyMutationIds,
    replayContinuity: extras?.replayContinuity,
  });
}

// ── Scenarios ───────────────────────────────────────────────────────

async function s1_processCrashMidGeneration(): Promise<Assertion[]> {
  // Simulate: workflow ran step1, crashed before step2.
  const exec = await startExecution();
  await acquireOrigLease(exec.executionId, 'w_orig', 50); // short-lived
  const { getDefaultDurableExecutionCoordinator } = await import('../../backend/services/threadRuntime/durableExecutionCoordinator');
  await getDefaultDurableExecutionCoordinator().transition({ executionId: exec.executionId, to: 'running' });
  await makeAcheckpoint(exec.executionId, 'generation', ['step1'], ['step2']);
  // wait so lease expires + heartbeat goes stale
  await new Promise((r) => setTimeout(r, 250));

  let step1Ran = 0, step2Ran = 0;
  const steps: ReplayableWorkflowStep<unknown>[] = [
    { id: 'step1', phase: 'generation', async run() { step1Ran += 1; } },
    { id: 'step2', phase: 'generation', async run() { step2Ran += 1; } },
  ];
  const coord = createExecutionRecoveryCoordinator();
  const result = await coord.recoverExecution({
    executionId: exec.executionId, workerId: 'w_recovery',
    steps, context: {},
  });

  return [
    expectEq('recovery status', result.status, 'recovered'),
    expectEq('step1 NOT re-run (skipped)', step1Ran, 0),
    expectEq('step2 ran exactly once', step2Ran, 1),
    expectEq('final execution status', result.finalExecution?.executionStatus, 'completed'),
  ];
}

async function s2_restartDuringTopologyMutation(): Promise<Assertion[]> {
  const exec = await startExecution();
  await acquireOrigLease(exec.executionId, 'w_orig', 50);
  const { getDefaultDurableExecutionCoordinator } = await import('../../backend/services/threadRuntime/durableExecutionCoordinator');
  await getDefaultDurableExecutionCoordinator().transition({ executionId: exec.executionId, to: 'running' });
  // checkpoint with a pending topology mutation
  await makeAcheckpoint(exec.executionId, 'topology_settle', [], ['topo_step'], {
    pendingTopologyMutationIds: ['mut_a', 'mut_b'],
  });
  await new Promise((r) => setTimeout(r, 250));

  let topoApplied = 0;
  const steps: ReplayableWorkflowStep<unknown>[] = [
    {
      id: 'topo_step', phase: 'topology_settle',
      idempotency: { cls: 'topology_mutation', semanticParts: ['mut_a', 'mut_b'] },
      async run() { topoApplied += 1; },
    },
  ];
  const recoCoord = createExecutionRecoveryCoordinator();
  const r1 = await recoCoord.recoverExecution({
    executionId: exec.executionId, workerId: 'w_a', steps, context: {},
  });
  // A SECOND recovery on the same execution shouldn't double-apply the mutation.
  const r2 = await recoCoord.recoverExecution({
    executionId: exec.executionId, workerId: 'w_b', steps, context: {},
  });
  return [
    expectEq('first recovery succeeded', r1.status, 'recovered'),
    expectEq('topology mutation applied once', topoApplied, 1),
    expectTrue('second recovery is no-op or already_completed',
      r2.status === 'already_completed' || r2.status === 'no_action_needed' || r2.status === 'recovered',
      'expected non-failure'),
  ];
}

async function s3_staleWorkerLeaseExpiration(): Promise<Assertion[]> {
  const exec = await startExecution();
  await acquireOrigLease(exec.executionId, 'w_dead', 30);
  await new Promise((r) => setTimeout(r, 80));

  const reco = createExecutionRecoveryCoordinator();
  const findings = await reco.detectInterruptedExecutions({ limit: 50 });
  const matching = findings.find((f) => f.executionId === exec.executionId);

  return [
    expectTrue('finding present', !!matching, 'truthy'),
    expectTrue('reason is lease_expired or heartbeat_stale or orphan_running',
      matching?.reason === 'lease_expired' || matching?.reason === 'heartbeat_stale' || matching?.reason === 'orphan_running',
      'one of three'),
    // Expired-but-not-released lease still exposes its owner in the finding so
    // forensics can identify the dead worker.
    expectEq('owner of dead lease surfaced', matching?.currentOwnerWorkerId, 'w_dead'),
  ];
}

async function s4_replayAfterPartialCheckpointWrite(): Promise<Assertion[]> {
  const exec = await startExecution();
  // The checkpoint manager filters pending to exclude completed ids, so we
  // can't synthesize a corrupted checkpoint via the manager. Write it
  // directly to the store to simulate a partial write that survived a crash.
  const { getDefaultExecutionStore } = await import(
    '../../backend/services/threadRuntime/executionStore'
  );
  const store = getDefaultExecutionStore();
  await store.recordCheckpoint({
    checkpointId: 'cp_corrupt',
    executionId: exec.executionId,
    takenAt: new Date().toISOString(),
    phase: 'generation',
    // Both completed AND pending contain the same id — partial write.
    completedNodeOperationIds: ['nA'],
    pendingNodeOperationIds: ['nA', 'nB'],
    pendingTopologyMutationIds: [],
    recoveryProgress: null,
    replayContinuity: null,
  });

  const restoration = createCheckpointRestorationEngine({ telemetry: { emit: () => {} } });
  const restored = await restoration.restore(exec.executionId);
  return [
    expectAtLeast('integrity issues detected', restored.integrity.issues.length, 1),
    expectTrue('status partial or corrupted',
      restored.integrity.status === 'partial' || restored.integrity.status === 'corrupted',
      'not intact'),
    expectTrue('integrity score below 100', restored.integrity.integrityScore < 100, '<100'),
  ];
}

async function s5_duplicateRecoveryAttempt(): Promise<Assertion[]> {
  const exec = await startExecution();
  await acquireOrigLease(exec.executionId, 'w_orig', 30);
  const { getDefaultDurableExecutionCoordinator } = await import('../../backend/services/threadRuntime/durableExecutionCoordinator');
  await getDefaultDurableExecutionCoordinator().transition({ executionId: exec.executionId, to: 'running' });
  await makeAcheckpoint(exec.executionId, 'generation', ['s1'], ['s2']);
  await new Promise((r) => setTimeout(r, 80));

  let s2Ran = 0;
  const steps: ReplayableWorkflowStep<unknown>[] = [
    { id: 's1', phase: 'generation', async run() {} },
    {
      id: 's2', phase: 'generation',
      idempotency: { cls: 'node_insert', semanticParts: ['s2'] },
      async run() { s2Ran += 1; },
    },
  ];
  const reco = createExecutionRecoveryCoordinator();
  await reco.recoverExecution({ executionId: exec.executionId, workerId: 'w_a', steps, context: {} });
  await reco.recoverExecution({ executionId: exec.executionId, workerId: 'w_b', steps, context: {} });

  return [
    expectEq('step2 actually ran only once', s2Ran, 1),
  ];
}

async function s6_splitBrainTakeoverAttempt(): Promise<Assertion[]> {
  const exec = await startExecution();
  // Live lease still active.
  await acquireOrigLease(exec.executionId, 'w_orig', 60_000);

  const leaseGov = createLeaseRecoveryGovernor({ telemetry: { emit: () => {} } });
  const r = await leaseGov.takeoverForRecovery({ executionId: exec.executionId, workerId: 'w_intruder' });
  return [
    expectEq('takeover refused', r.action, 'takeover_refused'),
    expectEq('no new lease', r.newLeaseId, null),
  ];
}

async function s7_partialPersistenceCompletion(): Promise<Assertion[]> {
  const exec = await startExecution();
  await acquireOrigLease(exec.executionId, 'w_orig', 50);
  const { getDefaultDurableExecutionCoordinator } = await import('../../backend/services/threadRuntime/durableExecutionCoordinator');
  await getDefaultDurableExecutionCoordinator().transition({ executionId: exec.executionId, to: 'running' });
  // persistence phase: half-done
  await makeAcheckpoint(exec.executionId, 'persistence', ['p1'], ['p2']);
  await new Promise((r) => setTimeout(r, 80));

  let p1Calls = 0, p2Calls = 0;
  const steps: ReplayableWorkflowStep<unknown>[] = [
    { id: 'p1', phase: 'persistence', async run() { p1Calls += 1; } },
    { id: 'p2', phase: 'persistence', async run() { p2Calls += 1; } },
  ];
  const reco = createExecutionRecoveryCoordinator();
  const result = await reco.recoverExecution({ executionId: exec.executionId, workerId: 'w_r', steps, context: {} });
  return [
    expectEq('recovery succeeded', result.status, 'recovered'),
    expectEq('p1 NOT re-run', p1Calls, 0),
    expectEq('p2 ran once', p2Calls, 1),
  ];
}

async function s8_replayAfterDeployRestart(): Promise<Assertion[]> {
  const exec = await startExecution();
  await acquireOrigLease(exec.executionId, 'w_pre_deploy', 30);
  const { getDefaultDurableExecutionCoordinator } = await import('../../backend/services/threadRuntime/durableExecutionCoordinator');
  await getDefaultDurableExecutionCoordinator().transition({ executionId: exec.executionId, to: 'running' });
  await makeAcheckpoint(exec.executionId, 'generation', ['g1', 'g2'], ['g3']);
  await new Promise((r) => setTimeout(r, 80));

  // "Deploy" — store + coordinator still exist; only the worker is new.
  let g3Ran = 0;
  const steps: ReplayableWorkflowStep<unknown>[] = [
    { id: 'g1', phase: 'generation', async run() { throw new Error('should not re-run g1'); } },
    { id: 'g2', phase: 'generation', async run() { throw new Error('should not re-run g2'); } },
    { id: 'g3', phase: 'generation', async run() { g3Ran += 1; } },
  ];
  const reco = createExecutionRecoveryCoordinator();
  const r = await reco.recoverExecution({ executionId: exec.executionId, workerId: 'w_post_deploy', steps, context: {} });
  return [
    expectEq('post-deploy recovery succeeded', r.status, 'recovered'),
    expectEq('only g3 ran', g3Ran, 1),
  ];
}

async function s9_recoveryDuringTransportRetryStorm(): Promise<Assertion[]> {
  // Simulate retry storm by having the step throw twice then succeed.
  const exec = await startExecution();
  await acquireOrigLease(exec.executionId, 'w_orig', 30);
  const { getDefaultDurableExecutionCoordinator } = await import('../../backend/services/threadRuntime/durableExecutionCoordinator');
  await getDefaultDurableExecutionCoordinator().transition({ executionId: exec.executionId, to: 'running' });
  await makeAcheckpoint(exec.executionId, 'persistence', [], ['persist_step']);
  await new Promise((r) => setTimeout(r, 80));

  let attempts = 0;
  const flakySteps: ReplayableWorkflowStep<unknown>[] = [
    {
      id: 'persist_step', phase: 'persistence',
      async run() {
        attempts += 1;
        if (attempts < 2) throw new Error('transient transport');
      },
    },
  ];
  const reco = createExecutionRecoveryCoordinator();
  const r1 = await reco.recoverExecution({ executionId: exec.executionId, workerId: 'w_r', steps: flakySteps, context: {} });
  // After failure, re-attempt with forceTakeover so the retry isn't gated by
  // the staleness check (r1's takeover refreshed the heartbeat).
  const r2 = await reco.recoverExecution({
    executionId: exec.executionId, workerId: 'w_r',
    steps: flakySteps, context: {}, forceTakeover: true,
  });
  return [
    expectEq('first attempt failed (unrecoverable)', r1.status, 'unrecoverable'),
    expectEq('second attempt succeeded', r2.status, 'recovered'),
    expectAtLeast('step ran multiple times across retries', attempts, 2),
  ];
}

async function s10_concurrentExecutionReclaim(): Promise<Assertion[]> {
  // Two workers race to recover same execution.
  const exec = await startExecution();
  await acquireOrigLease(exec.executionId, 'w_dead', 30);
  const { getDefaultDurableExecutionCoordinator } = await import('../../backend/services/threadRuntime/durableExecutionCoordinator');
  await getDefaultDurableExecutionCoordinator().transition({ executionId: exec.executionId, to: 'running' });
  await makeAcheckpoint(exec.executionId, 'generation', [], ['only_step']);
  await new Promise((r) => setTimeout(r, 80));

  let runs = 0;
  const steps: ReplayableWorkflowStep<unknown>[] = [
    {
      id: 'only_step', phase: 'generation',
      idempotency: { cls: 'node_insert', semanticParts: ['only'] },
      async run() { runs += 1; },
    },
  ];
  const reco = createExecutionRecoveryCoordinator();
  const [a, b] = await Promise.all([
    reco.recoverExecution({ executionId: exec.executionId, workerId: 'w_a', steps, context: {} }),
    reco.recoverExecution({ executionId: exec.executionId, workerId: 'w_b', steps, context: {} }),
  ]);
  const eitherRecovered = a.status === 'recovered' || b.status === 'recovered';
  // Both should NOT have run the side-effect; idempotency governor ensures at most one true execution.
  return [
    expectTrue('at least one recovery succeeded', eitherRecovered, 'truthy'),
    expectEq('side-effect ran exactly once', runs, 1),
  ];
}

async function s11_duplicateBillingReplayAttempt(): Promise<Assertion[]> {
  const exec = await startExecution();
  await acquireOrigLease(exec.executionId, 'w_orig', 30);
  const { getDefaultDurableExecutionCoordinator } = await import('../../backend/services/threadRuntime/durableExecutionCoordinator');
  await getDefaultDurableExecutionCoordinator().transition({ executionId: exec.executionId, to: 'running' });
  await makeAcheckpoint(exec.executionId, 'finalize', [], ['bill_step']);
  await new Promise((r) => setTimeout(r, 80));

  let billed = 0;
  const steps: ReplayableWorkflowStep<unknown>[] = [
    {
      id: 'bill_step', phase: 'finalize',
      idempotency: { cls: 'billing', semanticParts: ['order_42'] },
      async run() { billed += 1; },
    },
  ];
  const reco = createExecutionRecoveryCoordinator();
  await reco.recoverExecution({ executionId: exec.executionId, workerId: 'w_a', steps, context: {} });
  // Force a second recovery via a new "abandoned" scenario.
  await reco.recoverExecution({ executionId: exec.executionId, workerId: 'w_b', steps, context: {} });
  return [
    expectEq('billed exactly once across recovery attempts', billed, 1),
  ];
}

async function s12_orphanTopologyReplayContinuation(): Promise<Assertion[]> {
  const exec = await startExecution();
  await acquireOrigLease(exec.executionId, 'w_orig', 30);
  const { getDefaultDurableExecutionCoordinator } = await import('../../backend/services/threadRuntime/durableExecutionCoordinator');
  await getDefaultDurableExecutionCoordinator().transition({ executionId: exec.executionId, to: 'running' });
  // Checkpoint where pendingTopologyMutationIds carry orphan ids.
  await makeAcheckpoint(exec.executionId, 'topology_settle', ['t1'], ['t2'], {
    pendingTopologyMutationIds: ['orphan_X'],
  });
  await new Promise((r) => setTimeout(r, 80));

  let t2Ran = 0;
  const steps: ReplayableWorkflowStep<unknown>[] = [
    { id: 't1', phase: 'topology_settle', async run() { throw new Error('should not re-run t1'); } },
    { id: 't2', phase: 'topology_settle', async run() { t2Ran += 1; } },
  ];
  const reco = createExecutionRecoveryCoordinator();
  const r = await reco.recoverExecution({ executionId: exec.executionId, workerId: 'w_r', steps, context: {} });

  // Forensic analyzer should surface the pending topology mutation as part of consistency notes.
  const analyzer = createRecoveryForensicAnalyzer();
  const report = await analyzer.analyze({ executionId: exec.executionId });

  return [
    expectEq('recovery succeeded', r.status, 'recovered'),
    expectEq('t2 ran exactly once', t2Ran, 1),
    expectTrue('forensic report includes execution id', report.oneLine.includes(exec.executionId), 'contains'),
  ];
}

// ── Runner ──────────────────────────────────────────────────────────

async function main() {
  const scenarios: Array<{ name: string; run: () => Promise<Assertion[]> }> = [
    { name: '1. process crash mid-generation', run: s1_processCrashMidGeneration },
    { name: '2. restart during topology mutation', run: s2_restartDuringTopologyMutation },
    { name: '3. stale worker lease expiration', run: s3_staleWorkerLeaseExpiration },
    { name: '4. replay after partial checkpoint write', run: s4_replayAfterPartialCheckpointWrite },
    { name: '5. duplicate recovery attempt', run: s5_duplicateRecoveryAttempt },
    { name: '6. split-brain takeover attempt', run: s6_splitBrainTakeoverAttempt },
    { name: '7. partial persistence completion', run: s7_partialPersistenceCompletion },
    { name: '8. replay after deploy restart', run: s8_replayAfterDeployRestart },
    { name: '9. recovery during transport retry storm', run: s9_recoveryDuringTransportRetryStorm },
    { name: '10. concurrent execution reclaim', run: s10_concurrentExecutionReclaim },
    { name: '11. duplicate billing replay attempt', run: s11_duplicateBillingReplayAttempt },
    { name: '12. orphan topology replay continuation', run: s12_orphanTopologyReplayContinuation },
  ];

  const results: ScenarioResult[] = [];
  for (const s of scenarios) {
    results.push(await runScenario(s.name, s.run));
  }

  const passed = results.filter((r) => r.passed).length;
  for (const r of results) {
    const tag = r.passed ? '[PASS]' : '[FAIL]';
    process.stdout.write(`\n${tag} ${r.name}\n`);
    if (r.err) process.stdout.write(`   ERR: ${r.err}\n`);
    for (const a of r.assertions) {
      const mark = a.ok ? '✓' : '✗';
      process.stdout.write(`   ${mark} ${a.label}: ${JSON.stringify(a.actual)} (${a.expected})\n`);
    }
  }
  process.stdout.write('\n─'.repeat(55) + '\n');
  process.stdout.write(` Overall: ${passed}/${results.length} scenarios passed\n`);
  process.stdout.write('═'.repeat(55) + '\n');
  if (passed !== results.length) process.exitCode = 1;
}

void main();
