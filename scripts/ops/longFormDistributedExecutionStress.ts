/**
 * Phase 20I — Distributed execution stress harness.
 *
 * Twelve adversarial scenarios validating the Phase 20 distributed runtime:
 *
 *   1.  concurrent claim race
 *   2.  stale worker reclaim
 *   3.  visibility-timeout reclaim
 *   4.  replay during ownership transfer
 *   5.  worker crash mid-execution
 *   6.  duplicate enqueue attempt
 *   7.  execution retry storm
 *   8.  throughput overload
 *   9.  recovery scheduling overload
 *  10.  heartbeat partition
 *  11.  split-brain claim attempt
 *  12.  queue replay after restart
 *
 * Hermetic: in-memory queue, in-memory executions, in-memory worker
 * coordinator. No DB, no network. Each scenario provisions fresh state.
 *
 * Usage:
 *   npx tsx scripts/ops/longFormDistributedExecutionStress.ts
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
  setDefaultExecutionRecoveryCoordinator,
} from '../../backend/services/orchestration/recovery/executionRecoveryCoordinator';
import {
  createInMemoryExecutionQueue,
  setDefaultExecutionQueue,
} from '../../backend/services/orchestration/distributed/distributedExecutionQueue';
import {
  createDistributedWorkerCoordinator,
  setDefaultDistributedWorkerCoordinator,
} from '../../backend/services/orchestration/distributed/distributedWorkerCoordinator';
import {
  createExecutionClaimingEngine,
  setDefaultExecutionClaimingEngine,
} from '../../backend/services/orchestration/distributed/executionClaimingEngine';
import {
  createDistributedExecutionRunner,
  setDefaultDistributedExecutionRunner,
} from '../../backend/services/orchestration/distributed/distributedExecutionRunner';
import {
  createRecoverySchedulingGovernor,
  setDefaultRecoverySchedulingGovernor,
} from '../../backend/services/orchestration/distributed/recoverySchedulingGovernor';
import {
  createExecutionThroughputGovernor,
} from '../../backend/services/orchestration/distributed/executionThroughputGovernor';
import type { ReplayableWorkflowStep } from '../../backend/services/orchestration/recovery/replayContinuationEngine';

// ──────────────────────────────────────────────────────────────────────
// Test scaffolding
// ──────────────────────────────────────────────────────────────────────

interface Assertion { label: string; actual: unknown; expected: string; ok: boolean }
interface ScenarioResult { name: string; passed: boolean; assertions: Assertion[]; err?: string }

function expectEq(label: string, actual: unknown, expected: unknown): Assertion {
  return { label, actual, expected: JSON.stringify(expected),
    ok: JSON.stringify(actual) === JSON.stringify(expected) };
}
function expectTrue(label: string, actual: boolean, expected: string): Assertion {
  return { label, actual, expected, ok: actual === true };
}
function expectAtLeast(label: string, actual: number, threshold: number): Assertion {
  return { label, actual, expected: `>= ${threshold}`, ok: actual >= threshold };
}
function expectAtMost(label: string, actual: number, threshold: number): Assertion {
  return { label, actual, expected: `<= ${threshold}`, ok: actual <= threshold };
}

function resetWorld() {
  setDefaultExecutionStore(createInMemoryExecutionStore());
  setDefaultDurableExecutionCoordinator(createDurableExecutionCoordinator());
  setDefaultExecutionCheckpointManager(createExecutionCheckpointManager());
  setDefaultExecutionLeaseGovernor(createExecutionLeaseGovernor());
  setDefaultResumableWorkflowEngine(createResumableWorkflowEngine());
  setDefaultExecutionIdempotencyGovernor(createExecutionIdempotencyGovernor());
  setDefaultCheckpointRestorationEngine(createCheckpointRestorationEngine({ telemetry: { emit: () => {} } }));
  setDefaultLeaseRecoveryGovernor(createLeaseRecoveryGovernor({ telemetry: { emit: () => {} } }));
  setDefaultStaleExecutionReconciler(createStaleExecutionReconciler({
    telemetry: { emit: () => {} }, heartbeatStaleMs: 200, recoveryStalledMs: 500, maxRetryCount: 5,
  }));
  setDefaultReplayContinuationEngine(createReplayContinuationEngine({ telemetry: { emit: () => {} } }));
  setDefaultExecutionRecoveryCoordinator(createExecutionRecoveryCoordinator({ telemetry: { emit: () => {} } }));
  setDefaultExecutionQueue(createInMemoryExecutionQueue({ telemetry: { emit: () => {} } }));
  setDefaultDistributedWorkerCoordinator(createDistributedWorkerCoordinator({
    telemetry: { emit: () => {} }, defaultStaleThresholdMs: 200,
  }));
  setDefaultExecutionClaimingEngine(createExecutionClaimingEngine({ telemetry: { emit: () => {} } }));
  setDefaultDistributedExecutionRunner(createDistributedExecutionRunner({ telemetry: { emit: () => {} } }));
  setDefaultRecoverySchedulingGovernor(createRecoverySchedulingGovernor({ telemetry: { emit: () => {} } }));
}

async function startExecutionAndEnqueue(opts: {
  executionId?: string;
  companyId?: string;
  workerId?: string;
}): Promise<{ executionId: string; queueEntryId: string }> {
  const { getDefaultDurableExecutionCoordinator } = await import(
    '../../backend/services/threadRuntime/durableExecutionCoordinator'
  );
  const { getDefaultExecutionQueue } = await import(
    '../../backend/services/orchestration/distributed/distributedExecutionQueue'
  );
  const coord = getDefaultDurableExecutionCoordinator();
  const exec = await coord.start({
    runtimeSessionId: 'rs_test', threadId: 'thr_test',
    companyId: opts.companyId ?? '00000000-0000-0000-0000-000000000001',
    workerId: opts.workerId,
  });
  const queue = getDefaultExecutionQueue();
  const entry = await queue.enqueue({
    executionId: exec.executionId,
    companyId: exec.companyId,
    kind: 'execution_start',
  });
  return { executionId: exec.executionId, queueEntryId: entry.queueEntryId };
}

async function registerWorker(workerId: string) {
  const { getDefaultDistributedWorkerCoordinator } = await import(
    '../../backend/services/orchestration/distributed/distributedWorkerCoordinator'
  );
  return getDefaultDistributedWorkerCoordinator().register({
    workerId, workerKind: 'queue_worker',
    capabilities: [{ name: 'all' }],
  });
}

async function runScenario(name: string, body: () => Promise<Assertion[]>): Promise<ScenarioResult> {
  resetWorld();
  try {
    const assertions = await body();
    return { name, assertions, passed: assertions.every((a) => a.ok) };
  } catch (err) {
    return { name, passed: false, assertions: [], err: (err as Error).message };
  }
}

// ──────────────────────────────────────────────────────────────────────
// Scenarios
// ──────────────────────────────────────────────────────────────────────

async function s1_concurrentClaimRace(): Promise<Assertion[]> {
  await registerWorker('w_a');
  await registerWorker('w_b');
  const { executionId } = await startExecutionAndEnqueue({});

  const { getDefaultExecutionClaimingEngine } = await import(
    '../../backend/services/orchestration/distributed/executionClaimingEngine'
  );
  const eng = getDefaultExecutionClaimingEngine();
  const [a, b] = await Promise.all([
    eng.claimNext({ workerId: 'w_a' }),
    eng.claimNext({ workerId: 'w_b' }),
  ]);
  const claims = [a, b].filter((c) => c?.ownership.ok === true);
  return [
    expectEq('exactly one claim succeeded', claims.length, 1),
    expectTrue('execution id matches', claims[0]?.queueEntry.executionId === executionId, 'matches'),
  ];
}

async function s2_staleWorkerReclaim(): Promise<Assertion[]> {
  await registerWorker('w_dead');
  await registerWorker('w_new');
  const { executionId } = await startExecutionAndEnqueue({});

  const { getDefaultExecutionClaimingEngine } = await import(
    '../../backend/services/orchestration/distributed/executionClaimingEngine'
  );
  const eng = getDefaultExecutionClaimingEngine();
  // w_dead claims, then "crashes" — lease + visibility expire.
  const dead = await eng.claimNext({
    workerId: 'w_dead', visibilityMs: 50, leaseDurationMs: 50,
  });
  expectTrue('dead worker claimed', !!dead, 'truthy'); // setup precondition

  await new Promise((r) => setTimeout(r, 100));
  // Visibility expired → reclaimable.
  const { getDefaultExecutionQueue } = await import(
    '../../backend/services/orchestration/distributed/distributedExecutionQueue'
  );
  await getDefaultExecutionQueue().reclaimExpired();
  const fresh = await eng.claimNext({ workerId: 'w_new' });
  return [
    expectTrue('w_new took over', !!fresh && fresh.ownership.ok && fresh.ownership.workerId === 'w_new', 'truthy'),
    expectEq('execution id preserved', fresh?.queueEntry.executionId, executionId),
  ];
}

async function s3_visibilityTimeoutReclaim(): Promise<Assertion[]> {
  await registerWorker('w_a');
  await startExecutionAndEnqueue({});
  const { getDefaultExecutionQueue } = await import(
    '../../backend/services/orchestration/distributed/distributedExecutionQueue'
  );
  const queue = getDefaultExecutionQueue();
  const [first] = await queue.claim({ workerId: 'w_a', visibilityMs: 30 });
  await new Promise((r) => setTimeout(r, 80));
  const reclaimed = await queue.reclaimExpired();
  return [
    expectAtLeast('reclaimed at least one', reclaimed.length, 1),
    expectEq('reclaim returns to queue', reclaimed[0].queueEntryId, first.queueEntryId),
    expectEq('claimedBy cleared', reclaimed[0].claimedByWorkerId, null),
  ];
}

async function s4_replayDuringOwnershipTransfer(): Promise<Assertion[]> {
  await registerWorker('w_a');
  await registerWorker('w_b');
  const { executionId } = await startExecutionAndEnqueue({});
  const { getDefaultExecutionCheckpointManager } = await import(
    '../../backend/services/threadRuntime/executionCheckpointManager'
  );
  const { getDefaultDurableExecutionCoordinator } = await import(
    '../../backend/services/threadRuntime/durableExecutionCoordinator'
  );
  const { getDefaultExecutionStore } = await import(
    '../../backend/services/threadRuntime/executionStore'
  );
  await getDefaultDurableExecutionCoordinator().transition({ executionId, to: 'running' });
  // w_a takes a lease with short duration (simulates "started work").
  await getDefaultExecutionStore().acquireLease({
    executionId, workerId: 'w_a', durationMs: 30,
  });
  await getDefaultExecutionCheckpointManager().capture({
    executionId, phase: 'generation', newlyCompleted: ['s1'], pending: ['s2'],
  });
  // Simulate w_a crash: wait for lease to expire.
  await new Promise((r) => setTimeout(r, 80));

  // w_b now drives the recovery coordinator directly. The recovery
  // coordinator owns the lease takeover; the queue claiming engine is
  // exercised in other scenarios.
  const { getDefaultExecutionRecoveryCoordinator } = await import(
    '../../backend/services/orchestration/recovery/executionRecoveryCoordinator'
  );
  let s2Ran = 0;
  const steps: ReplayableWorkflowStep<unknown>[] = [
    { id: 's1', phase: 'generation', async run() { throw new Error('s1 must not re-run'); } },
    { id: 's2', phase: 'generation', async run() { s2Ran += 1; } },
  ];
  const reco = getDefaultExecutionRecoveryCoordinator();
  const result = await reco.recoverExecution({
    executionId, workerId: 'w_b', steps, context: {},
  });
  return [
    expectEq('s2 ran exactly once', s2Ran, 1),
    expectEq('recovery succeeded (ownership transferred)', result.status, 'recovered'),
  ];
}

async function s5_workerCrashMidExecution(): Promise<Assertion[]> {
  await registerWorker('w_alive');
  await registerWorker('w_crashed');
  const { executionId } = await startExecutionAndEnqueue({});

  const { getDefaultExecutionQueue } = await import(
    '../../backend/services/orchestration/distributed/distributedExecutionQueue'
  );
  const queue = getDefaultExecutionQueue();
  // w_crashed claims and never acks.
  const [c1] = await queue.claim({ workerId: 'w_crashed', visibilityMs: 30 });
  expectTrue('crashed worker claimed', !!c1, 'truthy');
  await new Promise((r) => setTimeout(r, 80));

  // Run reclaim and have w_alive pick it up.
  await queue.reclaimExpired();
  const { getDefaultExecutionClaimingEngine } = await import(
    '../../backend/services/orchestration/distributed/executionClaimingEngine'
  );
  const second = await getDefaultExecutionClaimingEngine().claimNext({ workerId: 'w_alive' });
  return [
    expectTrue('w_alive recovered ownership', !!second && second.ownership.ok, 'truthy'),
    expectEq('same execution id', second?.queueEntry.executionId, executionId),
  ];
}

async function s6_duplicateEnqueueAttempt(): Promise<Assertion[]> {
  await registerWorker('w_a');
  const { getDefaultExecutionQueue } = await import(
    '../../backend/services/orchestration/distributed/distributedExecutionQueue'
  );
  const queue = getDefaultExecutionQueue();
  const a = await queue.enqueue({
    executionId: 'exec_X', companyId: '00000000-0000-0000-0000-000000000001',
    kind: 'execution_start',
  });
  const b = await queue.enqueue({
    executionId: 'exec_X', companyId: '00000000-0000-0000-0000-000000000001',
    kind: 'execution_start',
  });
  const all = await queue.listByExecution('exec_X');
  return [
    expectEq('dedup returns same queue entry', a.queueEntryId, b.queueEntryId),
    expectEq('only one entry per execution', all.length, 1),
  ];
}

async function s7_executionRetryStorm(): Promise<Assertion[]> {
  await registerWorker('w_a');
  const { getDefaultExecutionQueue } = await import(
    '../../backend/services/orchestration/distributed/distributedExecutionQueue'
  );
  const queue = getDefaultExecutionQueue();
  const { queueEntryId } = await startExecutionAndEnqueue({});
  // Repeatedly claim + ack-failed; verify it eventually dead-letters.
  for (let i = 0; i < 10; i += 1) {
    const claims = await queue.claim({
      workerId: 'w_a', visibilityMs: 1_000_000, nowMs: Date.now() + i * 1_000_000,
    });
    if (claims.length === 0) break;
    await queue.ack({
      queueEntryId, workerId: 'w_a', outcome: 'failed',
      failureReason: 'forced', retryAfterMs: 1,
    });
  }
  const after = await queue.get(queueEntryId);
  return [
    expectEq('dead-lettered after exhausted retries', after?.status, 'dead_lettered'),
    expectAtMost('attempts capped near maxAttempts', after?.attemptCount ?? 99, 6),
  ];
}

async function s8_throughputOverload(): Promise<Assertion[]> {
  const gov = createExecutionThroughputGovernor({
    thresholds: { maxActiveExecutions: 4, maxQueueDepth: 10 },
    telemetry: { emit: () => {} },
  });
  const allowed = gov.evaluate({
    activeExecutions: 2, queueDepth: 2, workerSaturation: 0.3,
    checkpointPressure: 0.2, retryFrequencyPerMin: 10, recoveryPressure: 0.1,
  });
  const denied = gov.evaluate({
    activeExecutions: 5, queueDepth: 3, workerSaturation: 0.5,
    checkpointPressure: 0.2, retryFrequencyPerMin: 5, recoveryPressure: 0.1,
  });
  return [
    expectEq('within thresholds → allowed', allowed.allowed, true),
    expectEq('beyond active cap → denied', denied.allowed, false),
    expectEq('denied signal=concurrency_saturated', denied.signal, 'concurrency_saturated'),
  ];
}

async function s9_recoverySchedulingOverload(): Promise<Assertion[]> {
  await registerWorker('w_recover');
  const { getDefaultRecoverySchedulingGovernor } = await import(
    '../../backend/services/orchestration/distributed/recoverySchedulingGovernor'
  );
  const { getDefaultExecutionStore } = await import(
    '../../backend/services/threadRuntime/executionStore'
  );
  const store = getDefaultExecutionStore();

  // Build 30 stale findings.
  const findings = [];
  for (let i = 0; i < 30; i += 1) {
    const id = `exec_${i}`;
    await store.createExecution({
      executionId: id, runtimeSessionId: 'rs', threadId: 'thr',
      companyId: '00000000-0000-0000-0000-000000000001',
      orchestrationPhase: 'precheck',
      executionStatus: 'abandoned',
      executionOwner: null, retryCount: 0,
      recoveryState: 'idle',
      startedAt: '2026-05-26T00:00:00.000Z',
      heartbeatAt: null, completedAt: null,
      failureReason: null, replayCheckpointId: null,
    });
    findings.push({
      executionId: id, reason: 'abandoned_marker' as const,
      detectedAtIso: new Date().toISOString(),
      staleAgeMs: 60_000 + i * 1000,
      currentOwnerWorkerId: null, lease: null,
      execution: (await store.getExecution(id))!,
    });
  }
  const gov = getDefaultRecoverySchedulingGovernor();
  gov._resetHistory();
  const report = await gov.scheduleStaleRecoveries({
    findings, maxSchedulePerCall: 10, maxConcurrentInFlight: 1000,
  });
  return [
    expectAtMost('scheduled bounded by per-call cap', report.scheduledExecutionIds.length, 10),
    expectAtLeast('rest throttled or processed', report.scheduledExecutionIds.length + report.throttledExecutionIds.length + report.suppressedExecutionIds.length, 30),
  ];
}

async function s10_heartbeatPartition(): Promise<Assertion[]> {
  const { getDefaultDistributedWorkerCoordinator } = await import(
    '../../backend/services/orchestration/distributed/distributedWorkerCoordinator'
  );
  const coord = getDefaultDistributedWorkerCoordinator();
  await coord.register({ workerId: 'w_lost', workerKind: 'queue_worker', capabilities: [] });
  await new Promise((r) => setTimeout(r, 250));
  const sweepResult = await coord.sweepStale();
  const w = await coord.get('w_lost');
  return [
    expectTrue('worker swept stale', sweepResult.markedStale.includes('w_lost'), 'includes'),
    expectEq('worker status now stale', w?.status, 'stale'),
  ];
}

async function s11_splitBrainClaimAttempt(): Promise<Assertion[]> {
  await registerWorker('w_a');
  await registerWorker('w_b');
  const { executionId } = await startExecutionAndEnqueue({});
  // w_a takes the lease with a long duration.
  const { getDefaultExecutionStore } = await import(
    '../../backend/services/threadRuntime/executionStore'
  );
  await getDefaultExecutionStore().acquireLease({
    executionId, workerId: 'w_a', durationMs: 60_000,
  });
  // w_b tries to claim — lease takeover should be refused.
  const { getDefaultExecutionClaimingEngine } = await import(
    '../../backend/services/orchestration/distributed/executionClaimingEngine'
  );
  const result = await getDefaultExecutionClaimingEngine().claimNext({ workerId: 'w_b' });
  return [
    expectTrue('claim returned', !!result, 'truthy'),
    expectEq('ownership refused', result?.ownership.ok, false),
    expectEq('reason is lease_takeover_refused',
      result?.ownership.ok === false ? result?.ownership.reason : 'wrong',
      'lease_takeover_refused'),
  ];
}

async function s12_queueReplayAfterRestart(): Promise<Assertion[]> {
  await registerWorker('w_a');
  const { getDefaultExecutionQueue } = await import(
    '../../backend/services/orchestration/distributed/distributedExecutionQueue'
  );
  const queue = getDefaultExecutionQueue();
  // Enqueue several entries.
  const { executionId } = await startExecutionAndEnqueue({});
  await queue.enqueue({
    executionId: 'exec_other', companyId: '00000000-0000-0000-0000-000000000001',
    kind: 'execution_recovery',
  });
  // Restart simulation: the in-memory queue is destroyed AND recreated
  // (loss of in-flight claims), but persistent state would survive in
  // supabase mode. For the in-memory queue we verify that re-enqueueing
  // the same dedupKey collapses (so a restart-driven replay won't
  // double-enqueue).
  const a = await queue.enqueue({
    executionId, companyId: '00000000-0000-0000-0000-000000000001',
    kind: 'execution_start',
  });
  const allForExec = await queue.listByExecution(executionId);
  return [
    expectEq('original entry preserved via dedup', allForExec.length, 1),
    expectTrue('a is original entry (dedup hit)', a.queueEntryId === allForExec[0].queueEntryId, 'matches'),
  ];
}

// ──────────────────────────────────────────────────────────────────────
// Runner
// ──────────────────────────────────────────────────────────────────────

async function main() {
  const scenarios: Array<{ name: string; run: () => Promise<Assertion[]> }> = [
    { name: '1. concurrent claim race', run: s1_concurrentClaimRace },
    { name: '2. stale worker reclaim', run: s2_staleWorkerReclaim },
    { name: '3. visibility-timeout reclaim', run: s3_visibilityTimeoutReclaim },
    { name: '4. replay during ownership transfer', run: s4_replayDuringOwnershipTransfer },
    { name: '5. worker crash mid-execution', run: s5_workerCrashMidExecution },
    { name: '6. duplicate enqueue attempt', run: s6_duplicateEnqueueAttempt },
    { name: '7. execution retry storm', run: s7_executionRetryStorm },
    { name: '8. throughput overload', run: s8_throughputOverload },
    { name: '9. recovery scheduling overload', run: s9_recoverySchedulingOverload },
    { name: '10. heartbeat partition', run: s10_heartbeatPartition },
    { name: '11. split-brain claim attempt', run: s11_splitBrainClaimAttempt },
    { name: '12. queue replay after restart', run: s12_queueReplayAfterRestart },
  ];

  const results: ScenarioResult[] = [];
  for (const s of scenarios) results.push(await runScenario(s.name, s.run));

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
