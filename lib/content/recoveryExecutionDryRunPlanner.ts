import type { EditorialRemediationPlan } from './editorialRemediationPlanAssembler';
import type {
  RegenerationCandidateSelection,
  SectionRecoveryCandidate,
} from './regenerationCandidateSelector';
import type {
  RegenerationExecutionManifest,
  SectionRegenerationExecutionManifest,
} from './regenerationExecutionManifest';
import type { RegenerationReadinessContract } from './regenerationReadinessContracts';
import type { NarrativePlanningSection, NarrativeProgressionStage } from './narrativePlanningEngine';

export type RecoveryDryRunReadiness = 'ready' | 'conditional' | 'blocked';
export type RecoveryDryRunConfidence = 'low' | 'medium' | 'high';
export type RecoveryDryRunRisk = 'low' | 'medium' | 'high';

export interface SectionRecoveryDryRunPlan {
  sectionIndex: number;
  progressionStage: NarrativeProgressionStage;
  narrativeRole: NarrativePlanningSection['narrativeRole'];
  simulatedExecutionReadiness: RecoveryDryRunReadiness;
  simulatedRisk: RecoveryDryRunRisk;
  recoveryTargets: readonly string[];
  preservationChecks: readonly string[];
  dependencyChecks: readonly string[];
  conflictSignals: readonly string[];
}

export interface RecoveryExecutionDryRunPlan {
  version: 'recovery-execution-dry-run-v1';
  generatedAt: string;
  contentType: string;
  topic: string;
  overallDryRunReadiness: RecoveryDryRunReadiness;
  dryRunExecutionOrder: readonly number[];
  dryRunRecoveryTargets: readonly string[];
  simulatedSafeExecutions: readonly number[];
  simulatedDeferredExecutions: readonly number[];
  simulatedConflictRisks: readonly string[];
  preservationConflictSignals: readonly string[];
  rewriteDependencySignals: readonly string[];
  narrativeStabilitySignals: readonly string[];
  authorityStabilitySignals: readonly string[];
  antiRepetitionStabilitySignals: readonly string[];
  sectionDryRunPlans: readonly SectionRecoveryDryRunPlan[];
  dryRunRiskProfile: {
    lowRisk: number;
    mediumRisk: number;
    highRisk: number;
    conflicts: number;
    deferred: number;
  };
  dryRunConfidence: RecoveryDryRunConfidence;
}

export interface RecoveryExecutionDryRunInput {
  regenerationExecutionManifest: RegenerationExecutionManifest;
  regenerationCandidateSelection: RegenerationCandidateSelection;
  regenerationReadinessContract: RegenerationReadinessContract;
  editorialRemediationPlan: EditorialRemediationPlan;
}

function unique(values: readonly string[], limit = 12): string[] {
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

function candidateForSection(input: RecoveryExecutionDryRunInput, sectionIndex: number): SectionRecoveryCandidate | undefined {
  return input.regenerationCandidateSelection.sectionRecoveryCandidates.find((candidate) => candidate.sectionIndex === sectionIndex);
}

function conflictSignalsFor(
  input: RecoveryExecutionDryRunInput,
  manifest: SectionRegenerationExecutionManifest,
): string[] {
  const candidate = candidateForSection(input, manifest.sectionIndex);
  const signals: string[] = [];
  if (manifest.rewriteBoundaries.length === 0) signals.push('missing rewrite boundary');
  if (manifest.preservationRequirements.length === 0) signals.push('missing preservation requirements');
  if (candidate?.risk === 'high') signals.push('candidate marked high risk');
  if (candidate?.eligibility !== 'eligible') signals.push('candidate not eligible for execution');
  if (
    manifest.recoveryTargets.some((target) => /narrative|reader|transition/i.test(target))
    && input.regenerationReadinessContract.overallRegenerationReadiness === 'blocked'
  ) signals.push('narrative-affecting rewrite under blocked readiness');
  return unique(signals, 8);
}

function dependencyChecksFor(input: RecoveryExecutionDryRunInput, manifest: SectionRegenerationExecutionManifest): string[] {
  const sectionOrder = input.regenerationExecutionManifest.manifestExecutionOrder.indexOf(manifest.sectionIndex);
  return unique([
    `execution order index: ${sectionOrder}`,
    `preserve progression stage: ${manifest.progressionStage}`,
    ...input.editorialRemediationPlan.remediationExecutionOrder
      .filter((step) => step.sectionsAffected.includes(manifest.sectionIndex))
      .slice(0, 4)
      .map((step) => `${step.order}. ${step.targetDimension}`),
  ], 8);
}

function dryRunRisk(candidate: SectionRecoveryCandidate | undefined, conflicts: readonly string[]): RecoveryDryRunRisk {
  if (conflicts.length > 1 || candidate?.risk === 'high') return 'high';
  if (conflicts.length > 0 || candidate?.risk === 'medium') return 'medium';
  return 'low';
}

function dryRunReadiness(risk: RecoveryDryRunRisk, manifest: SectionRegenerationExecutionManifest): RecoveryDryRunReadiness {
  if (manifest.executionReadiness === 'deferred' || risk === 'high') return 'blocked';
  if (manifest.executionReadiness === 'conditional' || risk === 'medium') return 'conditional';
  return 'ready';
}

function sectionDryRunPlan(
  input: RecoveryExecutionDryRunInput,
  manifest: SectionRegenerationExecutionManifest,
): SectionRecoveryDryRunPlan {
  const candidate = candidateForSection(input, manifest.sectionIndex);
  const conflictSignals = conflictSignalsFor(input, manifest);
  const simulatedRisk = dryRunRisk(candidate, conflictSignals);
  return {
    sectionIndex: manifest.sectionIndex,
    progressionStage: manifest.progressionStage,
    narrativeRole: manifest.narrativeRole,
    simulatedExecutionReadiness: dryRunReadiness(simulatedRisk, manifest),
    simulatedRisk,
    recoveryTargets: manifest.recoveryTargets,
    preservationChecks: unique([
      ...manifest.preservationRequirements,
      ...(input.regenerationExecutionManifest.preservationConstraintMap[String(manifest.sectionIndex)] || []),
    ], 10),
    dependencyChecks: dependencyChecksFor(input, manifest),
    conflictSignals,
  };
}

function confidence(input: RecoveryExecutionDryRunInput, conflicts: readonly string[]): RecoveryDryRunConfidence {
  if (conflicts.length === 0 && input.regenerationExecutionManifest.executionConfidence === 'high') return 'high';
  if (input.regenerationExecutionManifest.executionConfidence === 'low' || conflicts.length > 3) return 'low';
  return 'medium';
}

export function planRecoveryExecutionDryRun(input: RecoveryExecutionDryRunInput): RecoveryExecutionDryRunPlan {
  const sectionDryRunPlans = input.regenerationExecutionManifest.sectionExecutionManifests.map((manifest) => sectionDryRunPlan(input, manifest));
  const simulatedConflictRisks = unique(sectionDryRunPlans.flatMap((section) => section.conflictSignals), 16);
  const dryRunConfidence = confidence(input, simulatedConflictRisks);
  const simulatedSafeExecutions = sectionDryRunPlans
    .filter((section) => section.simulatedExecutionReadiness === 'ready')
    .map((section) => section.sectionIndex);
  const simulatedDeferredExecutions = unique([
    ...input.regenerationExecutionManifest.deferredExecutionCandidates.map(String),
    ...sectionDryRunPlans
      .filter((section) => section.simulatedExecutionReadiness === 'blocked')
      .map((section) => String(section.sectionIndex)),
  ]).map(Number);
  const overallDryRunReadiness: RecoveryDryRunReadiness = sectionDryRunPlans.length === 0
    ? 'blocked'
    : simulatedConflictRisks.length > 3
      ? 'blocked'
      : dryRunConfidence === 'high'
        ? 'ready'
        : 'conditional';

  return {
    version: 'recovery-execution-dry-run-v1',
    generatedAt: new Date(0).toISOString(),
    contentType: input.regenerationExecutionManifest.contentType,
    topic: input.regenerationExecutionManifest.topic,
    overallDryRunReadiness,
    dryRunExecutionOrder: input.regenerationExecutionManifest.manifestExecutionOrder,
    dryRunRecoveryTargets: input.regenerationExecutionManifest.manifestRecoveryTargets,
    simulatedSafeExecutions,
    simulatedDeferredExecutions,
    simulatedConflictRisks,
    preservationConflictSignals: unique([
      ...simulatedConflictRisks.filter((signal) => /preservation|boundary/i.test(signal)),
      ...input.regenerationReadinessContract.preservationConstraints.slice(0, 4),
    ], 10),
    rewriteDependencySignals: unique([
      ...input.editorialRemediationPlan.remediationExecutionOrder.slice(0, 8).map((step) => `${step.order}. ${step.targetDimension}`),
      ...sectionDryRunPlans.flatMap((section) => section.dependencyChecks),
    ], 12),
    narrativeStabilitySignals: unique([
      ...input.regenerationReadinessContract.narrativePreservationRequirements,
      ...Object.values(input.regenerationExecutionManifest.narrativePreservationMap).flat(),
    ], 10),
    authorityStabilitySignals: unique([
      ...input.regenerationReadinessContract.authorityPreservationRequirements,
      ...Object.values(input.regenerationExecutionManifest.authorityPreservationMap).flat(),
    ], 10),
    antiRepetitionStabilitySignals: unique([
      ...input.regenerationReadinessContract.antiRepetitionRecoveryRequirements,
      ...Object.values(input.regenerationExecutionManifest.antiRepetitionPreservationMap).flat(),
    ], 10),
    sectionDryRunPlans,
    dryRunRiskProfile: {
      lowRisk: sectionDryRunPlans.filter((section) => section.simulatedRisk === 'low').length,
      mediumRisk: sectionDryRunPlans.filter((section) => section.simulatedRisk === 'medium').length,
      highRisk: sectionDryRunPlans.filter((section) => section.simulatedRisk === 'high').length,
      conflicts: simulatedConflictRisks.length,
      deferred: simulatedDeferredExecutions.length,
    },
    dryRunConfidence,
  };
}

export function serializeRecoveryExecutionDryRun(plan: RecoveryExecutionDryRunPlan): string {
  return [
    '## RECOVERY EXECUTION DRY RUN',
    `Version: ${plan.version}`,
    `Topic: ${plan.topic}`,
    `Content type: ${plan.contentType}`,
    `Dry-run readiness: ${plan.overallDryRunReadiness}`,
    `Dry-run confidence: ${plan.dryRunConfidence}`,
    `Execution order: ${plan.dryRunExecutionOrder.join(', ') || 'none'}`,
    `Safe simulated executions: ${plan.simulatedSafeExecutions.length}`,
    `Deferred simulated executions: ${plan.simulatedDeferredExecutions.length}`,
    `Conflict risks: ${plan.simulatedConflictRisks.join('; ') || 'none'}`,
  ].join('\n');
}
