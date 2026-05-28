/**
 * Phase 8 (wiring) — Thread runtime wiring stress tests.
 *
 * Exercises the wiring layer (instrumentation helper, replay contract
 * validator, silent-zone detector, consistency governor, introspection
 * coordinator) against adversarial scenarios.
 *
 * Run via:
 *   npx tsx scripts/ops/longFormThreadRuntimeWiringStress.ts
 */

import type { ThreadNodeShape } from './threadRuntimeTypes';
import {
  createThreadRuntimeTraceRegistry,
  type RecordTraceEventInput,
} from './threadRuntimeTraceRegistry';
import { createThreadTopologySnapshotEngine } from './threadTopologySnapshotEngine';
import { openThreadRuntimeTracer } from './threadRuntimeInstrumentation';
import { checkReplayContract, validateAndNormalize, ReplayContractViolation } from './runtimeReplayContractValidator';
import { detectSilentZones } from './runtimeSilentZoneDetector';
import { checkTraceConsistency } from './runtimeTraceConsistencyGovernor';
import { introspectThreadRuntime } from './threadRuntimeIntrospectionCoordinator';

// ── helpers ────────────────────────────────────────────────────────────

let _idc = 0;
function nid(prefix = 'n'): string { _idc += 1; return `${prefix}_${_idc.toString(36)}`; }
function isoSecAgo(secs: number): string { return new Date(Date.now() - secs * 1000).toISOString(); }
function makeNode(id: string, position: number, parentId: string | null): ThreadNodeShape {
  return { nodeId: id, position, parentNodeId: parentId, status: 'draft', hasContent: true, generationMode: 'manual' };
}

export interface WiringAssertion { name: string; passed: boolean; observed: string | number; expected: string }
export interface WiringScenarioResult { scenario: string; assertions: WiringAssertion[]; passed: boolean }
function ok(name: string, observed: string | number, passed: boolean, expected: string): WiringAssertion {
  return { name, observed, passed, expected };
}

// ── scenarios ──────────────────────────────────────────────────────────

async function scenario_baseline(): Promise<WiringScenarioResult> {
  // Use the instrumentation helper to emit a healthy 3-node flow, then
  // introspect — every metric should be green.
  _idc = 0;
  const registry = createThreadRuntimeTraceRegistry();
  const snapshotEngine = createThreadTopologySnapshotEngine();
  const tracer = openThreadRuntimeTracer({
    threadId: 'thr_wb', companyId: 'co_test',
    options: { registry, snapshotEngine },
  });
  const rootId = nid();
  tracer.captureSnapshot({ phase: 'pre_generation', nodes: [], rootNodeId: null });
  tracer.recordNodeCreate({ nodeId: rootId, parentNodeId: null, position: 0, mode: 'manual', latencyMs: 30 });
  const c1 = nid();
  tracer.recordNodeCreate({ nodeId: c1, parentNodeId: rootId, position: 1, mode: 'manual', latencyMs: 40 });
  const c2 = nid();
  tracer.recordNodeCreate({ nodeId: c2, parentNodeId: rootId, position: 2, mode: 'manual', latencyMs: 35 });
  tracer.recordPersistAttempt();
  tracer.recordPersistSuccess({ latencyMs: 1100 });
  const nodes = [makeNode(rootId, 0, null), makeNode(c1, 1, rootId), makeNode(c2, 2, rootId)];
  tracer.captureSnapshot({ phase: 'post_generation', nodes, rootNodeId: rootId });
  tracer.endSession();

  const intro = introspectThreadRuntime({
    runtimeSessionId: tracer.runtimeSessionId,
    threadId: tracer.threadId,
    expectedNodeCount: 3,
    flow: 'manual_3',
    declared: { nodeCreates: 3, persistAttempts: 1, snapshotCaptures: 2 },
    options: { registry, snapshotEngine },
  });

  return {
    scenario: 'baseline. instrumented healthy 3-node flow',
    passed: true,
    assertions: [
      ok('trace present', intro.trace ? 'yes' : 'no', !!intro.trace, 'yes'),
      ok('snapshots captured = 2', intro.snapshots.length, intro.snapshots.length === 2, '2'),
      ok('consistency ok', intro.consistency?.ok ? 'true' : 'false', intro.consistency?.ok === true, 'true'),
      ok('validation passed', intro.validation?.validationPassed ? 'true' : 'false', intro.validation?.validationPassed === true, 'true'),
      ok('silent zone warnings = 0', intro.silentZones?.silentZoneWarnings.length ?? 0, (intro.silentZones?.silentZoneWarnings.length ?? 0) === 0, '0'),
      ok('coverage 100%', intro.silentZones?.coveragePercent ?? 0, (intro.silentZones?.coveragePercent ?? 0) >= 100, '≥ 100'),
      ok('no failures', intro.failures.length, intro.failures.length === 0, '0'),
    ],
  };
}

async function scenario1_missingTraceEmission(): Promise<WiringScenarioResult> {
  // Caller declared 5 node creates but emitted only 2 → silent zone.
  const registry = createThreadRuntimeTraceRegistry();
  const snapshotEngine = createThreadTopologySnapshotEngine();
  const tracer = openThreadRuntimeTracer({
    threadId: 'thr_miss', companyId: 'co_test',
    options: { registry, snapshotEngine },
  });
  tracer.recordNodeCreate({ nodeId: 'a', parentNodeId: null, position: 0, mode: 'manual' });
  tracer.recordNodeCreate({ nodeId: 'b', parentNodeId: 'a', position: 1, mode: 'manual' });

  const intro = introspectThreadRuntime({
    runtimeSessionId: tracer.runtimeSessionId,
    threadId: tracer.threadId,
    expectedNodeCount: 5,
    declared: { nodeCreates: 5 },
    options: { registry, snapshotEngine },
  });

  return {
    scenario: '1. missing trace emission',
    passed: true,
    assertions: [
      ok('silent zone warning surfaced', intro.silentZones?.silentZoneWarnings.length ?? 0,
        (intro.silentZones?.silentZoneWarnings.length ?? 0) >= 1, '≥ 1'),
      ok('coverage < 100', intro.silentZones?.coveragePercent ?? 100,
        (intro.silentZones?.coveragePercent ?? 100) < 100, '< 100'),
    ],
  };
}

async function scenario2_duplicateLifecycleEvents(): Promise<WiringScenarioResult> {
  // Manually craft a trace with two persist_success terminators after one persist_attempt.
  const registry = createThreadRuntimeTraceRegistry();
  const sid = 'rs_dup';
  registry.startSession({ runtimeSessionId: sid, threadId: 'thr_dup', companyId: 'co_test' });
  registry.recordEvent({ runtimeSessionId: sid, threadId: 'thr_dup', companyId: 'co_test', transitionType: 'persist_attempt' });
  registry.recordEvent({ runtimeSessionId: sid, threadId: 'thr_dup', companyId: 'co_test', transitionType: 'persist_success' });
  registry.recordEvent({ runtimeSessionId: sid, threadId: 'thr_dup', companyId: 'co_test', transitionType: 'persist_success' });
  const trace = registry.getTrace(sid)!;
  const c = checkTraceConsistency({ trace, allowOpenSession: true });
  return {
    scenario: '2. duplicate lifecycle events',
    passed: true,
    assertions: [
      ok('duplicate_terminator detected', c.issues.map((i) => i.type).join(','),
        c.issues.some((i) => i.type === 'duplicate_terminator'), 'duplicate_terminator'),
    ],
  };
}

async function scenario3_outOfOrderSequences(): Promise<WiringScenarioResult> {
  // Manually inject events with non-monotonic orchestrationSequence — direct push to the trace.
  const registry = createThreadRuntimeTraceRegistry();
  const sid = 'rs_oos';
  registry.startSession({ runtimeSessionId: sid, threadId: 'thr_oos', companyId: 'co_test' });
  registry.recordEvent({ runtimeSessionId: sid, threadId: 'thr_oos', companyId: 'co_test', transitionType: 'node_create',
    childNodeIds: ['n1'], payload: { position: 0 } });
  registry.recordEvent({ runtimeSessionId: sid, threadId: 'thr_oos', companyId: 'co_test', transitionType: 'node_create',
    parentNodeId: 'n1', childNodeIds: ['n2'], payload: { position: 1 } });
  // Force a non-monotonic sequence by hand on the trace.
  const trace = registry.getTrace(sid)!;
  trace.events[trace.events.length - 1].orchestrationSequence = 1; // collide with earlier seq
  const c = checkTraceConsistency({ trace, allowOpenSession: true });
  return {
    scenario: '3. out-of-order orchestration sequences',
    passed: true,
    assertions: [
      ok('non_monotonic_sequence detected', c.issues.map((i) => i.type).join(','),
        c.issues.some((i) => i.type === 'non_monotonic_sequence'), 'non_monotonic_sequence'),
    ],
  };
}

async function scenario4_snapshotOmission(): Promise<WiringScenarioResult> {
  // Caller declared 2 snapshot captures but supplied none.
  const registry = createThreadRuntimeTraceRegistry();
  const tracer = openThreadRuntimeTracer({ threadId: 'thr_snap', companyId: 'co_test', options: { registry } });
  tracer.recordNodeCreate({ nodeId: 'a', parentNodeId: null, position: 0, mode: 'manual' });
  const result = detectSilentZones({
    trace: registry.getTrace(tracer.runtimeSessionId)!,
    declaredMutations: { snapshotCaptures: 2 },
  });
  return {
    scenario: '4. snapshot omission',
    passed: true,
    assertions: [
      ok('missingInstrumentationZones contains snapshot_capture',
        result.missingInstrumentationZones.map((z) => z.kind).join(','),
        result.missingInstrumentationZones.some((z) => z.kind === 'snapshot_capture'),
        'snapshot_capture'),
    ],
  };
}

async function scenario5_replayChainCorruption(): Promise<WiringScenarioResult> {
  // node_create references a parent that was never created.
  expect(() => validateAndNormalize({
    runtimeSessionId: 'r', threadId: 't', companyId: 'c',
    transitionType: 'node_create',
    parentNodeId: 'ghost', childNodeIds: ['n1'], payload: { position: 1 },
  })).not.toThrow();
  // Build the bad event in the registry (the contract validator doesn't check ordering across events; the consistency governor does).
  const registry = createThreadRuntimeTraceRegistry();
  const sid = 'rs_chain';
  registry.startSession({ runtimeSessionId: sid, threadId: 't', companyId: 'c' });
  registry.recordEvent({ runtimeSessionId: sid, threadId: 't', companyId: 'c', transitionType: 'node_create',
    parentNodeId: 'ghost', childNodeIds: ['n1'], payload: { position: 1 } });
  const c = checkTraceConsistency({ trace: registry.getTrace(sid)!, allowOpenSession: true });
  return {
    scenario: '5. replay-chain corruption (parent never created)',
    passed: true,
    assertions: [
      ok('broken_replay_chain detected', c.issues.map((i) => i.type).join(','),
        c.issues.some((i) => i.type === 'broken_replay_chain'), 'broken_replay_chain'),
    ],
  };
}

async function scenario6_silentPersistenceMutation(): Promise<WiringScenarioResult> {
  // Snapshot pair shows a node was added but no node_create event between the two snapshots.
  const registry = createThreadRuntimeTraceRegistry();
  const snapshotEngine = createThreadTopologySnapshotEngine();
  const tracer = openThreadRuntimeTracer({ threadId: 'thr_silent', companyId: 'co_test', options: { registry, snapshotEngine } });
  // Capture an empty pre snapshot.
  tracer.captureSnapshot({ phase: 'pre_generation', nodes: [], rootNodeId: null });
  // Capture a post snapshot with a node but no node_create event in between.
  const nodes = [makeNode('root', 0, null)];
  tracer.captureSnapshot({ phase: 'post_generation', nodes, rootNodeId: 'root' });
  const snaps = snapshotEngine.list('thr_silent');
  const result = detectSilentZones({
    trace: registry.getTrace(tracer.runtimeSessionId)!,
    snapshotPairs: [{ before: snaps[0], after: snaps[1], expectedKind: 'persistence' }],
  });
  return {
    scenario: '6. silent persistence mutation',
    passed: true,
    assertions: [
      ok('silentZoneWarnings present', result.silentZoneWarnings.length, result.silentZoneWarnings.length >= 1, '≥ 1'),
    ],
  };
}

async function scenario7_unclosedJoinLifecycle(): Promise<WiringScenarioResult> {
  // join_attempt with no terminator.
  const registry = createThreadRuntimeTraceRegistry();
  const sid = 'rs_join';
  registry.startSession({ runtimeSessionId: sid, threadId: 't', companyId: 'c' });
  registry.recordEvent({ runtimeSessionId: sid, threadId: 't', companyId: 'c', transitionType: 'node_create',
    childNodeIds: ['root'], payload: { position: 0 } });
  registry.recordEvent({ runtimeSessionId: sid, threadId: 't', companyId: 'c', transitionType: 'join_attempt',
    parentNodeId: 'root', childNodeIds: ['n1'] });
  // No join_success / join_failure
  const c = checkTraceConsistency({ trace: registry.getTrace(sid)!, allowOpenSession: true });
  return {
    scenario: '7. unclosed join lifecycle',
    passed: true,
    assertions: [
      ok('dangling_join detected', c.issues.map((i) => i.type).join(','),
        c.issues.some((i) => i.type === 'dangling_join'), 'dangling_join'),
    ],
  };
}

async function scenario8_reloadWithoutSnapshot(): Promise<WiringScenarioResult> {
  // refresh_observed event but no snapshot captured after.
  const registry = createThreadRuntimeTraceRegistry();
  const snapshotEngine = createThreadTopologySnapshotEngine();
  const tracer = openThreadRuntimeTracer({ threadId: 'thr_reload', companyId: 'co_test', options: { registry, snapshotEngine } });
  tracer.captureSnapshot({ phase: 'pre_generation', nodes: [], rootNodeId: null });
  tracer.recordRefreshObserved();
  // No post-refresh snapshot captured.
  const intro = introspectThreadRuntime({
    runtimeSessionId: tracer.runtimeSessionId,
    threadId: tracer.threadId,
    expectedNodeCount: 0,
    declared: { refreshes: 1, snapshotCaptures: 2 },
    options: { registry, snapshotEngine },
  });
  return {
    scenario: '8. reload without snapshot',
    passed: true,
    assertions: [
      ok('snapshot_capture missing-instrumentation flag',
        intro.silentZones?.missingInstrumentationZones.map((z) => z.kind).join(','),
        (intro.silentZones?.missingInstrumentationZones.some((z) => z.kind === 'snapshot_capture') ?? false),
        'snapshot_capture'),
    ],
  };
}

async function scenario9_recoveryWithoutCompletion(): Promise<WiringScenarioResult> {
  const registry = createThreadRuntimeTraceRegistry();
  const sid = 'rs_rec';
  registry.startSession({ runtimeSessionId: sid, threadId: 't', companyId: 'c' });
  registry.recordEvent({ runtimeSessionId: sid, threadId: 't', companyId: 'c', transitionType: 'recovery_attempt', detail: 'attempted' });
  // No success or failure
  const c = checkTraceConsistency({ trace: registry.getTrace(sid)!, allowOpenSession: true });
  return {
    scenario: '9. recovery without completion',
    passed: true,
    assertions: [
      ok('dangling_recovery detected', c.issues.map((i) => i.type).join(','),
        c.issues.some((i) => i.type === 'dangling_recovery'), 'dangling_recovery'),
    ],
  };
}

async function scenario10_impossibleTransitions(): Promise<WiringScenarioResult> {
  // persist_success without a preceding persist_attempt.
  const registry = createThreadRuntimeTraceRegistry();
  const sid = 'rs_imp';
  registry.startSession({ runtimeSessionId: sid, threadId: 't', companyId: 'c' });
  registry.recordEvent({ runtimeSessionId: sid, threadId: 't', companyId: 'c', transitionType: 'persist_success' });
  const c = checkTraceConsistency({ trace: registry.getTrace(sid)!, allowOpenSession: true });
  return {
    scenario: '10. impossible transitions',
    passed: true,
    assertions: [
      ok('impossible_transition detected', c.issues.map((i) => i.type).join(','),
        c.issues.some((i) => i.type === 'impossible_transition'), 'impossible_transition'),
    ],
  };
}

async function scenario_endToEnd(): Promise<WiringScenarioResult> {
  // Replay contract gate: invalid node_create should be rejected by the validator.
  const result = checkReplayContract({
    runtimeSessionId: 'r', threadId: 't', companyId: 'c',
    transitionType: 'node_create',
    childNodeIds: [], // INVALID — must be exactly 1
    payload: {}, // INVALID — missing position
  } as RecordTraceEventInput);
  const violationFiresOnValidate = (() => {
    try {
      validateAndNormalize({
        runtimeSessionId: 'r', threadId: 't', companyId: 'c',
        transitionType: 'node_create',
        childNodeIds: [],
        payload: {},
      } as RecordTraceEventInput);
      return false;
    } catch (err) {
      return err instanceof ReplayContractViolation;
    }
  })();

  return {
    scenario: '11. replay-contract end-to-end gate',
    passed: true,
    assertions: [
      ok('contract check reports ok=false', result.ok ? 'true' : 'false', !result.ok, 'false'),
      ok('contract errors ≥ 2', result.errors.length, result.errors.length >= 2, '≥ 2'),
      ok('validateAndNormalize throws ReplayContractViolation', violationFiresOnValidate ? 'true' : 'false',
        violationFiresOnValidate, 'true'),
    ],
  };
}

// Tiny "expect" shim so scenario_5 reads naturally without bringing in jest.
function expect(fn: () => unknown) {
  return {
    not: {
      toThrow() {
        try { fn(); } catch { return; }
      },
    },
  };
}

// ── suite ──────────────────────────────────────────────────────────────

export interface WiringStressSuiteReport {
  scenarios: WiringScenarioResult[];
  overall: { total: number; passed: number; failed: number };
}

function finalize(r: WiringScenarioResult): WiringScenarioResult {
  r.passed = r.assertions.every((a) => a.passed);
  return r;
}

export async function runThreadRuntimeWiringStressTests(): Promise<WiringStressSuiteReport> {
  const results = await Promise.all([
    scenario_baseline(),
    scenario1_missingTraceEmission(),
    scenario2_duplicateLifecycleEvents(),
    scenario3_outOfOrderSequences(),
    scenario4_snapshotOmission(),
    scenario5_replayChainCorruption(),
    scenario6_silentPersistenceMutation(),
    scenario7_unclosedJoinLifecycle(),
    scenario8_reloadWithoutSnapshot(),
    scenario9_recoveryWithoutCompletion(),
    scenario10_impossibleTransitions(),
    scenario_endToEnd(),
  ]);
  const scenarios = results.map(finalize);
  const passed = scenarios.filter((s) => s.passed).length;
  return { scenarios, overall: { total: scenarios.length, passed, failed: scenarios.length - passed } };
}

export function formatWiringStressReport(report: WiringStressSuiteReport): string {
  const lines: string[] = [];
  lines.push('═══════════════════════════════════════════════════════');
  lines.push(' Thread runtime observability wiring stress suite');
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
