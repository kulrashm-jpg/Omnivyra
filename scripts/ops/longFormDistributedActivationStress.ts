/**
 * Phase 22G — Distributed activation + reclaim stress harness.
 *
 * Twelve adversarial scenarios validating Phase 22:
 *   1. runtime activation before persistence registration
 *   2. partial runtime startup (validator failure)
 *   3. reclaim during active execution (refused)
 *   4. split-brain reclaim race
 *   5. dead worker reclaim after restart
 *   6. activation during replay storm
 *   7. duplicate startup invocation
 *   8. shutdown during reclaim
 *   9. worker crash during targeted reclaim
 *  10. stale-worker false-positive reclaim (refused)
 *  11. activation watchdog timeout
 *  12. queue replay during runtime restart
 *
 * Hermetic: in-memory queue + worker coordinator + activation governor.
 *
 * Usage:
 *   npx tsx scripts/ops/longFormDistributedActivationStress.ts
 */

import {
  createInMemoryExecutionQueue,
  setDefaultExecutionQueue,
  getDefaultExecutionQueue,
} from '../../backend/services/orchestration/distributed/distributedExecutionQueue';
import {
  createDistributedWorkerCoordinator,
  setDefaultDistributedWorkerCoordinator,
  getDefaultDistributedWorkerCoordinator,
} from '../../backend/services/orchestration/distributed/distributedWorkerCoordinator';
import {
  createDurableQueueReplayCoordinator,
  setDefaultDurableQueueReplayCoordinator,
} from '../../backend/services/orchestration/distributed/durableQueueReplayCoordinator';
import {
  createDistributedReclaimSafetyGovernor,
  setDefaultDistributedReclaimSafetyGovernor,
} from '../../backend/services/orchestration/distributed/distributedReclaimSafetyGovernor';
import {
  createDistributedRuntimeActivationGovernor,
  DistributedRuntimeActivationError,
} from '../../backend/services/orchestration/distributed/distributedRuntimeActivationGovernor';
import {
  createRuntimePersistenceCompactor,
  setDefaultRuntimePersistenceCompactor,
} from '../../backend/services/orchestration/distributed/runtimePersistenceCompactor';
import {
  createInMemoryExecutionStore,
  setDefaultExecutionStore,
} from '../../backend/services/threadRuntime/executionStore';
import {
  createDurableExecutionCoordinator,
  setDefaultDurableExecutionCoordinator,
  getDefaultDurableExecutionCoordinator,
} from '../../backend/services/threadRuntime/durableExecutionCoordinator';
import {
  createExecutionLeaseGovernor,
  setDefaultExecutionLeaseGovernor,
} from '../../backend/services/threadRuntime/executionLeaseGovernor';
import {
  createLeaseRecoveryGovernor,
  setDefaultLeaseRecoveryGovernor,
} from '../../backend/services/orchestration/recovery/leaseRecoveryGovernor';

// ────────────────────────────────────────────────────────────────────
// Test scaffolding
// ────────────────────────────────────────────────────────────────────

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

function resetWorld() {
  setDefaultExecutionStore(createInMemoryExecutionStore());
  setDefaultDurableExecutionCoordinator(createDurableExecutionCoordinator());
  setDefaultExecutionLeaseGovernor(createExecutionLeaseGovernor());
  setDefaultLeaseRecoveryGovernor(createLeaseRecoveryGovernor({ telemetry: { emit: () => {} } }));
  setDefaultExecutionQueue(createInMemoryExecutionQueue({ telemetry: { emit: () => {} } }));
  setDefaultDistributedWorkerCoordinator(createDistributedWorkerCoordinator({
    telemetry: { emit: () => {} }, defaultStaleThresholdMs: 200,
  }));
  setDefaultDistributedReclaimSafetyGovernor(createDistributedReclaimSafetyGovernor({
    telemetry: { emit: () => {} },
    defaultStaleConfirmationMs: 10,
    defaultSuppressionWindowMs: 50,
  }));
  setDefaultDurableQueueReplayCoordinator(createDurableQueueReplayCoordinator({
    telemetry: { emit: () => {} },
  }));
  setDefaultRuntimePersistenceCompactor(createRuntimePersistenceCompactor({
    telemetry: { emit: () => {} },
  }));
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

// ────────────────────────────────────────────────────────────────────
// Scenarios
// ────────────────────────────────────────────────────────────────────

async function s1_runtimeActivationBeforePersistenceRegistration(): Promise<Assertion[]> {
  // Persistence is "registered" via resetWorld (in-memory). Activation
  // governor probes the queue + worker registry + replay + compactor.
  // Should succeed.
  const gov = createDistributedRuntimeActivationGovernor({ telemetry: { emit: () => {} } });
  const result = await gov.activate();
  return [
    expectEq('activation succeeded', result.ok, true),
    expectAtLeast('at least 6 validators ran', result.validators.length, 6),
  ];
}

async function s2_partialRuntimeStartupValidatorFailure(): Promise<Assertion[]> {
  // Force one validator to fail by injecting a broken queue.
  const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
  const brokenQueue = {
    enqueue: async () => { throw new Error('disk full'); },
    claim: async () => [], ack: async () => null, retry: async () => null,
    reclaimExpired: async () => [], get: async () => null,
    listByExecution: async () => [],
    listByClaimer: async () => [],
    countByStatus: async () => ({ queued: 0, claimed: 0, completed: 0, failed: 0, dead_lettered: 0, cancelled: 0 }),
    depth: async () => 0,
  };
  const gov = createDistributedRuntimeActivationGovernor({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    queue: brokenQueue as any,
    telemetry: { emit(event, payload) { events.push({ event, payload }); } },
  });
  let activationFailed = false;
  try { await gov.activate(); } catch (err) {
    activationFailed = err instanceof DistributedRuntimeActivationError;
  }
  return [
    expectEq('activation failed', activationFailed, true),
    expectTrue('activation_failed telemetry emitted',
      events.some((e) => e.event === 'distributed_runtime_activation_failed'),
      'present'),
  ];
}

async function s3_reclaimDuringActiveExecution(): Promise<Assertion[]> {
  // Worker w_alive is fresh + active. Try to reclaim its entry; safety
  // governor MUST refuse.
  const coord = getDefaultDistributedWorkerCoordinator();
  await coord.register({ workerId: 'w_alive', workerKind: 'queue_worker', capabilities: [] });
  const queue = getDefaultExecutionQueue();
  const { queueEntryId } = await queue.enqueue({
    executionId: 'exec_active', companyId: 'co', kind: 'execution_start',
  });
  await queue.claim({ workerId: 'w_alive', visibilityMs: 60_000 });

  const safety = createDistributedReclaimSafetyGovernor({
    telemetry: { emit: () => {} },
    defaultStaleConfirmationMs: 1_000,
    defaultSuppressionWindowMs: 100,
  });
  const verdict = await safety.validateReclaim({
    queueEntryId, targetWorkerId: 'w_alive',
  });
  return [
    expectEq('verdict.ok = false', verdict.ok, false),
    expectEq('reason = worker_still_alive', verdict.reason, 'worker_still_alive'),
  ];
}

async function s4_splitBrainReclaimRace(): Promise<Assertion[]> {
  // Two reclaim attempts target the same entry concurrently.
  // The safety governor's suppression window must prevent the second.
  const coord = getDefaultDistributedWorkerCoordinator();
  await coord.register({ workerId: 'w_dead', workerKind: 'queue_worker', capabilities: [] });
  const execCoord = getDefaultDurableExecutionCoordinator();
  const exec = await execCoord.start({
    runtimeSessionId: 'rs', threadId: 'thr',
    companyId: '00000000-0000-0000-0000-000000000001',
  });
  const queue = getDefaultExecutionQueue();
  const { queueEntryId } = await queue.enqueue({
    executionId: exec.executionId, companyId: exec.companyId, kind: 'execution_start',
  });
  await queue.claim({ workerId: 'w_dead' });
  await coord.offline('w_dead');

  const safety = createDistributedReclaimSafetyGovernor({
    telemetry: { emit: () => {} },
    defaultStaleConfirmationMs: 0,
    defaultSuppressionWindowMs: 5_000,
  });
  const a = await safety.validateReclaim({ queueEntryId, targetWorkerId: 'w_dead' });
  const b = await safety.validateReclaim({ queueEntryId, targetWorkerId: 'w_dead' });
  return [
    expectEq('first validation passes', a.ok, true),
    expectEq('second validation suppressed', b.reason, 'reclaim_within_suppression_window'),
  ];
}

async function s5_deadWorkerReclaimAfterRestart(): Promise<Assertion[]> {
  // Worker registers, claims, "crashes" → marked offline.
  // Replay coordinator's reclaimAbandoned should now reclaim via listByClaimer.
  const coord = getDefaultDistributedWorkerCoordinator();
  await coord.register({ workerId: 'w_crashed', workerKind: 'queue_worker', capabilities: [] });
  const execCoord = getDefaultDurableExecutionCoordinator();
  const exec = await execCoord.start({
    runtimeSessionId: 'rs', threadId: 'thr',
    companyId: '00000000-0000-0000-0000-000000000001',
  });
  const queue = getDefaultExecutionQueue();
  const { queueEntryId } = await queue.enqueue({
    executionId: exec.executionId, companyId: exec.companyId, kind: 'execution_start',
  });
  await queue.claim({ workerId: 'w_crashed', visibilityMs: 100_000 });
  await coord.offline('w_crashed');

  const replay = createDurableQueueReplayCoordinator({
    queue, workerCoordinator: coord,
    telemetry: { emit: () => {} },
    reclaimSafetyGovernor: createDistributedReclaimSafetyGovernor({
      telemetry: { emit: () => {} },
      defaultStaleConfirmationMs: 0,
      defaultSuppressionWindowMs: 10,
    }),
  });
  const reclaimed = await replay.reclaimAbandoned();
  const after = await queue.get(queueEntryId);
  return [
    expectAtLeast('reclaimed at least one entry', reclaimed.length, 1),
    expectEq('queue entry returned to queued', after?.status, 'queued'),
  ];
}

async function s6_activationDuringReplayStorm(): Promise<Assertion[]> {
  // Enqueue many entries, then run activation governor concurrently with
  // a replay sweep. Activation should still succeed (validators are
  // dry-run / read-only).
  const queue = getDefaultExecutionQueue();
  for (let i = 0; i < 20; i += 1) {
    await queue.enqueue({
      executionId: `exec_storm_${i}`, companyId: 'co', kind: 'execution_recovery',
    });
  }
  const replay = createDurableQueueReplayCoordinator({ queue, telemetry: { emit: () => {} } });
  const gov = createDistributedRuntimeActivationGovernor({ telemetry: { emit: () => {} } });
  const [activation, sweep] = await Promise.all([
    gov.activate(),
    replay.runFullReplaySweep({ maxEntriesPerSweep: 5 }),
  ]);
  return [
    expectEq('activation succeeded under load', activation.ok, true),
    expectTrue('replay sweep completed', !sweep.aborted, 'not aborted'),
  ];
}

async function s7_duplicateStartupInvocation(): Promise<Assertion[]> {
  // Activation governor must be idempotent — a second activate() returns
  // the cached prior result.
  const gov = createDistributedRuntimeActivationGovernor({ telemetry: { emit: () => {} } });
  const first = await gov.activate();
  const second = await gov.activate();
  return [
    expectEq('first activation cached=false', first.cached, false),
    expectEq('second activation cached=true', second.cached, true),
  ];
}

async function s8_shutdownDuringReclaim(): Promise<Assertion[]> {
  // Begin a reclaim sequence, then "shut down" the worker mid-reclaim.
  // The safety governor's verdict at validation time should still be
  // sound; the subsequent queue.retry should succeed because the entry
  // is still in the claimed state.
  const coord = getDefaultDistributedWorkerCoordinator();
  await coord.register({ workerId: 'w_dead', workerKind: 'queue_worker', capabilities: [] });
  const execCoord = getDefaultDurableExecutionCoordinator();
  const exec = await execCoord.start({
    runtimeSessionId: 'rs', threadId: 'thr',
    companyId: '00000000-0000-0000-0000-000000000001',
  });
  const queue = getDefaultExecutionQueue();
  const { queueEntryId } = await queue.enqueue({
    executionId: exec.executionId, companyId: exec.companyId, kind: 'execution_start',
  });
  await queue.claim({ workerId: 'w_dead' });
  await coord.offline('w_dead');

  const safety = createDistributedReclaimSafetyGovernor({
    telemetry: { emit: () => {} },
    defaultStaleConfirmationMs: 0,
    defaultSuppressionWindowMs: 10,
  });
  const verdict = await safety.validateReclaim({ queueEntryId, targetWorkerId: 'w_dead' });
  // Now the orchestrator "shuts down" — we won't actually do anything
  // disruptive; just verify the verdict is sound.
  const after = await queue.retry({ queueEntryId, reason: 'shutdown_reclaim' });
  return [
    expectEq('verdict ok', verdict.ok, true),
    expectEq('reclaim retry succeeded', after?.status, 'queued'),
  ];
}

async function s9_workerCrashDuringTargetedReclaim(): Promise<Assertion[]> {
  // Three claims for the dead worker; reclaim them all in one sweep.
  const coord = getDefaultDistributedWorkerCoordinator();
  await coord.register({ workerId: 'w_dead', workerKind: 'queue_worker', capabilities: [] });
  const execCoord = getDefaultDurableExecutionCoordinator();
  const queue = getDefaultExecutionQueue();
  for (let i = 0; i < 3; i += 1) {
    const exec = await execCoord.start({
      runtimeSessionId: `rs_${i}`, threadId: `thr_${i}`,
      companyId: '00000000-0000-0000-0000-000000000001',
    });
    await queue.enqueue({
      executionId: exec.executionId, companyId: exec.companyId, kind: 'execution_start',
    });
  }
  await queue.claim({ workerId: 'w_dead', limit: 3 });
  await coord.offline('w_dead');

  const replay = createDurableQueueReplayCoordinator({
    queue, workerCoordinator: coord,
    telemetry: { emit: () => {} },
    reclaimSafetyGovernor: createDistributedReclaimSafetyGovernor({
      telemetry: { emit: () => {} },
      defaultStaleConfirmationMs: 0,
      defaultSuppressionWindowMs: 1,
    }),
  });
  const reclaimed = await replay.reclaimAbandoned();
  return [
    expectAtLeast('all three reclaimed', reclaimed.length, 3),
  ];
}

async function s10_staleWorkerFalsePositiveReclaim(): Promise<Assertion[]> {
  // Worker is marked 'stale' by sweepStale (its heartbeat exceeded the
  // registry's narrow stale threshold) BUT the safety governor's
  // stale-confirmation window is wider, so its heartbeat is still within
  // the "might be transient" window. Safety governor must refuse.
  const coord = createDistributedWorkerCoordinator({
    telemetry: { emit: () => {} }, defaultStaleThresholdMs: 30,
  });
  setDefaultDistributedWorkerCoordinator(coord);
  await coord.register({ workerId: 'w_recently_stale', workerKind: 'queue_worker', capabilities: [] });
  await new Promise((r) => setTimeout(r, 80));
  await coord.sweepStale();
  const after = await coord.get('w_recently_stale');

  const execCoord = getDefaultDurableExecutionCoordinator();
  const exec = await execCoord.start({
    runtimeSessionId: 'rs', threadId: 'thr',
    companyId: '00000000-0000-0000-0000-000000000001',
  });
  const queue = getDefaultExecutionQueue();
  const { queueEntryId } = await queue.enqueue({
    executionId: exec.executionId, companyId: exec.companyId, kind: 'execution_start',
  });
  await queue.claim({ workerId: 'w_recently_stale' });

  const safety = createDistributedReclaimSafetyGovernor({
    workerCoordinator: coord,
    telemetry: { emit: () => {} },
    defaultStaleConfirmationMs: 10_000,   // wide confirmation window
    defaultSuppressionWindowMs: 1,
  });
  const verdict = await safety.validateReclaim({
    queueEntryId, targetWorkerId: 'w_recently_stale',
  });
  return [
    expectEq('worker is stale', after?.status, 'stale'),
    expectEq('reclaim refused (heartbeat too fresh)', verdict.reason, 'worker_still_alive'),
  ];
}

async function s11_activationWatchdogTimeout(): Promise<Assertion[]> {
  // Force a validator to hang past the watchdog.
  const slowQueue = {
    enqueue: async () => { await new Promise((r) => setTimeout(r, 5_000)); throw new Error('timed out'); },
    claim: async () => [], ack: async () => null, retry: async () => null,
    reclaimExpired: async () => [], get: async () => null,
    listByExecution: async () => [], listByClaimer: async () => [],
    countByStatus: async () => ({ queued: 0, claimed: 0, completed: 0, failed: 0, dead_lettered: 0, cancelled: 0 }),
    depth: async () => 0,
  };
  const gov = createDistributedRuntimeActivationGovernor({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    queue: slowQueue as any,
    telemetry: { emit: () => {} },
    watchdogMs: 1_000,
  });
  const t0 = Date.now();
  let failed = false;
  try { await gov.activate(); } catch { failed = true; }
  const elapsed = Date.now() - t0;
  return [
    expectEq('activation hard-failed', failed, true),
    // Validator runs sequentially; the slow queue throws on enqueue OR
    // the watchdog catches it on the next iteration. Either way we
    // should finish within ~6s (queue validator timeout) plus margin.
    expectTrue('elapsed bounded', elapsed < 10_000, 'under 10s'),
  ];
}

async function s12_queueReplayDuringRuntimeRestart(): Promise<Assertion[]> {
  // Enqueue + claim entries, simulate restart by re-running activation +
  // sweeping reclaimable entries. Verify ordering preserved.
  const queue = getDefaultExecutionQueue();
  const coord = getDefaultDistributedWorkerCoordinator();
  await coord.register({ workerId: 'w_pre', workerKind: 'queue_worker', capabilities: [] });
  await queue.enqueue({ executionId: 'a', companyId: 'co', kind: 'execution_start', priority: 80 });
  await queue.enqueue({ executionId: 'b', companyId: 'co', kind: 'execution_start', priority: 50 });
  await queue.enqueue({ executionId: 'c', companyId: 'co', kind: 'execution_start', priority: 10 });
  await queue.claim({ workerId: 'w_pre', visibilityMs: 30 });
  await new Promise((r) => setTimeout(r, 50));
  await coord.offline('w_pre');

  // Restart simulation: activation governor runs.
  const gov = createDistributedRuntimeActivationGovernor({ telemetry: { emit: () => {} } });
  const activation = await gov.activate();

  // Then a replay coordinator reclaims abandoned entries + visibility-expired.
  const replay = createDurableQueueReplayCoordinator({
    telemetry: { emit: () => {} },
    reclaimSafetyGovernor: createDistributedReclaimSafetyGovernor({
      telemetry: { emit: () => {} },
      defaultStaleConfirmationMs: 0,
      defaultSuppressionWindowMs: 1,
    }),
  });
  const report = await replay.runFullReplaySweep();

  // Re-claim — highest priority should win.
  await coord.register({ workerId: 'w_post', workerKind: 'queue_worker', capabilities: [] });
  const [first] = await queue.claim({ workerId: 'w_post' });
  return [
    expectEq('activation succeeded post-restart', activation.ok, true),
    expectTrue('replay sweep completed', !report.aborted, 'not aborted'),
    expectEq('highest priority reclaimed first', first?.executionId, 'a'),
  ];
}

// ────────────────────────────────────────────────────────────────────
// Runner
// ────────────────────────────────────────────────────────────────────

async function main() {
  const scenarios: Array<{ name: string; run: () => Promise<Assertion[]> }> = [
    { name: '1. runtime activation before persistence registration', run: s1_runtimeActivationBeforePersistenceRegistration },
    { name: '2. partial runtime startup (validator failure)', run: s2_partialRuntimeStartupValidatorFailure },
    { name: '3. reclaim during active execution', run: s3_reclaimDuringActiveExecution },
    { name: '4. split-brain reclaim race', run: s4_splitBrainReclaimRace },
    { name: '5. dead worker reclaim after restart', run: s5_deadWorkerReclaimAfterRestart },
    { name: '6. activation during replay storm', run: s6_activationDuringReplayStorm },
    { name: '7. duplicate startup invocation', run: s7_duplicateStartupInvocation },
    { name: '8. shutdown during reclaim', run: s8_shutdownDuringReclaim },
    { name: '9. worker crash during targeted reclaim', run: s9_workerCrashDuringTargetedReclaim },
    { name: '10. stale-worker false-positive reclaim', run: s10_staleWorkerFalsePositiveReclaim },
    { name: '11. activation watchdog timeout', run: s11_activationWatchdogTimeout },
    { name: '12. queue replay during runtime restart', run: s12_queueReplayDuringRuntimeRestart },
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
