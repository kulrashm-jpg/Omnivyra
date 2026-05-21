import type { BehavioralAdherenceDiagnosticReport } from './behavioralAdherenceDiagnostics';
import type { EditorialRemediationHintReport, EditorialRemediationPriority } from './editorialRemediationHints';
import type {
  EditorialRemediationPlan,
  EditorialRecoveryStep,
  SectionEditorialRecoveryPlan,
} from './editorialRemediationPlanAssembler';
import type { EditorialQualityReadinessReport } from './editorialQualityReadiness';
import type { NarrativePlanningSection, NarrativeProgressionStage } from './narrativePlanningEngine';

export type RegenerationEligibility = 'eligible' | 'deferred' | 'not_recommended';
export type RegenerationReadiness = 'ready' | 'conditional' | 'blocked';
export type RegenerationConfidence = 'low' | 'medium' | 'high';
export type RewriteRisk = 'low' | 'medium' | 'high';

export interface SectionRewriteTarget {
  sectionIndex: number;
  progressionStage: NarrativeProgressionStage;
  narrativeRole: NarrativePlanningSection['narrativeRole'];
  eligibility: RegenerationEligibility;
  rewritePriority: EditorialRemediationPriority;
  rewriteTargets: readonly string[];
  rewriteBoundaries: readonly string[];
  preservationRequirements: readonly string[];
  sourceRisks: readonly string[];
}

export interface RegenerationReadinessContract {
  version: 'regeneration-readiness-contracts-v1';
  generatedAt: string;
  contentType: string;
  topic: string;
  overallRegenerationReadiness: RegenerationReadiness;
  regenerationEligibility: RegenerationEligibility;
  safeRecoveryBoundaries: readonly string[];
  rewriteRiskAssessment: {
    risk: RewriteRisk;
    reasons: readonly string[];
  };
  preservationConstraints: readonly string[];
  narrativePreservationRequirements: readonly string[];
  authorityPreservationRequirements: readonly string[];
  antiRepetitionRecoveryRequirements: readonly string[];
  sectionRewriteTargets: readonly SectionRewriteTarget[];
  sectionRewriteBoundaries: Record<string, readonly string[]>;
  sectionPreservationRequirements: Record<string, readonly string[]>;
  recoveryExecutionConstraints: readonly string[];
  regenerationPriority: EditorialRemediationPriority;
  regenerationConfidence: RegenerationConfidence;
}

export interface RegenerationReadinessContractInput {
  editorialRemediationPlan: EditorialRemediationPlan;
  editorialRemediationHints: EditorialRemediationHintReport;
  editorialQualityReadiness: EditorialQualityReadinessReport;
  behavioralAdherenceDiagnostics: BehavioralAdherenceDiagnosticReport;
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

function priorityRank(priority: EditorialRemediationPriority): number {
  const ranks: Record<EditorialRemediationPriority, number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
  };
  return ranks[priority];
}

function maxPriority(steps: readonly EditorialRecoveryStep[]): EditorialRemediationPriority {
  return steps.reduce((highest, step) => (
    priorityRank(step.priority) > priorityRank(highest) ? step.priority : highest
  ), 'low' as EditorialRemediationPriority);
}

function eligibilityFor(priority: EditorialRemediationPriority, riskCount: number): RegenerationEligibility {
  if (priority === 'critical' || priority === 'high') return 'eligible';
  if (priority === 'medium' || riskCount > 0) return 'deferred';
  return 'not_recommended';
}

function boundaryForTarget(target: string): string {
  const lower = target.toLowerCase();
  if (lower.includes('anti-repetition') || lower.includes('section differentiation')) {
    return 'adjust repeated structure and section responsibility without changing the core topic';
  }
  if (lower.includes('narrative')) return 'preserve progression stage while correcting section movement';
  if (lower.includes('authority') || lower.includes('proof')) return 'add or qualify proof behavior without inventing unverifiable evidence';
  if (lower.includes('audience')) return 'calibrate sophistication without broadening the intended reader';
  if (lower.includes('operational')) return 'add workflow realism without changing product or company claims';
  if (lower.includes('strategic')) return 'strengthen POV without replacing company positioning';
  if (lower.includes('transition') || lower.includes('reader')) return 'improve handoff logic without reordering unrelated sections';
  return 'limit changes to the targeted editorial behavior';
}

function preservationForSection(section: SectionEditorialRecoveryPlan): string[] {
  return unique([
    `preserve progression stage: ${section.progressionStage}`,
    `preserve narrative role: ${section.narrativeRole}`,
    'preserve company-conditioned positioning',
    'preserve section-specific recovery targets',
    ...section.recoveryTargets.map((target) => `preserve recovery intent for ${target}`),
  ], 8);
}

function rewriteRisk(input: RegenerationReadinessContractInput): { risk: RewriteRisk; reasons: readonly string[] } {
  const criticalTargets = input.editorialRemediationPlan.criticalRecoveryTargets.length;
  const sectionTargets = input.editorialRemediationPlan.sectionRecoveryPlans.length;
  const behavioralRisk = input.behavioralAdherenceDiagnostics.alignmentSummary.overallRisk;
  if (criticalTargets > 4 || behavioralRisk === 'high') {
    return {
      risk: 'high',
      reasons: unique(['multiple critical recovery targets', `behavioral risk: ${behavioralRisk}`]),
    };
  }
  if (criticalTargets > 0 || sectionTargets > 3) {
    return {
      risk: 'medium',
      reasons: unique(['critical recovery targets present', `section targets: ${sectionTargets}`]),
    };
  }
  return {
    risk: 'low',
    reasons: unique(['limited recovery scope', `section targets: ${sectionTargets}`]),
  };
}

export function buildRegenerationReadinessContract(
  input: RegenerationReadinessContractInput,
): RegenerationReadinessContract {
  const plan = input.editorialRemediationPlan;
  const riskAssessment = rewriteRisk(input);
  const regenerationPriority = maxPriority(plan.remediationExecutionOrder);
  const regenerationEligibility = eligibilityFor(regenerationPriority, plan.criticalRecoveryTargets.length);
  const sectionRewriteTargets = plan.sectionRecoveryPlans.map((section): SectionRewriteTarget => ({
    sectionIndex: section.sectionIndex,
    progressionStage: section.progressionStage,
    narrativeRole: section.narrativeRole,
    eligibility: eligibilityFor(section.recoveryPriority, section.sourceRisks.length),
    rewritePriority: section.recoveryPriority,
    rewriteTargets: section.recoveryTargets,
    rewriteBoundaries: unique(section.recoveryTargets.map(boundaryForTarget), 8),
    preservationRequirements: preservationForSection(section),
    sourceRisks: section.sourceRisks,
  }));

  const sectionRewriteBoundaries = Object.fromEntries(sectionRewriteTargets.map((section) => [
    String(section.sectionIndex),
    section.rewriteBoundaries,
  ]));
  const sectionPreservationRequirements = Object.fromEntries(sectionRewriteTargets.map((section) => [
    String(section.sectionIndex),
    section.preservationRequirements,
  ]));

  const overallRegenerationReadiness: RegenerationReadiness = regenerationEligibility === 'not_recommended'
    ? 'ready'
    : riskAssessment.risk === 'high'
      ? 'blocked'
      : 'conditional';

  return {
    version: 'regeneration-readiness-contracts-v1',
    generatedAt: new Date(0).toISOString(),
    contentType: plan.contentType,
    topic: plan.topic,
    overallRegenerationReadiness,
    regenerationEligibility,
    safeRecoveryBoundaries: unique([
      'use remediation plan ordering as the only recovery sequence',
      'target only sections listed in sectionRewriteTargets',
      'preserve original topic, content type, and company context',
      'do not introduce unverifiable evidence or new claims',
      ...plan.overallRemediationStrategy,
    ], 10),
    rewriteRiskAssessment: riskAssessment,
    preservationConstraints: unique([
      'preserve narrative progression order',
      'preserve authority and audience calibration',
      'preserve section differentiation and anti-repetition constraints',
      'preserve readiness and remediation metadata as advisory context',
      `overall readiness tier: ${input.editorialQualityReadiness.overallReadinessTier}`,
    ], 10),
    narrativePreservationRequirements: unique([
      'maintain diagnose/reframe/expand/operationalize/validate/resolve ordering',
      ...plan.narrativeRecoveryPlan.recoverySteps.flatMap((step) => step.recoverySignals),
    ], 8),
    authorityPreservationRequirements: unique([
      'do not invent citations, metrics, or proof',
      'preserve claim qualification and evidence boundaries',
      ...plan.authorityRecoveryPlan.recoverySteps.flatMap((step) => step.recoverySignals),
    ], 8),
    antiRepetitionRecoveryRequirements: unique([
      'do not reuse opening shapes or repeated framework loops',
      'preserve distinct section responsibilities',
      ...plan.antiRepetitionRecoveryPlan.recoverySteps.flatMap((step) => step.recoverySignals),
    ], 8),
    sectionRewriteTargets,
    sectionRewriteBoundaries,
    sectionPreservationRequirements,
    recoveryExecutionConstraints: unique([
      'non-executing contract only',
      'future recovery must not run without explicit executor support',
      'future recovery must keep scoring and validation side-effect free unless separately enabled',
      ...plan.remediationExecutionOrder.slice(0, 6).map((step) => `${step.order}. ${step.targetDimension}: ${step.recoveryIntent}`),
    ], 12),
    regenerationPriority,
    regenerationConfidence: plan.recoveryConfidence,
  };
}

export function serializeRegenerationReadinessContract(contract: RegenerationReadinessContract): string {
  return [
    '## REGENERATION READINESS CONTRACTS',
    `Version: ${contract.version}`,
    `Topic: ${contract.topic}`,
    `Content type: ${contract.contentType}`,
    `Overall readiness: ${contract.overallRegenerationReadiness}`,
    `Eligibility: ${contract.regenerationEligibility}`,
    `Priority: ${contract.regenerationPriority}`,
    `Confidence: ${contract.regenerationConfidence}`,
    `Rewrite risk: ${contract.rewriteRiskAssessment.risk}`,
    `Section rewrite targets: ${contract.sectionRewriteTargets.length}`,
  ].join('\n');
}
