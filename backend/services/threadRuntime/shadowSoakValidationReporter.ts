/**
 * Phase 3 — Shadow soak validation reporter.
 *
 * Consumes the runtime trace + topology snapshots for a given thread/session
 * and produces a `ShadowSoakReport` per flow type:
 *
 *   manual_3       — 3-node manual flow
 *   ai_10_edit     — 10-node AI + post-edit flow
 *   mixed          — mixed AI + manual joins
 *   reorder        — reorder flow
 *   persistence    — persistence flow
 *   refresh        — refresh/reload flow
 *
 * Scoring axes:
 *   - runtimeStabilityScore       (persist_failure / recovery_failure rate)
 *   - topologyIntegrityScore      (latest snapshot's integrity)
 *   - orphanRiskScore             (mean orphan count across snapshots)
 *   - rowJoinIntegrityScore       (join_failure rate)
 *   - persistenceConsistencyScore (persist_attempt vs persist_success rate)
 *   - orderingContinuityScore     (snapshots reporting monotonic ordering)
 *   - recoveryStabilityScore      (recovery_success / recovery_attempt rate)
 *
 * Pure / deterministic.
 */

import type {
  ShadowSoakFlowType,
  ShadowSoakReport,
  ThreadRuntimeTrace,
  ThreadTopologySnapshot,
} from './threadRuntimeTypes';

function clamp100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function pct(numer: number, denom: number): number {
  if (denom <= 0) return 100; // no attempts → no failures
  return Math.round((numer / denom) * 100);
}

export interface BuildShadowSoakReportInput {
  flow: ShadowSoakFlowType;
  threadId: string;
  trace: ThreadRuntimeTrace | null;
  snapshots: ThreadTopologySnapshot[];
}

export function buildShadowSoakReport(input: BuildShadowSoakReportInput): ShadowSoakReport {
  const events = input.trace?.events ?? [];
  const snaps = input.snapshots;
  const warnings: string[] = [];

  // ── persistence ────────────────────────────────────────────────────────
  const persistAttempts = events.filter((e) => e.transitionType === 'persist_attempt').length;
  const persistSuccess = events.filter((e) => e.transitionType === 'persist_success').length;
  const persistFailure = events.filter((e) => e.transitionType === 'persist_failure').length;
  const persistenceConsistencyScore = persistAttempts === 0
    ? 100
    : clamp100((persistSuccess / persistAttempts) * 100);
  if (persistFailure > 0) warnings.push(`${persistFailure} persistence failure(s) recorded`);

  // ── join integrity ─────────────────────────────────────────────────────
  const joinAttempts = events.filter((e) => e.transitionType === 'join_attempt').length;
  const joinSuccess = events.filter((e) => e.transitionType === 'join_success').length;
  const joinFailure = events.filter((e) => e.transitionType === 'join_failure').length;
  const rowJoinIntegrityScore = joinAttempts === 0 ? 100 : clamp100((joinSuccess / joinAttempts) * 100);
  if (joinFailure > 0) warnings.push(`${joinFailure} join failure(s) recorded`);

  // ── recovery ──────────────────────────────────────────────────────────
  const recoveryAttempts = events.filter((e) => e.transitionType === 'recovery_attempt').length;
  const recoverySuccess = events.filter((e) => e.transitionType === 'recovery_success').length;
  const recoveryFailure = events.filter((e) => e.transitionType === 'recovery_failure').length;
  const recoveryStabilityScore = recoveryAttempts === 0
    ? 100
    : clamp100((recoverySuccess / recoveryAttempts) * 100);
  if (recoveryFailure > 0) warnings.push(`${recoveryFailure} recovery failure(s) recorded`);

  // ── topology + ordering + orphan ──────────────────────────────────────
  const latestSnap = snaps[snaps.length - 1] ?? null;
  const topologyIntegrityScore = latestSnap?.topologyIntegrityScore ?? 100;
  const orphanCountSum = snaps.reduce((s, x) => s + x.orphanNodeIds.length, 0);
  const orphanMean = snaps.length === 0 ? 0 : orphanCountSum / snaps.length;
  // orphan risk: 100 = no orphans observed; degrades with every orphan.
  const orphanRiskScore = clamp100(orphanMean * 25);
  if (orphanMean > 0) warnings.push(`mean orphan count across snapshots: ${orphanMean.toFixed(2)}`);

  const monotonicCount = snaps.filter((s) => s.orderingIntegrity === 'monotonic').length;
  const orderingContinuityScore = snaps.length === 0 ? 100 : clamp100((monotonicCount / snaps.length) * 100);
  if (orderingContinuityScore < 100) warnings.push(`only ${monotonicCount}/${snaps.length} snapshots reported monotonic ordering`);

  // ── runtime stability ─────────────────────────────────────────────────
  // weighted combination — penalize persistence/recovery/join failures relative to total events
  const failureCount = persistFailure + joinFailure + recoveryFailure;
  const totalEvents = Math.max(1, events.length);
  const failurePct = pct(failureCount, totalEvents);
  const runtimeStabilityScore = clamp100(100 - failurePct);

  // ── overall ───────────────────────────────────────────────────────────
  const overallSoakHealthScore = clamp100(
    runtimeStabilityScore * 0.25
    + topologyIntegrityScore * 0.25
    + (100 - orphanRiskScore) * 0.15
    + rowJoinIntegrityScore * 0.10
    + persistenceConsistencyScore * 0.10
    + orderingContinuityScore * 0.10
    + recoveryStabilityScore * 0.05,
  );

  // ── flow-specific assertions ──────────────────────────────────────────
  if (input.flow === 'manual_3') {
    const nodeCount = latestSnap?.nodes.length ?? 0;
    if (nodeCount !== 3) warnings.push(`manual_3 flow expected 3 nodes; observed ${nodeCount}`);
  }
  if (input.flow === 'ai_10_edit') {
    const nodeCount = latestSnap?.nodes.length ?? 0;
    if (nodeCount !== 10) warnings.push(`ai_10_edit flow expected 10 nodes; observed ${nodeCount}`);
  }
  if (input.flow === 'refresh') {
    const refreshEvents = events.filter((e) => e.transitionType === 'refresh_observed').length;
    if (refreshEvents === 0) warnings.push('refresh flow recorded no refresh_observed events');
  }
  if (input.flow === 'reorder') {
    const reorderEvents = events.filter((e) => e.transitionType === 'node_reorder').length;
    if (reorderEvents === 0) warnings.push('reorder flow recorded no node_reorder events');
  }

  return {
    flow: input.flow,
    threadId: input.threadId,
    reportedAt: new Date().toISOString(),
    runtimeStabilityScore,
    topologyIntegrityScore,
    orphanRiskScore,
    rowJoinIntegrityScore,
    persistenceConsistencyScore,
    orderingContinuityScore,
    recoveryStabilityScore,
    overallSoakHealthScore,
    warnings,
  };
}
