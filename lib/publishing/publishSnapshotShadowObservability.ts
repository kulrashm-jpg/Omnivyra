// Shadow Capture Observability
//
// Deterministic, non-mutating aggregation of shadow snapshot verifications
// into operator-readable summaries: verification, integrity, idempotency,
// isolation, immutability, risk, and advisory-gap summaries. No runtime
// mutation, no gating.

import type { ShadowSnapshotVerification } from './shadowPublishSnapshotVerification';
import type { IsolationVerification } from './publishSnapshotIsolationVerification';
import {
  worstVerificationStatus,
  type PublishVerificationStatus,
} from './publishVerificationStatus';

export interface ShadowObservabilitySummary {
  version: 'publish-snapshot-shadow-observability-v1';
  generatedAt: string;
  totalSnapshots: number;
  overallStatus: PublishVerificationStatus;
  verificationSummary: Record<PublishVerificationStatus, number>;
  integritySummary: { snapshotCorrect: number; contractCorrect: number; failed: number };
  idempotencySummary: { reproducible: number; nonReproducible: number };
  isolationSummary: { consistent: number; inconsistent: number; crossCompanyLeaks: number };
  immutabilitySummary: { immutable: number; mutated: number };
  riskSummary: readonly string[];
  advisoryGapSummary: readonly string[];
}

export function summarizeShadowVerifications(
  verifications: readonly ShadowSnapshotVerification[],
  crossCompanyIsolation: IsolationVerification,
): ShadowObservabilitySummary {
  const verificationSummary: Record<PublishVerificationStatus, number> = {
    verification_clean: 0,
    verification_warning: 0,
    verification_risk: 0,
    verification_invalid: 0,
  };
  let snapshotCorrect = 0;
  let contractCorrect = 0;
  let failed = 0;
  let reproducible = 0;
  let nonReproducible = 0;
  let consistent = 0;
  let inconsistent = 0;
  let immutable = 0;
  let mutated = 0;
  const risk = new Set<string>();
  const gaps = new Set<string>();

  for (const verification of verifications) {
    verificationSummary[verification.status] += 1;
    if (verification.checks.persistedSnapshotCorrect) {
      snapshotCorrect += 1;
      immutable += 1;
    } else {
      failed += 1;
      mutated += 1;
    }
    if (verification.checks.persistedContractCorrect) contractCorrect += 1;
    if (verification.checks.persistedIdempotencyCorrect) reproducible += 1;
    else nonReproducible += 1;
    if (verification.checks.persistedCompanyIsolationCorrect) consistent += 1;
    else inconsistent += 1;
    for (const finding of verification.findings) {
      if (finding.severity === 'invalid' || finding.severity === 'risk') risk.add(finding.message);
      if (finding.severity === 'warning') gaps.add(finding.message);
    }
  }

  for (const finding of crossCompanyIsolation.findings) {
    if (finding.severity === 'warning') gaps.add(finding.message);
    else risk.add(finding.message);
  }

  const statuses: PublishVerificationStatus[] = verifications.map((entry) => entry.status);
  if (!crossCompanyIsolation.consistent) statuses.push('verification_invalid');

  return {
    version: 'publish-snapshot-shadow-observability-v1',
    generatedAt: new Date(0).toISOString(),
    totalSnapshots: verifications.length,
    overallStatus: worstVerificationStatus(statuses.length > 0 ? statuses : ['verification_clean']),
    verificationSummary,
    integritySummary: { snapshotCorrect, contractCorrect, failed },
    idempotencySummary: { reproducible, nonReproducible },
    isolationSummary: { consistent, inconsistent, crossCompanyLeaks: crossCompanyIsolation.findings.length },
    immutabilitySummary: { immutable, mutated },
    riskSummary: [...risk].sort(),
    advisoryGapSummary: [...gaps].sort(),
  };
}

export function serializeShadowObservabilitySummary(summary: ShadowObservabilitySummary): string {
  return [
    '## PUBLISH SNAPSHOT SHADOW OBSERVABILITY',
    `Version: ${summary.version}`,
    `Total snapshots: ${summary.totalSnapshots}`,
    `Overall status: ${summary.overallStatus}`,
    `Clean/warning/risk/invalid: ${summary.verificationSummary.verification_clean}/${summary.verificationSummary.verification_warning}/${summary.verificationSummary.verification_risk}/${summary.verificationSummary.verification_invalid}`,
    `Integrity (snapshot/contract/failed): ${summary.integritySummary.snapshotCorrect}/${summary.integritySummary.contractCorrect}/${summary.integritySummary.failed}`,
    `Idempotency (reproducible/non): ${summary.idempotencySummary.reproducible}/${summary.idempotencySummary.nonReproducible}`,
    `Isolation (consistent/inconsistent/leaks): ${summary.isolationSummary.consistent}/${summary.isolationSummary.inconsistent}/${summary.isolationSummary.crossCompanyLeaks}`,
    `Immutability (immutable/mutated): ${summary.immutabilitySummary.immutable}/${summary.immutabilitySummary.mutated}`,
    `Risk summary: ${summary.riskSummary.join('; ') || 'none'}`,
    `Advisory gaps: ${summary.advisoryGapSummary.join('; ') || 'none'}`,
  ].join('\n');
}
