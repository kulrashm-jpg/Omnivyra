/**
 * Phase 21I — Distributed durable-runtime stress harness.
 *
 * Twelve adversarial scenarios validating the Phase 21 distributed durable
 * substrate. Hermetic: uses the IN-MEMORY queue + worker coordinator with
 * Phase 21 helpers (replay coordinator, compactor, forensic analyzer,
 * diagnostics) layered on top. The Supabase implementations are exercised
 * in their respective jest suites with mock supabase-js clients.
 *
 * Scenarios:
 *   1.  multi-instance concurrent queue claim
 *   2.  visibility reclaim after process crash
 *   3.  delayed queue replay after deploy restart
 *   4.  stale worker reclaim across instances
 *   5.  duplicate enqueue across workers
 *   6.  dead-letter recovery replay
 *   7.  queue corruption recovery (bad payload tolerated)
 *   8.  distributed heartbeat partition
 *   9.  split-brain ownership attempt
 *  10.  queue replay during recovery storm
 *  11.  worker drain during replay continuation
 *  12.  cross-instance retry amplification
 *
 * Usage:
 *   npx tsx scripts/ops/longFormDurableDistributedRuntimeStress.ts
 */

import {
  createInMemoryExecutionQueue,
  setDefaultExecutionQueue,
} from '../../backend/services/orchestration/distributed/distributedExecutionQueue';
import {
  createDistributedWorkerCoordinator,
  setDefaultDistributedWorkerCoordinator,
} from '../../backend/services/orchestration/distributed/distributedWorkerCoordinator';
import {
  createDurableQueueReplayCoordinator,
} from '../../backend/services/orchestration/distributed/durableQueueReplayCoordinator';
import {
  createRuntimePersistenceCompactor,
} from '../../backend/services/orchestration/distributed/runtimePersistenceCompactor';
import {
  createDistributedRuntimeForensicAnalyzer,
} from '../../backend/services/orchestration/distributed/distributedRuntimeForensicAnalyzer';
import {
  recordEvent,
  _resetDurableDistributedRuntimeDiagnostics,
  getDurableDistributedRuntimeSnapshot,
} from '../../backend/services/orchestration/distributed/durableDistributedRuntimeDiagnostics';

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
function expectAtMost(label: string, actual: number, threshold: number): Assertion {
  return { label, actual, expected: `<= ${threshold}`, ok: actual <= threshold };
}

function resetWorld() {
  setDefaultExecutionQueue(createInMemoryExecutionQueue({ telemetry: { emit: () => {} } }));
  setDefaultDistributedWorkerCoordinator(createDistributedWorkerCoordinator({
    telemetry: { emit: () => {} }, defaultStaleThresholdMs: 200,
  }));
  _resetDurableDistributedRuntimeDiagnostics();
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

async function registerWorkers(ids: string[]): Promise<void> {
  const { getDefaultDistributedWorkerCoordinator } = await import(
    '../../backend/services/orchestration/distributed/distributedWorkerCoordinator'
  );
  const coord = getDefaultDistributedWorkerCoordinator();
  for (const id of ids) {
    await coord.register({ workerId: id, workerKind: 'queue_worker', capabilities: [{ name: 'all' }] });
  }
}

async function enqueue(executionId: string, opts?: { kind?: 'execution_start' | 'execution_recovery' | 'execution_continuation'; maxAttempts?: number }) {
  const { getDefaultExecutionQueue } = await import(
    '../../backend/services/orchestration/distributed/distributedExecutionQueue'
  );
  return getDefaultExecutionQueue().enqueue({
    executionId, companyId: '00000000-0000-0000-0000-000000000001',
    kind: opts?.kind ?? 'execution_start',
    maxAttempts: opts?.maxAttempts,
  });
}

// ────────────────────────────────────────────────────────────────────
// Scenarios
// ────────────────────────────────────────────────────────────────────

async function s1_multiInstanceConcurrentClaim(): Promise<Assertion[]> {
  // Simulate 3 worker instances racing on the same queue entry.
  await registerWorkers(['w_a', 'w_b', 'w_c']);
  await enqueue('exec_concurrent');
  const { getDefaultExecutionQueue } = await import(
    '../../backend/services/orchestration/distributed/distributedExecutionQueue'
  );
  const queue = getDefaultExecutionQueue();
  const results = await Promise.all([
    queue.claim({ workerId: 'w_a' }),
    queue.claim({ workerId: 'w_b' }),
    queue.claim({ workerId: 'w_c' }),
  ]);
  const totalClaimed = results.reduce((sum, r) => sum + r.length, 0);
  return [
    expectEq('exactly one claimed across 3 instances', totalClaimed, 1),
  ];
}

async function s2_visibilityReclaimAfterCrash(): Promise<Assertion[]> {
  await registerWorkers(['w_crashed', 'w_alive']);
  const { queueEntryId } = await enqueue('exec_crash');
  const { getDefaultExecutionQueue } = await import(
    '../../backend/services/orchestration/distributed/distributedExecutionQueue'
  );
  const queue = getDefaultExecutionQueue();
  await queue.claim({ workerId: 'w_crashed', visibilityMs: 30 });
  await new Promise((r) => setTimeout(r, 80));
  // Replay coordinator should reclaim the visibility-expired entry.
  const coord = createDurableQueueReplayCoordinator({ telemetry: { emit: () => {} } });
  const report = await coord.runFullReplaySweep();
  return [
    expectAtLeast('at least one entry reclaimed', report.reclaimedEntries.length, 1),
    expectEq('reclaim references original entry', report.reclaimedEntries[0]?.queueEntryId, queueEntryId),
  ];
}

async function s3_delayedReplayAfterDeployRestart(): Promise<Assertion[]> {
  await registerWorkers(['w_post_deploy']);
  // Enqueue some entries (delayed + immediate).
  await enqueue('exec_immediate');
  const { getDefaultExecutionQueue } = await import(
    '../../backend/services/orchestration/distributed/distributedExecutionQueue'
  );
  await getDefaultExecutionQueue().enqueue({
    executionId: 'exec_delayed', companyId: '00000000-0000-0000-0000-000000000001',
    kind: 'execution_start',
    runAtIso: new Date(Date.now() + 50).toISOString(),
  });
  // Simulate restart: workers freshly registered above. Wait so delayed becomes ready.
  await new Promise((r) => setTimeout(r, 100));
  const coord = createDurableQueueReplayCoordinator({ telemetry: { emit: () => {} } });
  const report = await coord.runFullReplaySweep();
  // After restart, queue.depth should expose both ready entries.
  const depth = await getDefaultExecutionQueue().depth();
  return [
    expectAtLeast('queue depth shows ready entries', depth, 2),
    expectTrue('replay sweep completed', !report.aborted, 'not aborted'),
  ];
}

async function s4_staleWorkerReclaimAcrossInstances(): Promise<Assertion[]> {
  const { getDefaultDistributedWorkerCoordinator } = await import(
    '../../backend/services/orchestration/distributed/distributedWorkerCoordinator'
  );
  const coord = getDefaultDistributedWorkerCoordinator();
  await coord.register({ workerId: 'w_dead', workerKind: 'queue_worker', capabilities: [] });
  await coord.register({ workerId: 'w_alive', workerKind: 'queue_worker', capabilities: [] });
  await new Promise((r) => setTimeout(r, 250));
  // Heartbeat w_alive to refresh it.
  await coord.heartbeat({ workerId: 'w_alive' });
  // Sweep — w_dead should be flagged stale; w_alive remains active.
  const result = await coord.sweepStale();
  const dead = await coord.get('w_dead');
  const alive = await coord.get('w_alive');
  return [
    expectTrue('w_dead marked stale', result.markedStale.includes('w_dead'), 'includes w_dead'),
    expectEq('w_dead status=stale', dead?.status, 'stale'),
    expectEq('w_alive status=active', alive?.status, 'active'),
  ];
}

async function s5_duplicateEnqueueAcrossWorkers(): Promise<Assertion[]> {
  await registerWorkers(['w_a', 'w_b']);
  const { getDefaultExecutionQueue } = await import(
    '../../backend/services/orchestration/distributed/distributedExecutionQueue'
  );
  const queue = getDefaultExecutionQueue();
  const a = await queue.enqueue({
    executionId: 'exec_X', companyId: 'co', kind: 'execution_start',
  });
  const b = await queue.enqueue({
    executionId: 'exec_X', companyId: 'co', kind: 'execution_start',
  });
  const all = await queue.listByExecution('exec_X');
  return [
    expectEq('dedup returns same entry', a.queueEntryId, b.queueEntryId),
    expectEq('exactly one live entry persists', all.length, 1),
  ];
}

async function s6_deadLetterRecoveryReplay(): Promise<Assertion[]> {
  await registerWorkers(['w_a']);
  const { getDefaultExecutionQueue } = await import(
    '../../backend/services/orchestration/distributed/distributedExecutionQueue'
  );
  const queue = getDefaultExecutionQueue();
  const { queueEntryId } = await queue.enqueue({
    executionId: 'exec_dl', companyId: 'co', kind: 'execution_start', maxAttempts: 2,
  });
  for (let i = 0; i < 5; i += 1) {
    const claims = await queue.claim({ workerId: 'w_a', nowMs: Date.now() + i * 1_000_000 });
    if (claims.length === 0) break;
    await queue.ack({
      queueEntryId, workerId: 'w_a', outcome: 'failed', retryAfterMs: 1,
    });
  }
  const final = await queue.get(queueEntryId);
  // Replay coordinator surfaces dead-letter count.
  const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
  const coord = createDurableQueueReplayCoordinator({
    telemetry: { emit(event, payload) { events.push({ event, payload }); } },
  });
  await coord.runFullReplaySweep();
  return [
    expectEq('entry dead-lettered', final?.status, 'dead_lettered'),
    expectTrue('replay sweep emitted dead-letter candidate event',
      events.some((e) => e.event === 'queue_replay_dead_letter_candidate'),
      'present'),
  ];
}

async function s7_queueCorruptionRecovery(): Promise<Assertion[]> {
  // Enqueue an entry with a malformed payload (extreme size); the queue
  // should tolerate it (in-memory accepts any payload). Then verify the
  // forensic analyzer doesn't crash.
  await registerWorkers(['w_a']);
  const { getDefaultExecutionQueue } = await import(
    '../../backend/services/orchestration/distributed/distributedExecutionQueue'
  );
  const queue = getDefaultExecutionQueue();
  const huge: Record<string, unknown> = {};
  for (let i = 0; i < 100; i += 1) huge[`k${i}`] = 'x'.repeat(100);
  await queue.enqueue({
    executionId: 'exec_corrupt', companyId: 'co', kind: 'execution_start',
    payload: huge,
  });
  const analyzer = createDistributedRuntimeForensicAnalyzer();
  const report = await analyzer.analyze({ executionId: 'exec_corrupt' });
  return [
    expectTrue('analyzer produced report', !!report.oneLine, 'truthy'),
    expectAtLeast('analyzer chain non-empty', report.ownershipContinuityAssessment.chainEntries, 1),
  ];
}

async function s8_distributedHeartbeatPartition(): Promise<Assertion[]> {
  const { getDefaultDistributedWorkerCoordinator } = await import(
    '../../backend/services/orchestration/distributed/distributedWorkerCoordinator'
  );
  const coord = getDefaultDistributedWorkerCoordinator();
  // Register 3 workers; partition 1 (no heartbeat) while 2 keep alive.
  await coord.register({ workerId: 'w_alive_1', workerKind: 'queue_worker', capabilities: [] });
  await coord.register({ workerId: 'w_alive_2', workerKind: 'queue_worker', capabilities: [] });
  await coord.register({ workerId: 'w_partitioned', workerKind: 'queue_worker', capabilities: [] });
  await new Promise((r) => setTimeout(r, 250));
  await coord.heartbeat({ workerId: 'w_alive_1' });
  await coord.heartbeat({ workerId: 'w_alive_2' });
  const result = await coord.sweepStale();
  return [
    expectEq('only partitioned worker marked stale', result.markedStale, ['w_partitioned']),
    expectEq('alive workers remain active', (await coord.get('w_alive_1'))?.status, 'active'),
  ];
}

async function s9_splitBrainOwnershipAttempt(): Promise<Assertion[]> {
  // Two enqueues from different "instances" with the same dedup key —
  // exactly one queue entry should exist; subsequent claim is uncontested.
  await registerWorkers(['w_a', 'w_b']);
  const { getDefaultExecutionQueue } = await import(
    '../../backend/services/orchestration/distributed/distributedExecutionQueue'
  );
  const queue = getDefaultExecutionQueue();
  await Promise.all([
    queue.enqueue({ executionId: 'exec_split', companyId: 'co', kind: 'execution_start' }),
    queue.enqueue({ executionId: 'exec_split', companyId: 'co', kind: 'execution_start' }),
  ]);
  const all = await queue.listByExecution('exec_split');
  return [
    expectEq('exactly one live entry', all.length, 1),
  ];
}

async function s10_queueReplayDuringRecoveryStorm(): Promise<Assertion[]> {
  await registerWorkers(['w_a']);
  // Enqueue many recovery entries; verify replay sweep is bounded.
  const { getDefaultExecutionQueue } = await import(
    '../../backend/services/orchestration/distributed/distributedExecutionQueue'
  );
  const queue = getDefaultExecutionQueue();
  for (let i = 0; i < 30; i += 1) {
    await queue.enqueue({
      executionId: `exec_storm_${i}`, companyId: 'co', kind: 'execution_recovery',
    });
  }
  const coord = createDurableQueueReplayCoordinator({ telemetry: { emit: () => {} } });
  const report = await coord.runFullReplaySweep({ maxEntriesPerSweep: 10 });
  return [
    expectAtMost('reclaim count bounded by maxEntriesPerSweep', report.reclaimedEntries.length, 10),
    expectTrue('replay sweep completed', !report.aborted, 'not aborted'),
  ];
}

async function s11_workerDrainDuringReplayContinuation(): Promise<Assertion[]> {
  const { getDefaultDistributedWorkerCoordinator } = await import(
    '../../backend/services/orchestration/distributed/distributedWorkerCoordinator'
  );
  const coord = getDefaultDistributedWorkerCoordinator();
  await coord.register({ workerId: 'w_draining', workerKind: 'queue_worker', capabilities: [] });
  await registerWorkers(['w_taker']);

  await enqueue('exec_drain');
  const { getDefaultExecutionQueue } = await import(
    '../../backend/services/orchestration/distributed/distributedExecutionQueue'
  );
  const queue = getDefaultExecutionQueue();

  // w_draining claims, then is drained mid-execution.
  await queue.claim({ workerId: 'w_draining', visibilityMs: 30 });
  await coord.drain('w_draining');
  await new Promise((r) => setTimeout(r, 80));
  const drained = await coord.get('w_draining');
  // Replay sweep reclaims the visibility-expired entry.
  const replayCoord = createDurableQueueReplayCoordinator({ telemetry: { emit: () => {} } });
  const report = await replayCoord.runFullReplaySweep();
  // w_taker can now claim.
  const claims = await queue.claim({ workerId: 'w_taker' });
  return [
    expectEq('drained worker remains draining', drained?.status, 'draining'),
    expectAtLeast('replay reclaimed visibility-expired entry', report.reclaimedEntries.length, 1),
    expectAtLeast('taker claimed the reclaimed entry', claims.length, 1),
  ];
}

async function s12_crossInstanceRetryAmplification(): Promise<Assertion[]> {
  // Diagnostics aggregator should NOT amplify a single dead-letter event
  // into multiple recordings. Verify by emitting one dead-letter event
  // and checking the counter increments exactly once.
  recordEvent('execution_dead_lettered', {
    queueEntryId: 'qe_1', executionId: 'exec_1', attempts: 5,
  });
  const snapshot = getDurableDistributedRuntimeSnapshot();
  // Also verify a compaction summary increments only the relevant bucket.
  recordEvent('compaction_archive_summary', {
    target: 'queue', deleted: 7, cutoffIso: new Date().toISOString(),
  });
  recordEvent('compaction_archive_summary', {
    target: 'workers', deleted: 3, cutoffIso: new Date().toISOString(),
  });
  const after = getDurableDistributedRuntimeSnapshot();
  return [
    expectEq('dead-letter count is 1 (not amplified)', snapshot.deadLetterEvents, 1),
    expectEq('queue archived total = 7', after.queueArchivedTotal, 7),
    expectEq('worker archived total = 3', after.workerArchivedTotal, 3),
  ];
}

// ────────────────────────────────────────────────────────────────────
// Runner
// ────────────────────────────────────────────────────────────────────

async function main() {
  const scenarios: Array<{ name: string; run: () => Promise<Assertion[]> }> = [
    { name: '1. multi-instance concurrent queue claim', run: s1_multiInstanceConcurrentClaim },
    { name: '2. visibility reclaim after process crash', run: s2_visibilityReclaimAfterCrash },
    { name: '3. delayed queue replay after deploy restart', run: s3_delayedReplayAfterDeployRestart },
    { name: '4. stale worker reclaim across instances', run: s4_staleWorkerReclaimAcrossInstances },
    { name: '5. duplicate enqueue across workers', run: s5_duplicateEnqueueAcrossWorkers },
    { name: '6. dead-letter recovery replay', run: s6_deadLetterRecoveryReplay },
    { name: '7. queue corruption recovery', run: s7_queueCorruptionRecovery },
    { name: '8. distributed heartbeat partition', run: s8_distributedHeartbeatPartition },
    { name: '9. split-brain ownership attempt', run: s9_splitBrainOwnershipAttempt },
    { name: '10. queue replay during recovery storm', run: s10_queueReplayDuringRecoveryStorm },
    { name: '11. worker drain during replay continuation', run: s11_workerDrainDuringReplayContinuation },
    { name: '12. cross-instance retry amplification', run: s12_crossInstanceRetryAmplification },
  ];

  // Bonus: exercise the compactor in isolation as a sanity check.
  resetWorld();
  const compactor = createRuntimePersistenceCompactor({ telemetry: { emit: () => {} } });
  await compactor.runCompactionPass({ dryRun: true });

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
