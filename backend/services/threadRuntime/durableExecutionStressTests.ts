/**
 * Phase 10 — Durable execution stress tests.
 *
 * 1 baseline + 10 adversarial + 1 end-to-end scenario, exercising every
 * module of the durable execution layer.
 *
 * Run via:
 *   npx tsx scripts/ops/longFormDurableExecutionStress.ts
 */

import { createInMemoryExecutionStore } from './executionStore';
import { createDurableExecutionCoordinator } from './durableExecutionCoordinator';
import { createExecutionCheckpointManager } from './executionCheckpointManager';
import { createExecutionLeaseGovernor } from './executionLeaseGovernor';
import { createResumableWorkflowEngine, type WorkflowStep } from './resumableWorkflowEngine';
import {
  createExecutionIdempotencyGovernor,
  createInMemoryIdempotencyBackend,
} from './executionIdempotencyGovernor';
import { createDeterministicRecoveryCoordinator } from './deterministicRecoveryCoordinator';
import { createInProcessExecutionAdapter } from './distributedExecutionAdapter';
import { analyzeExecutionForensics } from './executionForensicAnalyzer';
import { createDurableExecutionDiagnosticsRegistry } from './durableExecutionDiagnostics';

interface Ctx { mutationsRun: string[]; tripWires: Set<string> }

function buildContext(): Ctx { return { mutationsRun: [], tripWires: new Set() }; }

function buildSteps(executionId: string, ctx: Ctx, idem: ReturnType<typeof createExecutionIdempotencyGovernor>): WorkflowStep<Ctx>[] {
  return [
    {
      id: 'gen.step1', phase: 'generation',
      async run(c) {
        if (c.tripWires.has('gen.step1')) throw new Error('forced trip in gen.step1');
        const r = await idem.exec(
          { executionId, cls: 'node_insert', semanticParts: ['gen', 'step1'] },
          async () => { c.mutationsRun.push('gen.step1'); return 'ok'; },
        );
        if (r.outcome === 'suppressed') c.mutationsRun.push('gen.step1[suppressed]');
      },
    },
    {
      id: 'persist.step1', phase: 'persistence',
      async run(c) {
        if (c.tripWires.has('persist.step1')) throw new Error('forced trip in persist.step1');
        const r = await idem.exec(
          { executionId, cls: 'topology_mutation', semanticParts: ['persist', 'step1'] },
          async () => { c.mutationsRun.push('persist.step1'); return 'ok'; },
        );
        if (r.outcome === 'suppressed') c.mutationsRun.push('persist.step1[suppressed]');
      },
    },
    {
      id: 'finalize.step1', phase: 'finalize',
      async run(c) {
        const r = await idem.exec(
          { executionId, cls: 'billing', semanticParts: ['finalize'] },
          async () => { c.mutationsRun.push('finalize.step1'); return 'ok'; },
        );
        if (r.outcome === 'suppressed') c.mutationsRun.push('finalize.step1[suppressed]');
      },
    },
  ];
}

// ── assertion infra ────────────────────────────────────────────────────

export interface ExecAssertion { name: string; passed: boolean; observed: string | number; expected: string }
export interface ExecScenarioResult { scenario: string; assertions: ExecAssertion[]; passed: boolean }
function ok(name: string, observed: string | number, passed: boolean, expected: string): ExecAssertion {
  return { name, observed, passed, expected };
}

// ── scenarios ──────────────────────────────────────────────────────────

async function scenario_baseline(): Promise<ExecScenarioResult> {
  const store = createInMemoryExecutionStore();
  const coordinator = createDurableExecutionCoordinator({ store });
  const checkpoints = createExecutionCheckpointManager({ store });
  const idem = createExecutionIdempotencyGovernor({ backend: createInMemoryIdempotencyBackend() });
  const engine = createResumableWorkflowEngine({ coordinator, checkpointManager: checkpoints });

  const exec = await coordinator.start({ runtimeSessionId: 'rs', threadId: 't', companyId: 'c' });
  const ctx = buildContext();
  const result = await engine.resume({ executionId: exec.executionId, steps: buildSteps(exec.executionId, ctx, idem), context: ctx });
  const final = await coordinator.get(exec.executionId);
  return {
    scenario: 'baseline. happy-path 3-step execution',
    passed: true,
    assertions: [
      ok('all 3 steps ran', result.ranStepIds.length, result.ranStepIds.length === 3, '3'),
      ok('no failures', result.failedStepIds.length, result.failedStepIds.length === 0, '0'),
      ok('execution completed', final?.executionStatus ?? '(none)', final?.executionStatus === 'completed', 'completed'),
    ],
  };
}

async function scenario1_crashMidGeneration(): Promise<ExecScenarioResult> {
  // Simulate crash by tripping the second step, then resuming.
  const store = createInMemoryExecutionStore();
  const coordinator = createDurableExecutionCoordinator({ store });
  const checkpoints = createExecutionCheckpointManager({ store });
  const idem = createExecutionIdempotencyGovernor({ backend: createInMemoryIdempotencyBackend() });
  const engine = createResumableWorkflowEngine({ coordinator, checkpointManager: checkpoints });
  const exec = await coordinator.start({ runtimeSessionId: 'rs', threadId: 't', companyId: 'c' });

  // First run with persist.step1 tripping → execution stays in running
  const ctx1 = buildContext();
  ctx1.tripWires.add('persist.step1');
  await engine.resume({ executionId: exec.executionId, steps: buildSteps(exec.executionId, ctx1, idem), context: ctx1 });

  // Second run (no trip wire); resumable engine skips gen.step1, runs persist.step1 + finalize.step1
  const ctx2 = buildContext();
  const r2 = await engine.resume({ executionId: exec.executionId, steps: buildSteps(exec.executionId, ctx2, idem), context: ctx2 });
  const final = await coordinator.get(exec.executionId);
  return {
    scenario: '1. process crash mid-generation (resume)',
    passed: true,
    assertions: [
      ok('first run completed gen.step1', ctx1.mutationsRun.includes('gen.step1') ? 'yes' : 'no',
        ctx1.mutationsRun.includes('gen.step1'), 'yes'),
      ok('first run did NOT complete persist.step1', ctx1.mutationsRun.includes('persist.step1') ? 'yes' : 'no',
        !ctx1.mutationsRun.includes('persist.step1'), 'no'),
      ok('second run skipped gen.step1', r2.skippedStepIds.includes('gen.step1') ? 'yes' : 'no',
        r2.skippedStepIds.includes('gen.step1'), 'yes'),
      ok('second run ran persist.step1', r2.ranStepIds.includes('persist.step1') ? 'yes' : 'no',
        r2.ranStepIds.includes('persist.step1'), 'yes'),
      ok('final status completed', final?.executionStatus ?? '(none)', final?.executionStatus === 'completed', 'completed'),
    ],
  };
}

async function scenario2_restartDuringTopologyMutation(): Promise<ExecScenarioResult> {
  // Specifically that a partial mutation doesn't re-fire after restart.
  const store = createInMemoryExecutionStore();
  const coordinator = createDurableExecutionCoordinator({ store });
  const checkpoints = createExecutionCheckpointManager({ store });
  const idem = createExecutionIdempotencyGovernor({ backend: createInMemoryIdempotencyBackend() });
  const engine = createResumableWorkflowEngine({ coordinator, checkpointManager: checkpoints });
  const exec = await coordinator.start({ runtimeSessionId: 'rs', threadId: 't', companyId: 'c' });

  const ctx1 = buildContext();
  await engine.resume({ executionId: exec.executionId, steps: buildSteps(exec.executionId, ctx1, idem), context: ctx1 });
  // Simulate restart: re-run; idempotency should suppress everything.
  const ctx2 = buildContext();
  await engine.resume({ executionId: exec.executionId, steps: buildSteps(exec.executionId, ctx2, idem), context: ctx2 });
  return {
    scenario: '2. restart during topology mutation (idempotency)',
    passed: true,
    assertions: [
      ok('first pass ran 3 mutations', ctx1.mutationsRun.length, ctx1.mutationsRun.length === 3, '3'),
      ok('second pass ran 0 NEW mutations', ctx2.mutationsRun.filter((m) => !m.includes('suppressed')).length,
        ctx2.mutationsRun.filter((m) => !m.includes('suppressed')).length === 0, '0'),
    ],
  };
}

async function scenario3_staleWorkerLease(): Promise<ExecScenarioResult> {
  const store = createInMemoryExecutionStore();
  const lease = createExecutionLeaseGovernor({ store });
  const coordinator = createDurableExecutionCoordinator({ store });
  const exec = await coordinator.start({ runtimeSessionId: 'rs', threadId: 't', companyId: 'c' });
  const t0 = 1_700_000_000_000;
  await lease.claim({ executionId: exec.executionId, workerId: 'w1', durationMs: 1000, nowMs: t0 });
  // Time passes; lease expires.
  const t1 = t0 + 2000;
  const swept = await lease.sweepExpired({ nowMs: t1 });
  // Try to claim again with another worker.
  const claim2 = await lease.claim({ executionId: exec.executionId, workerId: 'w2', durationMs: 1000, nowMs: t1 });
  return {
    scenario: '3. stale worker lease (sweep + reclaim)',
    passed: true,
    assertions: [
      ok('one lease swept', swept.length, swept.length === 1, '1'),
      ok('w2 successfully claims', claim2.ok ? 'true' : 'false', claim2.ok, 'true'),
    ],
  };
}

async function scenario4_replayAfterCheckpointCorruption(): Promise<ExecScenarioResult> {
  const store = createInMemoryExecutionStore();
  const checkpoints = createExecutionCheckpointManager({ store });
  const coordinator = createDurableExecutionCoordinator({ store });
  const exec = await coordinator.start({ runtimeSessionId: 'rs', threadId: 't', companyId: 'c' });
  const cp = await checkpoints.capture({
    executionId: exec.executionId,
    phase: 'generation',
    newlyCompleted: ['gen.step1', 'gen.step1'], // duplicate
    pending: ['gen.step1'], // overlapping with completed
  });
  const got = await store.getCheckpoint(cp.checkpointId);
  return {
    scenario: '4. checkpoint capture dedupes duplicates',
    passed: true,
    assertions: [
      ok('completed set deduped', got?.completedNodeOperationIds.length ?? 0,
        got?.completedNodeOperationIds.length === 1, '1'),
      ok('pending excludes completed', got?.pendingNodeOperationIds.length ?? 0,
        got?.pendingNodeOperationIds.length === 0, '0'),
    ],
  };
}

async function scenario5_duplicateRecoveryAttempt(): Promise<ExecScenarioResult> {
  // Two recoveries triggered for the same execution. Lease ensures only one wins.
  const store = createInMemoryExecutionStore();
  const lease = createExecutionLeaseGovernor({ store });
  const coordinator = createDurableExecutionCoordinator({ store });
  const exec = await coordinator.start({ runtimeSessionId: 'rs', threadId: 't', companyId: 'c' });
  // Transition to failed so it's eligible for recovery.
  await coordinator.transition({ executionId: exec.executionId, to: 'running' });
  await coordinator.transition({ executionId: exec.executionId, to: 'failed', failureReason: 'manual' });

  const claimA = await lease.claim({ executionId: exec.executionId, workerId: 'recoveryA', durationMs: 60_000 });
  const claimB = await lease.claim({ executionId: exec.executionId, workerId: 'recoveryB', durationMs: 60_000 });
  return {
    scenario: '5. duplicate recovery attempt (lease arbitration)',
    passed: true,
    assertions: [
      ok('first claim wins', claimA.ok ? 'true' : 'false', claimA.ok, 'true'),
      ok('second claim refused', !claimB.ok ? 'true' : 'false', !claimB.ok, 'true'),
      ok('second claim names the conflicting owner', claimB.ok === false ? claimB.currentOwner ?? '(none)' : '(claimed)',
        claimB.ok === false && claimB.currentOwner === 'recoveryA', 'recoveryA'),
    ],
  };
}

async function scenario6_partialPersistenceCompletion(): Promise<ExecScenarioResult> {
  // Persistence step partially completes, then we resume; the partial work should NOT replay.
  const store = createInMemoryExecutionStore();
  const coordinator = createDurableExecutionCoordinator({ store });
  const checkpoints = createExecutionCheckpointManager({ store });
  const idem = createExecutionIdempotencyGovernor({ backend: createInMemoryIdempotencyBackend() });
  const engine = createResumableWorkflowEngine({ coordinator, checkpointManager: checkpoints });
  const exec = await coordinator.start({ runtimeSessionId: 'rs', threadId: 't', companyId: 'c' });

  // First run: gen.step1 succeeds; persist.step1 is partially-applied (idem records fingerprint), then trips.
  const ctx1 = buildContext();
  // Manually pre-record the persist.step1 fingerprint to simulate partial completion.
  await idem.guard({ executionId: exec.executionId, cls: 'topology_mutation', semanticParts: ['persist', 'step1'] });
  ctx1.tripWires.add('finalize.step1');
  await engine.resume({ executionId: exec.executionId, steps: buildSteps(exec.executionId, ctx1, idem), context: ctx1 });

  // Second run: no trip wire.
  const ctx2 = buildContext();
  await engine.resume({ executionId: exec.executionId, steps: buildSteps(exec.executionId, ctx2, idem), context: ctx2 });
  return {
    scenario: '6. partial persistence completion (no replay)',
    passed: true,
    assertions: [
      ok('persist.step1 suppressed in first run', ctx1.mutationsRun.includes('persist.step1[suppressed]') ? 'yes' : 'no',
        ctx1.mutationsRun.includes('persist.step1[suppressed]'), 'yes'),
    ],
  };
}

async function scenario7_executionTakeoverAfterTimeout(): Promise<ExecScenarioResult> {
  const store = createInMemoryExecutionStore();
  const lease = createExecutionLeaseGovernor({ store });
  const coordinator = createDurableExecutionCoordinator({ store });
  const exec = await coordinator.start({ runtimeSessionId: 'rs', threadId: 't', companyId: 'c' });
  const t0 = 2_000_000_000_000;
  await lease.claim({ executionId: exec.executionId, workerId: 'w1', durationMs: 100, nowMs: t0 });
  const t1 = t0 + 500;
  const takeover = await lease.claimWithTakeover({ executionId: exec.executionId, workerId: 'w2', durationMs: 1000, nowMs: t1 });
  return {
    scenario: '7. execution takeover after timeout',
    passed: true,
    assertions: [
      ok('takeover succeeded', takeover.ok ? 'true' : 'false', takeover.ok, 'true'),
      ok('takeover names previous owner', takeover.ok && takeover.tookOverFrom ? takeover.tookOverFrom : '(none)',
        takeover.ok && takeover.tookOverFrom === 'w1', 'w1'),
    ],
  };
}

async function scenario8_doubleWorkerRace(): Promise<ExecScenarioResult> {
  // Two workers race to claim the same pending execution via the adapter.
  const store = createInMemoryExecutionStore();
  const coordinator = createDurableExecutionCoordinator({ store });
  const lease = createExecutionLeaseGovernor({ store });
  const adapter = createInProcessExecutionAdapter({ coordinator, leaseGovernor: lease, store });
  const exec = await adapter.submit({ runtimeSessionId: 'rs', threadId: 't', companyId: 'c' });

  // Race: both attempt to claim.
  const [a, b] = await Promise.all([
    adapter.claimNext({ workerId: 'wA' }),
    adapter.claimNext({ workerId: 'wB' }),
  ]);
  void exec;
  return {
    scenario: '8. double-worker race (mutually exclusive claim)',
    passed: true,
    assertions: [
      ok('exactly one claim succeeded', String(a !== null) + ',' + String(b !== null),
        (a !== null) !== (b !== null), 'one true, one false'),
    ],
  };
}

async function scenario9_replayAfterDeployRestart(): Promise<ExecScenarioResult> {
  // Simulate a deploy: persist state, drop everything in-memory except the store.
  const store = createInMemoryExecutionStore();
  const coordinator1 = createDurableExecutionCoordinator({ store });
  const checkpoints1 = createExecutionCheckpointManager({ store });
  const idem1 = createExecutionIdempotencyGovernor({ backend: createInMemoryIdempotencyBackend() });
  const engine1 = createResumableWorkflowEngine({ coordinator: coordinator1, checkpointManager: checkpoints1 });

  const exec = await coordinator1.start({ runtimeSessionId: 'rs', threadId: 't', companyId: 'c' });
  const ctx1 = buildContext();
  ctx1.tripWires.add('persist.step1');
  await engine1.resume({ executionId: exec.executionId, steps: buildSteps(exec.executionId, ctx1, idem1), context: ctx1 });

  // "Deploy" — instantiate fresh coordinator/engine but reuse store.
  const coordinator2 = createDurableExecutionCoordinator({ store });
  const checkpoints2 = createExecutionCheckpointManager({ store });
  const idem2 = createExecutionIdempotencyGovernor({ backend: createInMemoryIdempotencyBackend() }); // fresh
  const engine2 = createResumableWorkflowEngine({ coordinator: coordinator2, checkpointManager: checkpoints2 });

  const ctx2 = buildContext();
  const r2 = await engine2.resume({ executionId: exec.executionId, steps: buildSteps(exec.executionId, ctx2, idem2), context: ctx2 });
  const final = await coordinator2.get(exec.executionId);
  return {
    scenario: '9. replay after deploy restart',
    passed: true,
    assertions: [
      ok('post-restart engine skipped gen.step1', r2.skippedStepIds.includes('gen.step1') ? 'yes' : 'no',
        r2.skippedStepIds.includes('gen.step1'), 'yes'),
      ok('post-restart engine ran persist.step1', r2.ranStepIds.includes('persist.step1') ? 'yes' : 'no',
        r2.ranStepIds.includes('persist.step1'), 'yes'),
      ok('final status completed', final?.executionStatus ?? '(none)', final?.executionStatus === 'completed', 'completed'),
    ],
  };
}

async function scenario10_recoveryDuringRetryStorm(): Promise<ExecScenarioResult> {
  // Recovery coordinator handles a failed execution.
  const store = createInMemoryExecutionStore();
  const coordinator = createDurableExecutionCoordinator({ store });
  const checkpoints = createExecutionCheckpointManager({ store });
  const lease = createExecutionLeaseGovernor({ store });
  const idem = createExecutionIdempotencyGovernor({ backend: createInMemoryIdempotencyBackend() });
  const engine = createResumableWorkflowEngine({ coordinator, checkpointManager: checkpoints });
  const recoveryCoord = createDeterministicRecoveryCoordinator({
    coordinator, leaseGovernor: lease, checkpointManager: checkpoints,
    idempotencyGovernor: idem, workflowEngine: engine,
  });

  const exec = await coordinator.start({ runtimeSessionId: 'rs', threadId: 't', companyId: 'c' });
  const ctx1 = buildContext();
  ctx1.tripWires.add('persist.step1');
  await engine.resume({ executionId: exec.executionId, steps: buildSteps(exec.executionId, ctx1, idem), context: ctx1 });
  await coordinator.transition({ executionId: exec.executionId, to: 'failed', failureReason: 'forced' });

  const ctx2 = buildContext();
  const rec = await recoveryCoord.recover({
    executionId: exec.executionId,
    workerId: 'recoverer',
    steps: buildSteps(exec.executionId, ctx2, idem),
    context: ctx2,
  });

  return {
    scenario: '10. recovery during retry storm',
    passed: true,
    assertions: [
      ok('recovery completed execution', rec.execution.executionStatus, rec.execution.executionStatus === 'completed', 'completed'),
      ok('recovery determinism score reported', rec.determinism.recoveryDeterminismScore,
        rec.determinism.recoveryDeterminismScore >= 0 && rec.determinism.recoveryDeterminismScore <= 100, '0..100'),
      ok('zero divergent replays', rec.determinism.divergentReplaysDetected,
        rec.determinism.divergentReplaysDetected === 0, '0'),
    ],
  };
}

async function scenario_endToEnd(): Promise<ExecScenarioResult> {
  const store = createInMemoryExecutionStore();
  const coordinator = createDurableExecutionCoordinator({ store });
  const checkpoints = createExecutionCheckpointManager({ store });
  const idem = createExecutionIdempotencyGovernor({ backend: createInMemoryIdempotencyBackend() });
  const engine = createResumableWorkflowEngine({ coordinator, checkpointManager: checkpoints });
  const diag = createDurableExecutionDiagnosticsRegistry();

  const exec = await coordinator.start({ runtimeSessionId: 'rs', threadId: 't', companyId: 'co_e2e' });
  const ctx = buildContext();
  await engine.resume({ executionId: exec.executionId, steps: buildSteps(exec.executionId, ctx, idem), context: ctx });

  const forensics = await analyzeExecutionForensics({ executionId: exec.executionId, store, idempotencyGovernor: idem });
  const executions = await store.listExecutions({ companyId: 'co_e2e' });
  const checkpointMap: Record<string, Awaited<ReturnType<typeof checkpoints.list>>> = {};
  for (const e of executions) checkpointMap[e.executionId] = await checkpoints.list(e.executionId);

  diag.record({
    timestamp: new Date().toISOString(),
    companyId: 'co_e2e',
    executions,
    checkpoints: checkpointMap,
    idempotencySuppressionTotal: await idem.totalSuppressionCount(),
  });
  const built = diag.build('co_e2e');

  return {
    scenario: '11. end-to-end durable execution',
    passed: true,
    assertions: [
      ok('forensics reports recovery consistency', forensics.recoveryConsistencyAssessment.score >= 0 ? 'set' : '(none)',
        forensics.recoveryConsistencyAssessment.score >= 0, 'set'),
      ok('diagnostics sample size = 1', built.sampleSize, built.sampleSize === 1, '1'),
      ok('replay continuation success ≥ 0', built.replayContinuationSuccessRatePercent,
        built.replayContinuationSuccessRatePercent >= 0 && built.replayContinuationSuccessRatePercent <= 100, '0..100'),
    ],
  };
}

// ── suite ──────────────────────────────────────────────────────────────

export interface DurableStressSuiteReport {
  scenarios: ExecScenarioResult[];
  overall: { total: number; passed: number; failed: number };
}

function finalize(r: ExecScenarioResult): ExecScenarioResult {
  r.passed = r.assertions.every((a) => a.passed);
  return r;
}

export async function runDurableExecutionStressTests(): Promise<DurableStressSuiteReport> {
  const scenarios: ExecScenarioResult[] = [];
  scenarios.push(await scenario_baseline());
  scenarios.push(await scenario1_crashMidGeneration());
  scenarios.push(await scenario2_restartDuringTopologyMutation());
  scenarios.push(await scenario3_staleWorkerLease());
  scenarios.push(await scenario4_replayAfterCheckpointCorruption());
  scenarios.push(await scenario5_duplicateRecoveryAttempt());
  scenarios.push(await scenario6_partialPersistenceCompletion());
  scenarios.push(await scenario7_executionTakeoverAfterTimeout());
  scenarios.push(await scenario8_doubleWorkerRace());
  scenarios.push(await scenario9_replayAfterDeployRestart());
  scenarios.push(await scenario10_recoveryDuringRetryStorm());
  scenarios.push(await scenario_endToEnd());
  const finalized = scenarios.map(finalize);
  const passed = finalized.filter((s) => s.passed).length;
  return { scenarios: finalized, overall: { total: finalized.length, passed, failed: finalized.length - passed } };
}

export function formatDurableStressReport(report: DurableStressSuiteReport): string {
  const lines: string[] = [];
  lines.push('═══════════════════════════════════════════════════════');
  lines.push(' Durable execution stress suite');
  lines.push('═══════════════════════════════════════════════════════');
  for (const s of report.scenarios) {
    lines.push('');
    lines.push(`${s.passed ? '[PASS]' : '[FAIL]'} ${s.scenario}`);
    for (const a of s.assertions) {
      lines.push(`   ${a.passed ? '✓' : '✗'} ${a.name}: ${a.observed} (${a.expected})`);
    }
  }
  lines.push('');
  lines.push('───────────────────────────────────────────────────────');
  lines.push(` Overall: ${report.overall.passed}/${report.overall.total} scenarios passed`);
  lines.push('═══════════════════════════════════════════════════════');
  return lines.join('\n');
}
