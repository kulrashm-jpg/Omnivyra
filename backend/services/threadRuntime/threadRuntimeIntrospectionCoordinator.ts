/**
 * Phase 7 (wiring) — Thread runtime introspection coordinator.
 *
 * Single-call surface for operators / dashboards / debug pages. Given a
 * runtimeSessionId (or threadId), it gathers:
 *
 *   - the trace
 *   - all snapshots
 *   - failure summaries
 *   - runtime diagnostics
 *   - recovery state
 *   - replay validation
 *   - consistency validation
 *   - silent-zone detection (when caller declares expected mutations)
 *   - operator summary
 *
 * Replaces every previous "tail logs + grep + cross-reference" workflow
 * with one canonical introspection object.
 */

import type {
  RecoveryTrace,
  RuntimeFailureSummary,
  RuntimeOperatorSummary,
  ShadowRunValidationResult,
  ShadowSoakFlowType,
  ShadowSoakReport,
  ThreadRuntimeDiagnosticsResult,
  ThreadRuntimeTrace,
  ThreadTopologySnapshot,
} from './threadRuntimeTypes';
import {
  getDefaultThreadRuntimeTraceRegistry,
  type ThreadRuntimeTraceRegistry,
} from './threadRuntimeTraceRegistry';
import {
  getDefaultThreadTopologySnapshotEngine,
  type ThreadTopologySnapshotEngine,
} from './threadTopologySnapshotEngine';
import { buildShadowSoakReport } from './shadowSoakValidationReporter';
import { summarizeRuntimeFailures } from './runtimeFailureSummarizer';
import { computeThreadRuntimeDiagnostics } from './threadRuntimeDiagnostics';
import { selfValidateShadowRun } from './shadowRunSelfValidator';
import { extractRecoveryTraces } from './runtimeRecoveryTraceability';
import { composeRuntimeOperatorSummary } from './runtimeOperatorSummaryComposer';
import {
  checkTraceConsistency,
  type TraceConsistencyResult,
} from './runtimeTraceConsistencyGovernor';
import {
  detectSilentZones,
  type RuntimeSilentZoneDetectionResult,
} from './runtimeSilentZoneDetector';

export interface ThreadRuntimeIntrospection {
  trace: ThreadRuntimeTrace | null;
  snapshots: ThreadTopologySnapshot[];
  failures: RuntimeFailureSummary[];
  diagnostics: ThreadRuntimeDiagnosticsResult;
  recoveries: RecoveryTrace[];
  validation: ShadowRunValidationResult | null;
  consistency: TraceConsistencyResult | null;
  silentZones: RuntimeSilentZoneDetectionResult | null;
  soakReport: ShadowSoakReport | null;
  operatorSummary: RuntimeOperatorSummary | null;
}

export interface IntrospectThreadRuntimeInput {
  runtimeSessionId?: string;
  threadId?: string;
  /** when an explicit expected count is known, plumb it through the self-validator and silent-zone detector */
  expectedNodeCount?: number;
  flow?: ShadowSoakFlowType;
  declared?: {
    nodeCreates?: number;
    nodeEdits?: number;
    nodeReorders?: number;
    persistAttempts?: number;
    refreshes?: number;
    recoveries?: number;
    joinAttempts?: number;
    snapshotCaptures?: number;
  };
  allowOpenSession?: boolean;
  options?: {
    registry?: ThreadRuntimeTraceRegistry;
    snapshotEngine?: ThreadTopologySnapshotEngine;
  };
}

export function introspectThreadRuntime(input: IntrospectThreadRuntimeInput): ThreadRuntimeIntrospection {
  const registry = input.options?.registry ?? getDefaultThreadRuntimeTraceRegistry();
  const snapshotEngine = input.options?.snapshotEngine ?? getDefaultThreadTopologySnapshotEngine();

  // Locate the trace
  let trace: ThreadRuntimeTrace | null = null;
  if (input.runtimeSessionId) {
    trace = registry.getTrace(input.runtimeSessionId) ?? null;
  }
  if (!trace && input.threadId) {
    // Fall back: find the most recent session for this thread
    const all = registry.listTraces();
    trace = [...all].reverse().find((t) => t.threadId === input.threadId) ?? null;
  }

  const threadId = trace?.threadId ?? input.threadId ?? '(unknown)';
  const snapshots = threadId !== '(unknown)' ? snapshotEngine.list(threadId) : [];

  const failures = summarizeRuntimeFailures({ trace, snapshots });
  const diagnostics = computeThreadRuntimeDiagnostics({ traces: trace ? [trace] : [] });
  const recoveries = trace ? extractRecoveryTraces({ trace }) : [];

  const validation = (input.expectedNodeCount !== undefined && trace)
    ? selfValidateShadowRun({ threadId, expectedNodeCount: input.expectedNodeCount, trace, snapshots })
    : null;

  const consistency = trace
    ? checkTraceConsistency({ trace, allowOpenSession: input.allowOpenSession ?? !trace.endedAt })
    : null;

  // Don't auto-synthesize snapshot pairs — the coordinator doesn't know the
  // operation kind that produced each pair. Callers wanting pair-driven
  // detection should call `detectSilentZones` directly with their pairs.
  const silentZones = input.declared
    ? detectSilentZones({ trace, declaredMutations: input.declared })
    : null;

  const soakReport = input.flow
    ? buildShadowSoakReport({ flow: input.flow, threadId, trace, snapshots })
    : null;

  const latestSnap = snapshots[snapshots.length - 1] ?? null;
  const operatorSummary = snapshots.length > 0 || trace
    ? composeRuntimeOperatorSummary({
        threadId, latestSnapshot: latestSnap, soakReport,
        validationResult: validation, failureSummaries: failures, recoveryTraces: recoveries,
      })
    : null;

  return { trace, snapshots, failures, diagnostics, recoveries, validation, consistency, silentZones, soakReport, operatorSummary };
}
