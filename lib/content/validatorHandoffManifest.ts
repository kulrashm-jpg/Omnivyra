import type { ValidatorAuditTrail } from './validatorAuditTrail';
import type { ValidatorCoverageLedger } from './validatorCoverageLedger';
import type { ValidatorHandoffReadiness, SectionHandoffReadiness } from './validatorHandoffReadiness';
import type { ValidatorReviewSnapshot } from './validatorReviewSnapshotAssembler';
import type { NarrativePlanningSection, NarrativeProgressionStage } from './narrativePlanningEngine';

export type ValidatorHandoffManifestReadiness = 'ready' | 'conditional' | 'blocked';
export type ValidatorHandoffManifestConfidence = 'low' | 'medium' | 'high';

export interface SectionHandoffPayload {
  sectionIndex: number;
  progressionStage: NarrativeProgressionStage;
  narrativeRole: NarrativePlanningSection['narrativeRole'];
  handoffEligibility: SectionHandoffReadiness['handoffEligibility'];
  handoffPayload: readonly string[];
  boundaryRequirements: readonly string[];
  preservationRequirements: readonly string[];
  dependencyRequirements: readonly string[];
  reviewRequirements: readonly string[];
}

export interface ValidatorHandoffManifest {
  version: 'validator-handoff-manifest-v1';
  generatedAt: string;
  contentType: string;
  topic: string;
  overallHandoffManifestReadiness: ValidatorHandoffManifestReadiness;
  handoffExecutionPayload: readonly string[];
  handoffBoundaryRequirements: readonly string[];
  handoffPreservationRequirements: readonly string[];
  handoffDependencyRequirements: readonly string[];
  handoffReviewRequirements: readonly string[];
  sectionHandoffPayloads: readonly SectionHandoffPayload[];
  handoffManifestRiskProfile: {
    lowRisk: number;
    mediumRisk: number;
    highRisk: number;
    gaps: number;
    deferred: number;
  };
  handoffManifestConfidence: ValidatorHandoffManifestConfidence;
}

export interface ValidatorHandoffManifestInput {
  validatorHandoffReadiness: ValidatorHandoffReadiness;
  validatorDecisionTrace: import('./validatorDecisionTrace').ValidatorDecisionTrace;
  validatorCoverageLedger: ValidatorCoverageLedger;
  validatorReviewSnapshot: ValidatorReviewSnapshot;
  validatorAuditTrail: ValidatorAuditTrail;
}

function unique(values: readonly string[], limit = 18): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const raw of values) {
    const value = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    output.push(value);
    if (output.length >= limit) break;
  }
  return output;
}

function readiness(input: ValidatorHandoffManifestInput): ValidatorHandoffManifestReadiness {
  if (
    input.validatorHandoffReadiness.overallHandoffReadiness === 'blocked'
    || input.validatorCoverageLedger.overallCoverageLedgerReadiness === 'blocked'
  ) return 'blocked';
  if (
    input.validatorHandoffReadiness.overallHandoffReadiness === 'conditional'
    || input.validatorCoverageLedger.overallCoverageLedgerReadiness === 'conditional'
  ) return 'conditional';
  return 'ready';
}

function confidence(readinessValue: ValidatorHandoffManifestReadiness, input: ValidatorHandoffManifestInput): ValidatorHandoffManifestConfidence {
  if (
    readinessValue === 'ready'
    && input.validatorHandoffReadiness.handoffConfidence === 'high'
    && input.validatorCoverageLedger.coverageLedgerConfidence === 'high'
  ) return 'high';
  if (
    readinessValue === 'blocked'
    || input.validatorHandoffReadiness.handoffConfidence === 'low'
    || input.validatorCoverageLedger.coverageLedgerConfidence === 'low'
  ) return 'low';
  return 'medium';
}

function sectionPayload(section: SectionHandoffReadiness): SectionHandoffPayload {
  return {
    sectionIndex: section.sectionIndex,
    progressionStage: section.progressionStage,
    narrativeRole: section.narrativeRole,
    handoffEligibility: section.handoffEligibility,
    handoffPayload: unique([
      `handoff section ${section.sectionIndex}`,
      `handoff eligibility: ${section.handoffEligibility}`,
    ], 8),
    boundaryRequirements: unique(section.boundarySignals, 10),
    preservationRequirements: unique(section.preservationSignals, 10),
    dependencyRequirements: unique(section.dependencySignals, 10),
    reviewRequirements: unique([
      'future validator must remain non-mutating until execution layer is explicitly enabled',
      ...section.riskSignals,
    ], 10),
  };
}

export function buildValidatorHandoffManifest(input: ValidatorHandoffManifestInput): ValidatorHandoffManifest {
  const overallHandoffManifestReadiness = readiness(input);
  const sectionHandoffPayloads = input.validatorHandoffReadiness.sectionHandoffReadiness.map(sectionPayload);

  return {
    version: 'validator-handoff-manifest-v1',
    generatedAt: new Date(0).toISOString(),
    contentType: input.validatorHandoffReadiness.contentType,
    topic: input.validatorHandoffReadiness.topic,
    overallHandoffManifestReadiness,
    handoffExecutionPayload: unique([
      'validator handoff package is non-executing',
      ...input.validatorReviewSnapshot.reviewSnapshots,
      ...input.validatorAuditTrail.auditEventSequence,
    ], 18),
    handoffBoundaryRequirements: unique([
      ...input.validatorHandoffReadiness.handoffBoundarySignals,
      ...input.validatorCoverageLedger.boundaryCoverageLedger,
    ], 18),
    handoffPreservationRequirements: unique([
      ...input.validatorHandoffReadiness.handoffPreservationSignals,
      ...input.validatorCoverageLedger.preservationCoverageLedger,
    ], 18),
    handoffDependencyRequirements: unique(input.validatorHandoffReadiness.handoffDependencySignals, 18),
    handoffReviewRequirements: unique([
      ...input.validatorDecisionTrace.decisionTraceSequence,
      ...input.validatorCoverageLedger.coverageLedgerEntries,
    ], 18),
    sectionHandoffPayloads,
    handoffManifestRiskProfile: {
      lowRisk: input.validatorCoverageLedger.coverageLedgerRiskProfile.lowRisk,
      mediumRisk: input.validatorCoverageLedger.coverageLedgerRiskProfile.mediumRisk,
      highRisk: input.validatorCoverageLedger.coverageLedgerRiskProfile.highRisk,
      gaps: input.validatorCoverageLedger.coverageLedgerRiskProfile.gaps,
      deferred: input.validatorCoverageLedger.coverageLedgerRiskProfile.deferred,
    },
    handoffManifestConfidence: confidence(overallHandoffManifestReadiness, input),
  };
}

export function serializeValidatorHandoffManifest(manifest: ValidatorHandoffManifest): string {
  return [
    '## VALIDATOR HANDOFF MANIFEST',
    `Version: ${manifest.version}`,
    `Topic: ${manifest.topic}`,
    `Content type: ${manifest.contentType}`,
    `Manifest readiness: ${manifest.overallHandoffManifestReadiness}`,
    `Manifest confidence: ${manifest.handoffManifestConfidence}`,
    `Section payloads: ${manifest.sectionHandoffPayloads.length}`,
    `Boundary requirements: ${manifest.handoffBoundaryRequirements.length}`,
    `Preservation requirements: ${manifest.handoffPreservationRequirements.length}`,
  ].join('\n');
}
