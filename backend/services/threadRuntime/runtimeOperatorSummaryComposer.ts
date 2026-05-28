/**
 * Phase 8 — Runtime operator summary composer.
 *
 * Condenses outputs from phases 2–7 into a single `RuntimeOperatorSummary`
 * that an operator can scan without tailing raw logs.
 *
 * Goal: replace the manual log-tailing soak validation we ran live in this
 * session with a single record per thread that surfaces what an operator
 * actually needs to act on.
 */

import type {
  RecoveryTrace,
  RuntimeFailureSummary,
  RuntimeOperatorSummary,
  ShadowRunValidationResult,
  ShadowSoakReport,
  ThreadTopologySnapshot,
} from './threadRuntimeTypes';

function clamp100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export interface ComposeOperatorSummaryInput {
  threadId: string;
  latestSnapshot: ThreadTopologySnapshot | null;
  soakReport: ShadowSoakReport | null;
  validationResult: ShadowRunValidationResult | null;
  failureSummaries: RuntimeFailureSummary[];
  recoveryTraces: RecoveryTrace[];
}

export function composeRuntimeOperatorSummary(input: ComposeOperatorSummaryInput): RuntimeOperatorSummary {
  const snap = input.latestSnapshot;
  const soak = input.soakReport;
  const validation = input.validationResult;
  const failures = input.failureSummaries;
  const recoveries = input.recoveryTraces;

  const topologyVerified = !!validation
    && validation.validationPassed
    && (snap ? snap.topologyIntegrityScore >= 80 : true);

  const orphanRiskScore = soak ? soak.orphanRiskScore : clamp100((snap?.orphanNodeIds.length ?? 0) * 25);

  // persistence integrity: prefer soak.persistenceConsistencyScore; fall back to validation
  let persistenceIntegrityScore = soak?.persistenceConsistencyScore ?? 100;
  if (validation && (validation.partialPersistenceFlags.length > 0)) {
    persistenceIntegrityScore = clamp100(persistenceIntegrityScore - validation.partialPersistenceFlags.length * 20);
  }

  // runtime instability flags
  const runtimeInstabilityFlags: string[] = [];
  for (const f of failures) {
    runtimeInstabilityFlags.push(`${f.failureType} (${f.failureSeverity}) — ${f.probableRootCause}`);
  }
  if (validation) {
    runtimeInstabilityFlags.push(...validation.silentCorruptionFlags);
    runtimeInstabilityFlags.push(...validation.unstableJoinFlags);
  }

  // recovery quality
  let recoveryQualityScore = 100;
  if (recoveries.length > 0) {
    recoveryQualityScore = Math.round(
      recoveries.reduce((s, r) => s + r.recoveryConfidenceScore, 0) / recoveries.length,
    );
  } else if (failures.some((f) => f.failureSeverity === 'high' || f.failureSeverity === 'critical')) {
    // Severe failures with no recovery trace = low quality
    recoveryQualityScore = 30;
  }

  // unresolved warnings
  const unresolvedWarnings: string[] = [];
  if (soak) unresolvedWarnings.push(...soak.warnings);
  if (validation) unresolvedWarnings.push(...validation.hiddenOrphanFlags);
  if (validation) unresolvedWarnings.push(...validation.partialPersistenceFlags);

  // One-line summary
  const sevOrder = { low: 1, medium: 2, high: 3, critical: 4 } as const;
  const worstFailure = failures.length === 0 ? null
    : failures.reduce((a, b) => (sevOrder[a.failureSeverity] >= sevOrder[b.failureSeverity] ? a : b));
  const oneLineParts: string[] = [];
  oneLineParts.push(`thread=${input.threadId}`);
  if (snap) oneLineParts.push(`nodes=${snap.nodes.length}`);
  if (snap) oneLineParts.push(`integrity=${snap.topologyIntegrityScore}/100`);
  oneLineParts.push(`topology=${topologyVerified ? 'OK' : 'FAIL'}`);
  oneLineParts.push(`orphan_risk=${orphanRiskScore}/100`);
  oneLineParts.push(`persist=${persistenceIntegrityScore}/100`);
  oneLineParts.push(`recovery=${recoveryQualityScore}/100`);
  if (worstFailure) oneLineParts.push(`worst=${worstFailure.failureType}(${worstFailure.failureSeverity})`);
  if (unresolvedWarnings.length > 0) oneLineParts.push(`warnings=${unresolvedWarnings.length}`);
  const oneLine = oneLineParts.join(' · ');

  return {
    threadId: input.threadId,
    topologyVerified,
    orphanRiskScore,
    persistenceIntegrityScore: clamp100(persistenceIntegrityScore),
    runtimeInstabilityFlags,
    recoveryQualityScore: clamp100(recoveryQualityScore),
    unresolvedWarnings,
    oneLine,
  };
}
