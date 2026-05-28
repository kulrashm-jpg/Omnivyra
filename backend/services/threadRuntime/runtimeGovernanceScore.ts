/**
 * Phase 10 — Runtime governance score composite.
 *
 * Aggregates 6 sub-scores from across the observability layers into one
 * single operational health indicator (0..100) plus a band classifier.
 *
 * Single number ops can route on:
 *   - healthy   ≥ 80
 *   - watch     ≥ 60
 *   - degraded  ≥ 40
 *   - critical  < 40
 *
 * Each component is independently computable so a deployment can decide
 * which inputs to plumb. Missing inputs default to 100 (no signal = no
 * penalty) so partial wiring doesn't artificially depress the score.
 *
 * Pure / deterministic.
 */

import type {
  RuntimeAnalytics,
  RuntimeForensicReport,
  RuntimeGovernanceScore,
  ShadowRunValidationResult,
  ShadowSoakReport,
  ThreadRuntimeObservability,
} from './threadRuntimeTypes';
import type { TraceConsistencyResult } from './runtimeTraceConsistencyGovernor';

function clamp100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export interface ComputeGovernanceScoreInput {
  /** Replay integrity from analytics + validation results. */
  analytics?: RuntimeAnalytics;
  validation?: ShadowRunValidationResult;
  /** Topology stability from a recent soak report. */
  soakReport?: ShadowSoakReport;
  /** Lifecycle closure from the consistency governor. */
  consistency?: TraceConsistencyResult;
  /** Transport reliability — pull from observability registry if available. */
  observability?: ThreadRuntimeObservability;
  /** Recovery quality from a recent forensic report. */
  forensics?: RuntimeForensicReport;
  /** Cross-instance continuity score from analytics (already 0..100). */
  crossInstanceContinuityScore?: number;
}

export function computeRuntimeGovernanceScore(input: ComputeGovernanceScoreInput): RuntimeGovernanceScore {
  // ── 1. replayIntegrity ─────────────────────────────────────────────
  let replayIntegrity = 100;
  if (input.analytics) replayIntegrity = input.analytics.replayIntegrityScore;
  if (input.validation) {
    if (!input.validation.replayConsistencyOk) replayIntegrity = Math.min(replayIntegrity, 60);
    if (input.validation.silentCorruptionFlags.length > 0) replayIntegrity = Math.min(replayIntegrity, 50);
  }
  replayIntegrity = clamp100(replayIntegrity);

  // ── 2. topologyStability ───────────────────────────────────────────
  let topologyStability = 100;
  if (input.soakReport) topologyStability = input.soakReport.topologyIntegrityScore;
  if (input.analytics) {
    // Topology instability score is INVERSE — high = worse.
    topologyStability = Math.min(topologyStability, clamp100(100 - input.analytics.topologyInstabilityScore));
  }
  if (input.forensics) {
    if (input.forensics.instabilityPattern !== 'none') {
      topologyStability = Math.min(topologyStability, 50);
    }
  }
  topologyStability = clamp100(topologyStability);

  // ── 3. lifecycleClosure ────────────────────────────────────────────
  let lifecycleClosure = 100;
  if (input.consistency) {
    const total = input.consistency.closedLifecycles + input.consistency.openLifecycles;
    if (total > 0) {
      lifecycleClosure = clamp100((input.consistency.closedLifecycles / total) * 100);
    }
    if (input.consistency.issues.length > 0) {
      lifecycleClosure = Math.min(lifecycleClosure, 70);
    }
  }
  if (input.analytics) {
    lifecycleClosure = Math.min(lifecycleClosure, clamp100(100 - input.analytics.lifecycleCorruptionRatePercent));
  }
  lifecycleClosure = clamp100(lifecycleClosure);

  // ── 4. transportReliability ────────────────────────────────────────
  let transportReliability = 100;
  if (input.analytics) {
    transportReliability = clamp100(100 - input.analytics.transportRetryRatePercent);
  }
  if (input.observability?.snapshotCoverageTrend === 'degrading') {
    transportReliability = Math.min(transportReliability, 70);
  }
  transportReliability = clamp100(transportReliability);

  // ── 5. recoveryQuality ─────────────────────────────────────────────
  let recoveryQuality = 100;
  if (input.analytics) recoveryQuality = input.analytics.recoverySuccessRatePercent;
  if (input.soakReport) {
    recoveryQuality = Math.min(recoveryQuality, input.soakReport.recoveryStabilityScore);
  }
  if (input.forensics && input.forensics.instabilityPattern === 'flapping') {
    recoveryQuality = Math.min(recoveryQuality, 50);
  }
  recoveryQuality = clamp100(recoveryQuality);

  // ── 6. distributedContinuity ───────────────────────────────────────
  let distributedContinuity = input.crossInstanceContinuityScore ?? 100;
  if (input.analytics) {
    distributedContinuity = Math.min(distributedContinuity, input.analytics.crossInstanceContinuityScore);
  }
  distributedContinuity = clamp100(distributedContinuity);

  // ── Composite + weakest component ──────────────────────────────────
  const components = {
    replayIntegrity,
    topologyStability,
    lifecycleClosure,
    transportReliability,
    recoveryQuality,
    distributedContinuity,
  };
  const weights = {
    replayIntegrity: 0.20,
    topologyStability: 0.20,
    lifecycleClosure: 0.15,
    transportReliability: 0.15,
    recoveryQuality: 0.15,
    distributedContinuity: 0.15,
  };
  const score = clamp100(
    components.replayIntegrity * weights.replayIntegrity
    + components.topologyStability * weights.topologyStability
    + components.lifecycleClosure * weights.lifecycleClosure
    + components.transportReliability * weights.transportReliability
    + components.recoveryQuality * weights.recoveryQuality
    + components.distributedContinuity * weights.distributedContinuity,
  );

  let weakestKey: keyof typeof components = 'replayIntegrity';
  for (const k of Object.keys(components) as Array<keyof typeof components>) {
    if (components[k] < components[weakestKey]) weakestKey = k;
  }

  const band: RuntimeGovernanceScore['band'] = score >= 80 ? 'healthy' : score >= 60 ? 'watch' : score >= 40 ? 'degraded' : 'critical';

  const recommendations: string[] = [];
  if (replayIntegrity < 80) recommendations.push('Replay integrity below 80 — inspect sessions with non-monotonic sequences.');
  if (topologyStability < 80) recommendations.push('Topology stability low — review recent snapshot diffs for orphan emergence.');
  if (lifecycleClosure < 80) recommendations.push('Lifecycle closure below threshold — chase dangling attempt/terminator pairs.');
  if (transportReliability < 80) recommendations.push('Transport retries elevated — check network / endpoint health.');
  if (recoveryQuality < 80) recommendations.push('Recovery quality low — recovery attempts not yielding success.');
  if (distributedContinuity < 80) recommendations.push('Cross-instance continuity degraded — sessions migrating between writers.');

  return { score, band, components, weakestComponent: weakestKey, recommendations };
}
