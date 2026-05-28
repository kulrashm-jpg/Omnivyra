/**
 * Phase 4 (wiring) — Runtime silent-zone detector.
 *
 * Looks for evidence of state mutations that should have produced trace
 * events but didn't. This is the dual of replayConsistencyOk in the self
 * validator — instead of checking "every snapshot node has a trace event",
 * it scans for footprints of activity in OTHER signals (DB row counts,
 * snapshot deltas, declared expected mutations) and flags zones with no
 * matching trace event.
 *
 * Input shape — the caller hands us EVIDENCE that something happened:
 *   - snapshotPairs   : pre/post snapshot deltas the caller knows about
 *   - declaredMutations : expected mutation counts (e.g. "I created 5 nodes")
 *   - declaredPersists  : "I attempted N persists"
 *   - declaredRefreshes : "I observed M refreshes"
 *   - declaredRecoveries: "I ran K recoveries"
 *   - declaredJoins     : "I ran J joins"
 *
 * Trace events are then compared against these declarations to surface
 * `missingInstrumentationZones` (an entire instrumentation site is silent)
 * and `silentZoneWarnings` (partial gaps).
 *
 * Pure / deterministic.
 */

import type {
  ThreadRuntimeTrace,
  ThreadTopologySnapshot,
} from './threadRuntimeTypes';

export type SilentZoneKind =
  | 'node_create'
  | 'node_edit'
  | 'node_reorder'
  | 'persistence'
  | 'refresh'
  | 'recovery'
  | 'join'
  | 'snapshot_capture';

export interface SilentZoneWarning {
  kind: SilentZoneKind;
  expected: number;
  observed: number;
  detail: string;
}

export interface MissingInstrumentationZone {
  kind: SilentZoneKind;
  detail: string;
}

export interface RuntimeSilentZoneDetectionResult {
  silentZoneWarnings: SilentZoneWarning[];
  missingInstrumentationZones: MissingInstrumentationZone[];
  totalDeclaredMutations: number;
  totalObservedTraceEvents: number;
  coveragePercent: number; // 0..100
}

export interface DetectSilentZonesInput {
  trace: ThreadRuntimeTrace | null;
  snapshotPairs?: Array<{
    before: ThreadTopologySnapshot;
    after: ThreadTopologySnapshot;
    /** what the caller believes happened between before and after */
    expectedKind: SilentZoneKind;
  }>;
  declaredMutations?: {
    nodeCreates?: number;
    nodeEdits?: number;
    nodeReorders?: number;
    persistAttempts?: number;
    refreshes?: number;
    recoveries?: number;
    joinAttempts?: number;
    snapshotCaptures?: number;
  };
}

export function detectSilentZones(input: DetectSilentZonesInput): RuntimeSilentZoneDetectionResult {
  const events = input.trace?.events ?? [];
  const declared = input.declaredMutations ?? {};
  const warnings: SilentZoneWarning[] = [];
  const missing: MissingInstrumentationZone[] = [];

  function countEvents(types: string[]): number {
    return events.filter((e) => types.includes(e.transitionType)).length;
  }

  function compare(kind: SilentZoneKind, expected: number | undefined, types: string[]) {
    if (expected === undefined || expected <= 0) return;
    const observed = countEvents(types);
    if (observed === 0) {
      missing.push({
        kind,
        detail: `Caller declared ${expected} ${kind} operation(s) but 0 trace events of type [${types.join(', ')}] were recorded`,
      });
      return;
    }
    if (observed < expected) {
      warnings.push({
        kind,
        expected,
        observed,
        detail: `Caller declared ${expected} ${kind} operation(s); only ${observed} matching trace event(s) recorded`,
      });
    }
  }

  compare('node_create', declared.nodeCreates, ['node_create']);
  compare('node_edit', declared.nodeEdits, ['node_edit']);
  compare('node_reorder', declared.nodeReorders, ['node_reorder']);
  compare('persistence', declared.persistAttempts, ['persist_attempt']);
  compare('refresh', declared.refreshes, ['refresh_observed']);
  compare('recovery', declared.recoveries, ['recovery_attempt']);
  compare('join', declared.joinAttempts, ['join_attempt']);

  // Snapshot-driven detection: any pair where the snapshot changed but
  // no trace event of the expected kind appears between them.
  if (input.snapshotPairs) {
    for (const pair of input.snapshotPairs) {
      const beforeTs = Date.parse(pair.before.takenAt);
      const afterTs = Date.parse(pair.after.takenAt);
      if (!Number.isFinite(beforeTs) || !Number.isFinite(afterTs)) continue;

      const beforeNodeIds = new Set(pair.before.nodes.map((n) => n.nodeId));
      const afterNodeIds = new Set(pair.after.nodes.map((n) => n.nodeId));
      const adds = [...afterNodeIds].filter((id) => !beforeNodeIds.has(id));
      const removes = [...beforeNodeIds].filter((id) => !afterNodeIds.has(id));
      const reorders = pair.after.nodes.filter((an) => {
        const bn = pair.before.nodes.find((b) => b.nodeId === an.nodeId);
        return bn && bn.position !== an.position;
      });
      const declaredChangeKindMatch = (kindTypes: string[]) => events.some((e) =>
        kindTypes.includes(e.transitionType)
        && Date.parse(e.timestamp) >= beforeTs
        && Date.parse(e.timestamp) <= afterTs,
      );

      if (adds.length > 0 && !declaredChangeKindMatch(['node_create'])) {
        warnings.push({
          kind: 'node_create',
          expected: adds.length,
          observed: 0,
          detail: `Snapshot delta added ${adds.length} node(s) but no node_create events between ${pair.before.takenAt} and ${pair.after.takenAt}`,
        });
      }
      if (removes.length > 0 && !declaredChangeKindMatch(['node_edit', 'node_reorder', 'recovery_attempt'])) {
        warnings.push({
          kind: 'node_edit',
          expected: removes.length,
          observed: 0,
          detail: `Snapshot delta removed ${removes.length} node(s) but no node_edit / node_reorder / recovery events between snapshots`,
        });
      }
      if (reorders.length > 0 && !declaredChangeKindMatch(['node_reorder'])) {
        warnings.push({
          kind: 'node_reorder',
          expected: reorders.length,
          observed: 0,
          detail: `Snapshot delta reordered ${reorders.length} node(s) but no node_reorder events between snapshots`,
        });
      }

      // Phase-specific assertions
      if (pair.expectedKind === 'persistence' && !declaredChangeKindMatch(['persist_attempt', 'persist_success', 'persist_failure'])) {
        warnings.push({
          kind: 'persistence',
          expected: 1,
          observed: 0,
          detail: `Snapshot pair declared persistence kind but no persist_* events between snapshots`,
        });
      }
      if (pair.expectedKind === 'recovery' && !declaredChangeKindMatch(['recovery_attempt', 'recovery_success', 'recovery_failure'])) {
        warnings.push({
          kind: 'recovery',
          expected: 1,
          observed: 0,
          detail: `Snapshot pair declared recovery kind but no recovery_* events between snapshots`,
        });
      }
    }
  }

  // Snapshot coverage: declaredSnapshotCaptures vs actual
  if (declared.snapshotCaptures !== undefined && declared.snapshotCaptures > 0) {
    const observed = input.snapshotPairs?.length ?? 0;
    if (observed === 0) {
      missing.push({
        kind: 'snapshot_capture',
        detail: `Caller declared ${declared.snapshotCaptures} snapshot capture(s) but supplied none`,
      });
    } else if (observed < declared.snapshotCaptures) {
      warnings.push({
        kind: 'snapshot_capture',
        expected: declared.snapshotCaptures,
        observed,
        detail: `Caller declared ${declared.snapshotCaptures} snapshot capture(s); only ${observed} supplied`,
      });
    }
  }

  const totalDeclaredMutations =
    (declared.nodeCreates ?? 0)
    + (declared.nodeEdits ?? 0)
    + (declared.nodeReorders ?? 0)
    + (declared.persistAttempts ?? 0)
    + (declared.refreshes ?? 0)
    + (declared.recoveries ?? 0)
    + (declared.joinAttempts ?? 0);
  const totalObservedTraceEvents = events.length;
  const coveragePercent = totalDeclaredMutations === 0
    ? 100
    : Math.max(0, Math.min(100, Math.round((totalObservedTraceEvents / totalDeclaredMutations) * 100)));

  return { silentZoneWarnings: warnings, missingInstrumentationZones: missing, totalDeclaredMutations, totalObservedTraceEvents, coveragePercent };
}
