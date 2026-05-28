/**
 * Phase 4 — Runtime failure summarizer.
 *
 * Inspects the trace + latest topology snapshot for a thread and produces
 * one or more `RuntimeFailureSummary` records describing what went wrong,
 * the probable root cause, the affected runtime zone, and a recommended
 * recovery action.
 *
 * Pure / deterministic.
 */

import type {
  AffectedRuntimeZone,
  RuntimeFailureSeverity,
  RuntimeFailureSummary,
  RuntimeFailureType,
  ThreadRuntimeTrace,
  ThreadTopologySnapshot,
} from './threadRuntimeTypes';

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

interface DetectorContext {
  trace: ThreadRuntimeTrace | null;
  latestSnap: ThreadTopologySnapshot | null;
  allSnaps: ThreadTopologySnapshot[];
}

type Emit = (input: {
  failureType: RuntimeFailureType;
  failureSeverity: RuntimeFailureSeverity;
  probableRootCause: string;
  affectedRuntimeZone: AffectedRuntimeZone;
  recoveryRecommendation: string;
  evidence: string[];
}) => RuntimeFailureSummary;

function makeEmitter(out: RuntimeFailureSummary[]): Emit {
  return (input) => {
    const s: RuntimeFailureSummary = {
      failureId: newId('fail'),
      failureType: input.failureType,
      failureSeverity: input.failureSeverity,
      probableRootCause: input.probableRootCause,
      affectedRuntimeZone: input.affectedRuntimeZone,
      recoveryRecommendation: input.recoveryRecommendation,
      evidence: input.evidence,
    };
    out.push(s);
    return s;
  };
}

// ── individual detectors ──────────────────────────────────────────────

function detectRuntimeCrashes(ctx: DetectorContext, emit: Emit) {
  if (!ctx.trace) return;
  const failures = ctx.trace.events.filter((e) => e.transitionType === 'persist_failure' || e.transitionType === 'join_failure' || e.transitionType === 'recovery_failure');
  if (failures.length === 0) return;
  // any persist_failure with no subsequent persist_success → crash
  for (const f of failures) {
    if (f.transitionType !== 'persist_failure') continue;
    const recovered = ctx.trace.events.some((e) =>
      e.orchestrationSequence > f.orchestrationSequence
      && e.transitionType === 'persist_success'
      && e.threadId === f.threadId,
    );
    if (!recovered) {
      emit({
        failureType: 'runtime_crash',
        failureSeverity: 'high',
        probableRootCause: f.detail ?? 'persist_failure with no subsequent persist_success',
        affectedRuntimeZone: 'persistence',
        recoveryRecommendation: 'Re-issue the persist call after verifying upstream payload integrity; if schema-related, run schema parity check.',
        evidence: [`event ${f.eventId} @ seq=${f.orchestrationSequence}`, f.detail ?? '(no detail)'],
      });
    }
  }
}

function detectOrphanGeneration(ctx: DetectorContext, emit: Emit) {
  if (!ctx.latestSnap) return;
  const orphans = ctx.latestSnap.orphanNodeIds;
  if (orphans.length === 0) return;
  const severity: RuntimeFailureSeverity = orphans.length >= 3 ? 'high' : 'medium';
  emit({
    failureType: 'orphan_generation',
    failureSeverity: severity,
    probableRootCause: `${orphans.length} node(s) lack a valid parent reference in the latest snapshot`,
    affectedRuntimeZone: 'topology',
    recoveryRecommendation: 'Re-link orphan nodes to the root parent, or remove if they were transient drafts.',
    evidence: orphans.slice(0, 5).map((id) => `orphan: ${id}`),
  });
}

function detectTopologyCorruption(ctx: DetectorContext, emit: Emit) {
  if (!ctx.latestSnap) return;
  const integrity = ctx.latestSnap.topologyIntegrityScore;
  if (integrity >= 70) return;
  const severity: RuntimeFailureSeverity = integrity < 35 ? 'critical' : integrity < 55 ? 'high' : 'medium';
  emit({
    failureType: 'topology_corruption',
    failureSeverity: severity,
    probableRootCause: `Topology integrity score ${integrity}/100; join=${ctx.latestSnap.joinIntegrity}, ordering=${ctx.latestSnap.orderingIntegrity}`,
    affectedRuntimeZone: 'topology',
    recoveryRecommendation: 'Capture a fresh topology snapshot post-recovery; if integrity remains low, roll back to the last healthy snapshot.',
    evidence: [
      `joinIntegrity=${ctx.latestSnap.joinIntegrity}`,
      `orderingIntegrity=${ctx.latestSnap.orderingIntegrity}`,
      `orphans=${ctx.latestSnap.orphanNodeIds.length}`,
    ],
  });
}

function detectPersistenceFailures(ctx: DetectorContext, emit: Emit) {
  if (!ctx.trace) return;
  const failures = ctx.trace.events.filter((e) => e.transitionType === 'persist_failure');
  if (failures.length === 0) return;
  if (failures.length === 1) {
    // already covered by detectRuntimeCrashes if unrecovered
    return;
  }
  emit({
    failureType: 'persistence_failure',
    failureSeverity: failures.length >= 4 ? 'high' : 'medium',
    probableRootCause: `${failures.length} persist_failure events recorded in this session`,
    affectedRuntimeZone: 'persistence',
    recoveryRecommendation: 'Inspect schema parity + RPC inputs. Recurring persist failures usually indicate a column/constraint mismatch or RLS regression.',
    evidence: failures.slice(0, 5).map((f) => `seq=${f.orchestrationSequence}: ${f.detail ?? '(no detail)'}`),
  });
}

function detectOrderingFailure(ctx: DetectorContext, emit: Emit) {
  if (!ctx.latestSnap) return;
  if (ctx.latestSnap.orderingIntegrity === 'monotonic') return;
  emit({
    failureType: 'ordering_failure',
    failureSeverity: ctx.latestSnap.orderingIntegrity === 'duplicates' ? 'high' : 'medium',
    probableRootCause: `Ordering integrity = ${ctx.latestSnap.orderingIntegrity}`,
    affectedRuntimeZone: 'topology',
    recoveryRecommendation: 'Re-emit positions with a strict monotonic 0..N-1 sequence; verify reorder operations target the canonical position field.',
    evidence: ctx.latestSnap.nodes.map((n) => `node ${n.nodeId.slice(0, 8)}@pos=${n.position}`).slice(0, 8),
  });
}

function detectJoinInconsistency(ctx: DetectorContext, emit: Emit) {
  if (!ctx.latestSnap) return;
  if (ctx.latestSnap.joinIntegrity === 'intact') return;
  emit({
    failureType: 'join_inconsistency',
    failureSeverity: ctx.latestSnap.joinIntegrity === 'broken' ? 'high' : 'medium',
    probableRootCause: `Join integrity = ${ctx.latestSnap.joinIntegrity}`,
    affectedRuntimeZone: 'topology',
    recoveryRecommendation: 'Audit parent_post_id references; refresh runtime cache from DB to align parent pointers.',
    evidence: [`rootNodeId=${ctx.latestSnap.rootNodeId ?? '(null)'}`, `joinIntegrity=${ctx.latestSnap.joinIntegrity}`],
  });
}

function detectReloadInconsistency(ctx: DetectorContext, emit: Emit) {
  if (ctx.allSnaps.length < 2) return;
  // Find adjacent pre/post pairs that differ wildly in node count.
  for (let i = 1; i < ctx.allSnaps.length; i += 1) {
    const before = ctx.allSnaps[i - 1];
    const after = ctx.allSnaps[i];
    const beforeIds = new Set(before.nodes.map((n) => n.nodeId));
    const afterIds = new Set(after.nodes.map((n) => n.nodeId));
    const lostCount = [...beforeIds].filter((id) => !afterIds.has(id)).length;
    // After a refresh-observed adjacency, losing nodes = reload inconsistency.
    if (lostCount >= 2 && before.phase !== 'post_reorder' && after.phase === 'post_recovery') {
      emit({
        failureType: 'reload_inconsistency',
        failureSeverity: lostCount >= 4 ? 'high' : 'medium',
        probableRootCause: `${lostCount} node(s) present pre-reload missing post-reload`,
        affectedRuntimeZone: 'transport',
        recoveryRecommendation: 'Verify session restoration logic and re-read persisted state from authoritative source.',
        evidence: [
          `before phase=${before.phase} (n=${beforeIds.size})`,
          `after phase=${after.phase} (n=${afterIds.size})`,
        ],
      });
    }
  }
}

function detectAiManualDivergence(ctx: DetectorContext, emit: Emit) {
  if (!ctx.trace) return;
  const aiNodes = ctx.trace.events.filter((e) => e.nodeGenerationMode === 'ai' && e.transitionType === 'node_create').length;
  const manualNodes = ctx.trace.events.filter((e) => e.nodeGenerationMode === 'manual' && e.transitionType === 'node_create').length;
  if (aiNodes === 0 || manualNodes === 0) return;
  // Both modes present + ordering anomaly → divergence
  if (ctx.latestSnap?.orderingIntegrity !== 'monotonic') {
    emit({
      failureType: 'ai_manual_divergence',
      failureSeverity: 'medium',
      probableRootCause: `Mixed AI (${aiNodes}) + manual (${manualNodes}) node creates with non-monotonic ordering`,
      affectedRuntimeZone: 'orchestration',
      recoveryRecommendation: 'Force-recompute thread_position after any mixed-mode insertion; surface to the editor for manual reconciliation.',
      evidence: [`ai_creates=${aiNodes}`, `manual_creates=${manualNodes}`, `ordering=${ctx.latestSnap?.orderingIntegrity}`],
    });
  }
}

// ── public API ────────────────────────────────────────────────────────

export interface SummarizeRuntimeFailuresInput {
  trace: ThreadRuntimeTrace | null;
  snapshots: ThreadTopologySnapshot[];
}

export function summarizeRuntimeFailures(input: SummarizeRuntimeFailuresInput): RuntimeFailureSummary[] {
  const out: RuntimeFailureSummary[] = [];
  const emit = makeEmitter(out);
  const ctx: DetectorContext = {
    trace: input.trace,
    latestSnap: input.snapshots[input.snapshots.length - 1] ?? null,
    allSnaps: input.snapshots,
  };
  detectRuntimeCrashes(ctx, emit);
  detectOrphanGeneration(ctx, emit);
  detectTopologyCorruption(ctx, emit);
  detectPersistenceFailures(ctx, emit);
  detectOrderingFailure(ctx, emit);
  detectJoinInconsistency(ctx, emit);
  detectReloadInconsistency(ctx, emit);
  detectAiManualDivergence(ctx, emit);
  return out;
}
