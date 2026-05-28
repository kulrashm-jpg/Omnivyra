/**
 * Phase 9 — Thread runtime stress tests.
 *
 * Exercises every module of the thread runtime observability stack against
 * synthetic adversarial scenarios. Mirrors the architectural pattern of the
 * 12 prior longForm/crossModal stress harnesses.
 *
 * Run via:
 *   npx tsx scripts/ops/longFormThreadRuntimeStress.ts
 */

import type {
  ThreadNodeShape,
  ThreadRuntimeTransitionType,
  ThreadSnapshotPhase,
} from './threadRuntimeTypes';
import { createThreadRuntimeTraceRegistry } from './threadRuntimeTraceRegistry';
import { createThreadTopologySnapshotEngine } from './threadTopologySnapshotEngine';
import { buildShadowSoakReport } from './shadowSoakValidationReporter';
import { summarizeRuntimeFailures } from './runtimeFailureSummarizer';
import { computeThreadRuntimeDiagnostics } from './threadRuntimeDiagnostics';
import { selfValidateShadowRun } from './shadowRunSelfValidator';
import { extractRecoveryTraces } from './runtimeRecoveryTraceability';
import { composeRuntimeOperatorSummary } from './runtimeOperatorSummaryComposer';
import { createThreadRuntimeObservabilityRegistry } from './threadRuntimeObservability';

// ── helpers ────────────────────────────────────────────────────────────

let _idc = 0;
function nodeId(prefix = 'n'): string { _idc += 1; return `${prefix}_${_idc.toString(36)}`; }
function isoSecAgo(secs: number): string { return new Date(Date.now() - secs * 1000).toISOString(); }

function makeNode(
  id: string, position: number, parentId: string | null,
  mode: 'manual' | 'ai' = 'manual', status: 'scheduled' | 'draft' = 'draft', hasContent = true,
): ThreadNodeShape {
  return { nodeId: id, position, parentNodeId: parentId, status, hasContent, generationMode: mode };
}

function setupBaseline(opts?: { threadId?: string; nodeCount?: number; mode?: 'manual' | 'ai' }) {
  const threadId = opts?.threadId ?? 'thr_baseline';
  const companyId = 'co_test';
  const nodeCount = opts?.nodeCount ?? 3;
  const mode = opts?.mode ?? 'manual';
  _idc = 0;
  const reg = createThreadRuntimeTraceRegistry();
  const snapEngine = createThreadTopologySnapshotEngine();

  const sessionId = `rs_${threadId}`;
  reg.startSession({ runtimeSessionId: sessionId, threadId, companyId, timestamp: isoSecAgo(30) });

  // pre-generation snapshot (empty)
  snapEngine.capture({ threadId, companyId, phase: 'pre_generation', nodes: [], rootNodeId: null, takenAt: isoSecAgo(29) });

  // generate nodes
  const nodes: ThreadNodeShape[] = [];
  const rootId = nodeId();
  nodes.push(makeNode(rootId, 0, null, mode, 'scheduled'));
  reg.recordEvent({
    runtimeSessionId: sessionId, threadId, companyId,
    transitionType: 'node_create', nodeGenerationMode: mode,
    parentNodeId: null, childNodeIds: [rootId], latencyMs: 50, timestamp: isoSecAgo(25),
  });
  for (let i = 1; i < nodeCount; i += 1) {
    const cid = nodeId();
    nodes.push(makeNode(cid, i, rootId, mode));
    reg.recordEvent({
      runtimeSessionId: sessionId, threadId, companyId,
      transitionType: 'node_create', nodeGenerationMode: mode,
      parentNodeId: rootId, childNodeIds: [cid], latencyMs: 60 + i * 5, timestamp: isoSecAgo(20 - i),
    });
  }

  // persist attempt + success
  reg.recordEvent({ runtimeSessionId: sessionId, threadId, companyId, transitionType: 'persist_attempt', timestamp: isoSecAgo(10) });
  reg.recordEvent({ runtimeSessionId: sessionId, threadId, companyId, transitionType: 'persist_success', latencyMs: 1200, timestamp: isoSecAgo(8) });

  // post-generation snapshot
  snapEngine.capture({ threadId, companyId, phase: 'post_generation', nodes, rootNodeId: rootId, takenAt: isoSecAgo(7) });

  reg.endSession(sessionId, isoSecAgo(1));
  return { threadId, companyId, sessionId, rootId, nodes, reg, snapEngine };
}

// ── assertion infra ────────────────────────────────────────────────────

export interface RuntimeAssertion { name: string; passed: boolean; observed: string | number; expected: string }
export interface RuntimeScenarioResult { scenario: string; assertions: RuntimeAssertion[]; passed: boolean }
function ok(name: string, observed: string | number, passed: boolean, expected: string): RuntimeAssertion {
  return { name, observed, passed, expected };
}

// ── scenarios ──────────────────────────────────────────────────────────

async function scenario_baseline(): Promise<RuntimeScenarioResult> {
  const ctx = setupBaseline({ nodeCount: 3 });
  const trace = ctx.reg.getTrace(ctx.sessionId) ?? null;
  const snaps = ctx.snapEngine.list(ctx.threadId);
  const soak = buildShadowSoakReport({ flow: 'manual_3', threadId: ctx.threadId, trace, snapshots: snaps });
  const failures = summarizeRuntimeFailures({ trace, snapshots: snaps });
  const validation = selfValidateShadowRun({ threadId: ctx.threadId, expectedNodeCount: 3, trace, snapshots: snaps });
  return {
    scenario: 'baseline. healthy 3-node manual run',
    passed: true,
    assertions: [
      ok('topology integrity ≥ 80', snaps[snaps.length - 1].topologyIntegrityScore,
        snaps[snaps.length - 1].topologyIntegrityScore >= 80, '≥ 80'),
      ok('soak overall ≥ 85', soak.overallSoakHealthScore, soak.overallSoakHealthScore >= 85, '≥ 85'),
      ok('no failures', failures.length, failures.length === 0, '0'),
      ok('validation passed', validation.validationPassed ? 'true' : 'false', validation.validationPassed, 'true'),
    ],
  };
}

async function scenario1_rapidNodeCreation(): Promise<RuntimeScenarioResult> {
  // 20 nodes created in ~2 seconds, then persist succeeds.
  const threadId = 'thr_rapid';
  const companyId = 'co_test';
  _idc = 0;
  const reg = createThreadRuntimeTraceRegistry();
  const snapEngine = createThreadTopologySnapshotEngine();
  const sessionId = 'rs_rapid';
  reg.startSession({ runtimeSessionId: sessionId, threadId, companyId, timestamp: isoSecAgo(10) });
  const nodes: ThreadNodeShape[] = [];
  const rootId = nodeId();
  nodes.push(makeNode(rootId, 0, null));
  reg.recordEvent({ runtimeSessionId: sessionId, threadId, companyId, transitionType: 'node_create', childNodeIds: [rootId], latencyMs: 20, timestamp: isoSecAgo(9) });
  for (let i = 1; i < 20; i += 1) {
    const cid = nodeId();
    nodes.push(makeNode(cid, i, rootId));
    reg.recordEvent({ runtimeSessionId: sessionId, threadId, companyId, transitionType: 'node_create', parentNodeId: rootId, childNodeIds: [cid], latencyMs: 18, timestamp: isoSecAgo(9 - i * 0.05) });
  }
  reg.recordEvent({ runtimeSessionId: sessionId, threadId, companyId, transitionType: 'persist_attempt' });
  reg.recordEvent({ runtimeSessionId: sessionId, threadId, companyId, transitionType: 'persist_success', latencyMs: 900 });
  snapEngine.capture({ threadId, companyId, phase: 'post_generation', nodes, rootNodeId: rootId });
  const diag = computeThreadRuntimeDiagnostics({ traces: [reg.getTrace(sessionId)!] });
  return {
    scenario: '1. rapid node creation',
    passed: true,
    assertions: [
      ok('mutation freq > 0', diag.topologyMutationFrequencyPerMin, diag.topologyMutationFrequencyPerMin > 0, '> 0'),
      ok('runtime health ≥ 80', diag.runtimeHealthScore, diag.runtimeHealthScore >= 80, '≥ 80'),
      ok('persist latency reported', diag.persistenceLatencyMsAvg, diag.persistenceLatencyMsAvg > 0, '> 0'),
    ],
  };
}

async function scenario2_rapidReorderBursts(): Promise<RuntimeScenarioResult> {
  const ctx = setupBaseline({ nodeCount: 5 });
  // reorder events
  for (let i = 0; i < 6; i += 1) {
    ctx.reg.recordEvent({ runtimeSessionId: ctx.sessionId, threadId: ctx.threadId, companyId: ctx.companyId, transitionType: 'node_reorder', latencyMs: 40, timestamp: isoSecAgo(5 - i * 0.1) });
  }
  ctx.snapEngine.capture({ threadId: ctx.threadId, companyId: ctx.companyId, phase: 'post_reorder', nodes: ctx.nodes, rootNodeId: ctx.rootId });
  const trace = ctx.reg.getTrace(ctx.sessionId)!;
  const diag = computeThreadRuntimeDiagnostics({ traces: [trace] });
  return {
    scenario: '2. rapid reorder bursts',
    passed: true,
    assertions: [
      ok('reorder events captured', trace.events.filter((e) => e.transitionType === 'node_reorder').length,
        trace.events.filter((e) => e.transitionType === 'node_reorder').length === 6, '6'),
      ok('reorder latency reported', diag.reorderLatencyMsAvg, diag.reorderLatencyMsAvg > 0, '> 0'),
    ],
  };
}

async function scenario3_mixedAiManualJoins(): Promise<RuntimeScenarioResult> {
  const threadId = 'thr_mixed';
  const companyId = 'co_test';
  _idc = 0;
  const reg = createThreadRuntimeTraceRegistry();
  const snapEngine = createThreadTopologySnapshotEngine();
  const sessionId = 'rs_mixed';
  reg.startSession({ runtimeSessionId: sessionId, threadId, companyId });
  const rootId = nodeId();
  reg.recordEvent({ runtimeSessionId: sessionId, threadId, companyId, transitionType: 'node_create', nodeGenerationMode: 'ai', childNodeIds: [rootId] });
  const n1 = nodeId();
  reg.recordEvent({ runtimeSessionId: sessionId, threadId, companyId, transitionType: 'node_create', nodeGenerationMode: 'manual', parentNodeId: rootId, childNodeIds: [n1] });
  const n2 = nodeId();
  reg.recordEvent({ runtimeSessionId: sessionId, threadId, companyId, transitionType: 'node_create', nodeGenerationMode: 'ai', parentNodeId: rootId, childNodeIds: [n2] });
  // Force non-monotonic ordering (duplicates) to trigger ai_manual_divergence
  const nodes = [
    makeNode(rootId, 0, null, 'ai'),
    makeNode(n1, 1, rootId, 'manual'),
    makeNode(n2, 1, rootId, 'ai'), // duplicate position 1
  ];
  snapEngine.capture({ threadId, companyId, phase: 'post_edit', nodes, rootNodeId: rootId });
  const trace = reg.getTrace(sessionId)!;
  const snaps = snapEngine.list(threadId);
  const failures = summarizeRuntimeFailures({ trace, snapshots: snaps });
  return {
    scenario: '3. mixed AI/manual joins with ordering anomaly',
    passed: true,
    assertions: [
      ok('ai_manual_divergence flagged', failures.map((f) => f.failureType).join(','),
        failures.some((f) => f.failureType === 'ai_manual_divergence'), 'ai_manual_divergence'),
      ok('ordering_failure flagged', failures.map((f) => f.failureType).join(','),
        failures.some((f) => f.failureType === 'ordering_failure'), 'ordering_failure'),
    ],
  };
}

async function scenario4_refreshDuringGeneration(): Promise<RuntimeScenarioResult> {
  const ctx = setupBaseline({ nodeCount: 4 });
  ctx.reg.recordEvent({ runtimeSessionId: ctx.sessionId, threadId: ctx.threadId, companyId: ctx.companyId, transitionType: 'refresh_observed', timestamp: isoSecAgo(3) });
  // post-refresh snapshot identical to pre — successful persistence
  ctx.snapEngine.capture({ threadId: ctx.threadId, companyId: ctx.companyId, phase: 'post_recovery', nodes: ctx.nodes, rootNodeId: ctx.rootId, takenAt: isoSecAgo(1) });
  const trace = ctx.reg.getTrace(ctx.sessionId)!;
  const snaps = ctx.snapEngine.list(ctx.threadId);
  const soak = buildShadowSoakReport({ flow: 'refresh', threadId: ctx.threadId, trace, snapshots: snaps });
  const validation = selfValidateShadowRun({ threadId: ctx.threadId, expectedNodeCount: 4, trace, snapshots: snaps });
  return {
    scenario: '4. refresh during generation',
    passed: true,
    assertions: [
      ok('refresh detected', soak.warnings.some((w) => /refresh/i.test(w)) ? 'has warning' : 'no warning',
        !soak.warnings.some((w) => /no refresh_observed/i.test(w)), 'no missing-refresh warning'),
      ok('refresh persistence ok', validation.refreshPersistenceOk ? 'true' : 'false', validation.refreshPersistenceOk, 'true'),
    ],
  };
}

async function scenario5_partialPersistenceFailure(): Promise<RuntimeScenarioResult> {
  const ctx = setupBaseline({ nodeCount: 3 });
  ctx.reg.recordEvent({ runtimeSessionId: ctx.sessionId, threadId: ctx.threadId, companyId: ctx.companyId, transitionType: 'persist_attempt', timestamp: isoSecAgo(4) });
  ctx.reg.recordEvent({
    runtimeSessionId: ctx.sessionId, threadId: ctx.threadId, companyId: ctx.companyId,
    transitionType: 'persist_failure', detail: 'column "thread_title" of relation "scheduled_posts" does not exist',
    timestamp: isoSecAgo(3),
  });
  const trace = ctx.reg.getTrace(ctx.sessionId)!;
  const snaps = ctx.snapEngine.list(ctx.threadId);
  const failures = summarizeRuntimeFailures({ trace, snapshots: snaps });
  const validation = selfValidateShadowRun({ threadId: ctx.threadId, expectedNodeCount: 3, trace, snapshots: snaps });
  return {
    scenario: '5. partial persistence failure',
    passed: true,
    assertions: [
      ok('runtime_crash detected', failures.map((f) => f.failureType).join(','),
        failures.some((f) => f.failureType === 'runtime_crash'), 'runtime_crash'),
      ok('partial persistence flag', validation.partialPersistenceFlags.length,
        validation.partialPersistenceFlags.length >= 1, '≥ 1'),
      ok('rootCause mentions thread_title', failures.map((f) => f.probableRootCause).join('|'),
        failures.some((f) => /thread_title/i.test(f.probableRootCause)), 'mentions thread_title'),
    ],
  };
}

async function scenario6_orphanBranchCreation(): Promise<RuntimeScenarioResult> {
  const threadId = 'thr_orphan';
  const companyId = 'co_test';
  _idc = 0;
  const snapEngine = createThreadTopologySnapshotEngine();
  const reg = createThreadRuntimeTraceRegistry();
  reg.startSession({ runtimeSessionId: 'rs_orph', threadId, companyId });
  const rootId = nodeId();
  const c1 = nodeId();
  const orphanId = nodeId();
  const nodes: ThreadNodeShape[] = [
    makeNode(rootId, 0, null),
    makeNode(c1, 1, rootId),
    makeNode(orphanId, 2, 'unknown_parent_id'), // orphan
  ];
  snapEngine.capture({ threadId, companyId, phase: 'post_generation', nodes, rootNodeId: rootId });
  const trace = reg.getTrace('rs_orph')!;
  const snaps = snapEngine.list(threadId);
  const failures = summarizeRuntimeFailures({ trace, snapshots: snaps });
  return {
    scenario: '6. orphan branch creation',
    passed: true,
    assertions: [
      ok('orphan_generation detected', failures.map((f) => f.failureType).join(','),
        failures.some((f) => f.failureType === 'orphan_generation'), 'orphan_generation'),
      ok('snapshot reports orphan ids', snaps[0].orphanNodeIds.length,
        snaps[0].orphanNodeIds.length === 1, '1'),
      ok('joinIntegrity = gaps', snaps[0].joinIntegrity, snaps[0].joinIntegrity === 'gaps', 'gaps'),
    ],
  };
}

async function scenario7_deepNodeNesting(): Promise<RuntimeScenarioResult> {
  // Build a chain root → a → b → c → d (long parent-child chain, single branch)
  const threadId = 'thr_deep';
  const companyId = 'co_test';
  _idc = 0;
  const snapEngine = createThreadTopologySnapshotEngine();
  const reg = createThreadRuntimeTraceRegistry();
  reg.startSession({ runtimeSessionId: 'rs_deep', threadId, companyId });
  const ids = [nodeId(), nodeId(), nodeId(), nodeId(), nodeId()];
  const nodes: ThreadNodeShape[] = ids.map((id, i) => makeNode(id, i, i === 0 ? null : ids[i - 1]));
  snapEngine.capture({ threadId, companyId, phase: 'post_generation', nodes, rootNodeId: ids[0] });
  const snap = snapEngine.list(threadId)[0];
  return {
    scenario: '7. deep node nesting',
    passed: true,
    assertions: [
      ok('all 5 nodes present', snap.nodes.length, snap.nodes.length === 5, '5'),
      ok('joinIntegrity = intact', snap.joinIntegrity, snap.joinIntegrity === 'intact', 'intact'),
      ok('orderingIntegrity = monotonic', snap.orderingIntegrity, snap.orderingIntegrity === 'monotonic', 'monotonic'),
    ],
  };
}

async function scenario8_reloadAfterRecovery(): Promise<RuntimeScenarioResult> {
  const ctx = setupBaseline({ nodeCount: 5 });
  // simulate recovery success
  ctx.reg.recordEvent({ runtimeSessionId: ctx.sessionId, threadId: ctx.threadId, companyId: ctx.companyId, transitionType: 'recovery_attempt', detail: 'attempting to repair join', timestamp: isoSecAgo(6) });
  ctx.reg.recordEvent({ runtimeSessionId: ctx.sessionId, threadId: ctx.threadId, companyId: ctx.companyId, transitionType: 'recovery_success', detail: 'parent_post_id realigned', timestamp: isoSecAgo(5) });
  ctx.snapEngine.capture({ threadId: ctx.threadId, companyId: ctx.companyId, phase: 'post_recovery', nodes: ctx.nodes, rootNodeId: ctx.rootId, takenAt: isoSecAgo(2) });
  const trace = ctx.reg.getTrace(ctx.sessionId)!;
  const recoveries = extractRecoveryTraces({ trace });
  return {
    scenario: '8. reload after recovery',
    passed: true,
    assertions: [
      ok('recovery trace extracted', recoveries.length, recoveries.length === 1, '1'),
      ok('recovery stable', recoveries[0].recoveryStable ? 'true' : 'false', recoveries[0].recoveryStable, 'true'),
      ok('recovery confidence ≥ 60', recoveries[0].recoveryConfidenceScore,
        recoveries[0].recoveryConfidenceScore >= 60, '≥ 60'),
    ],
  };
}

async function scenario9_duplicateNodeRace(): Promise<RuntimeScenarioResult> {
  // Two nodes claim the same position 1
  const threadId = 'thr_dup';
  const companyId = 'co_test';
  _idc = 0;
  const snapEngine = createThreadTopologySnapshotEngine();
  const reg = createThreadRuntimeTraceRegistry();
  reg.startSession({ runtimeSessionId: 'rs_dup', threadId, companyId });
  const rootId = nodeId();
  const a = nodeId();
  const b = nodeId();
  const nodes = [
    makeNode(rootId, 0, null),
    makeNode(a, 1, rootId),
    makeNode(b, 1, rootId), // duplicate
  ];
  snapEngine.capture({ threadId, companyId, phase: 'post_edit', nodes, rootNodeId: rootId });
  const snap = snapEngine.list(threadId)[0];
  const trace = reg.getTrace('rs_dup')!;
  const failures = summarizeRuntimeFailures({ trace, snapshots: [snap] });
  return {
    scenario: '9. duplicate node race (same position)',
    passed: true,
    assertions: [
      ok('orderingIntegrity = duplicates', snap.orderingIntegrity, snap.orderingIntegrity === 'duplicates', 'duplicates'),
      ok('ordering_failure raised', failures.map((f) => f.failureType).join(','),
        failures.some((f) => f.failureType === 'ordering_failure'), 'ordering_failure'),
    ],
  };
}

async function scenario10_runtimeReplayMismatch(): Promise<RuntimeScenarioResult> {
  // Snapshot contains a node id that NEVER appears in any event payload → silent corruption
  const threadId = 'thr_replay';
  const companyId = 'co_test';
  _idc = 0;
  const snapEngine = createThreadTopologySnapshotEngine();
  const reg = createThreadRuntimeTraceRegistry();
  reg.startSession({ runtimeSessionId: 'rs_replay', threadId, companyId });
  const rootId = nodeId();
  const c1 = nodeId();
  reg.recordEvent({ runtimeSessionId: 'rs_replay', threadId, companyId, transitionType: 'node_create', childNodeIds: [rootId] });
  reg.recordEvent({ runtimeSessionId: 'rs_replay', threadId, companyId, transitionType: 'node_create', parentNodeId: rootId, childNodeIds: [c1] });
  // Snapshot contains a ghost node not in any event
  const ghostId = 'ghost_xyz';
  const nodes = [
    makeNode(rootId, 0, null),
    makeNode(c1, 1, rootId),
    makeNode(ghostId, 2, rootId),
  ];
  snapEngine.capture({ threadId, companyId, phase: 'post_generation', nodes, rootNodeId: rootId });
  const trace = reg.getTrace('rs_replay')!;
  const snaps = snapEngine.list(threadId);
  const validation = selfValidateShadowRun({ threadId, expectedNodeCount: 3, trace, snapshots: snaps });
  return {
    scenario: '10. runtime replay mismatch',
    passed: true,
    assertions: [
      ok('replay consistency false', validation.replayConsistencyOk ? 'true' : 'false', !validation.replayConsistencyOk, 'false'),
      ok('silent corruption flag for ghost', validation.silentCorruptionFlags.join('|'),
        validation.silentCorruptionFlags.some((f) => f.includes('ghost_xyz')), 'mentions ghost_xyz'),
      ok('validation overall failed', validation.validationPassed ? 'true' : 'false',
        !validation.validationPassed, 'false'),
    ],
  };
}

async function scenario_endToEnd(): Promise<RuntimeScenarioResult> {
  // End-to-end: composer + observability registry produces a clean summary.
  const ctx = setupBaseline({ nodeCount: 3 });
  const trace = ctx.reg.getTrace(ctx.sessionId);
  const snaps = ctx.snapEngine.list(ctx.threadId);
  const soak = buildShadowSoakReport({ flow: 'manual_3', threadId: ctx.threadId, trace: trace!, snapshots: snaps });
  const failures = summarizeRuntimeFailures({ trace: trace!, snapshots: snaps });
  const validation = selfValidateShadowRun({ threadId: ctx.threadId, expectedNodeCount: 3, trace: trace!, snapshots: snaps });
  const recoveries = extractRecoveryTraces({ trace: trace! });
  const diagnostics = computeThreadRuntimeDiagnostics({ traces: [trace!] });
  const operator = composeRuntimeOperatorSummary({
    threadId: ctx.threadId, latestSnapshot: snaps[snaps.length - 1], soakReport: soak,
    validationResult: validation, failureSummaries: failures, recoveryTraces: recoveries,
  });
  const observability = createThreadRuntimeObservabilityRegistry();
  for (let i = 0; i < 6; i += 1) {
    observability.record({
      timestamp: isoSecAgo(6 - i), companyId: ctx.companyId, threadId: ctx.threadId,
      latestSnapshot: snaps[snaps.length - 1], diagnostics, soakReport: soak, failures,
    });
  }
  const built = observability.build(ctx.companyId);
  return {
    scenario: '11. end-to-end operator summary + observability',
    passed: true,
    assertions: [
      ok('topology verified', operator.topologyVerified ? 'true' : 'false', operator.topologyVerified, 'true'),
      ok('orphan risk = 0', operator.orphanRiskScore, operator.orphanRiskScore === 0, '0'),
      ok('one-line contains thread id', operator.oneLine, operator.oneLine.includes(ctx.threadId), `contains ${ctx.threadId}`),
      ok('observability sample size = 6', built.sampleSize, built.sampleSize === 6, '6'),
      ok('topology health trend reported', built.topologyHealthTrend !== 'unknown' ? 'set' : 'unknown',
        built.topologyHealthTrend !== 'unknown', 'reported'),
    ],
  };
}

// ── suite ──────────────────────────────────────────────────────────────

export interface RuntimeStressSuiteReport {
  scenarios: RuntimeScenarioResult[];
  overall: { total: number; passed: number; failed: number };
}

function finalize(r: RuntimeScenarioResult): RuntimeScenarioResult {
  r.passed = r.assertions.every((a) => a.passed);
  return r;
}

export async function runThreadRuntimeStressTests(): Promise<RuntimeStressSuiteReport> {
  const results = await Promise.all([
    scenario_baseline(),
    scenario1_rapidNodeCreation(),
    scenario2_rapidReorderBursts(),
    scenario3_mixedAiManualJoins(),
    scenario4_refreshDuringGeneration(),
    scenario5_partialPersistenceFailure(),
    scenario6_orphanBranchCreation(),
    scenario7_deepNodeNesting(),
    scenario8_reloadAfterRecovery(),
    scenario9_duplicateNodeRace(),
    scenario10_runtimeReplayMismatch(),
    scenario_endToEnd(),
  ]);
  const scenarios = results.map(finalize);
  const passed = scenarios.filter((s) => s.passed).length;
  return { scenarios, overall: { total: scenarios.length, passed, failed: scenarios.length - passed } };
}

export function formatRuntimeStressReport(report: RuntimeStressSuiteReport): string {
  const lines: string[] = [];
  lines.push('═══════════════════════════════════════════════════════');
  lines.push(' Thread runtime observability stress suite');
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

// Keep type imports referenced.
void ({} as ThreadRuntimeTransitionType);
void ({} as ThreadSnapshotPhase);
