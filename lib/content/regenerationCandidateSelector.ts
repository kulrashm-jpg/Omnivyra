import type { BehavioralAdherenceDiagnosticReport } from './behavioralAdherenceDiagnostics';
import type { EditorialRemediationPriority } from './editorialRemediationHints';
import type { EditorialRemediationPlan } from './editorialRemediationPlanAssembler';
import type { EditorialQualityReadinessReport } from './editorialQualityReadiness';
import type {
  RegenerationEligibility,
  RegenerationReadinessContract,
  SectionRewriteTarget,
} from './regenerationReadinessContracts';
import type { NarrativePlanningSection, NarrativeProgressionStage } from './narrativePlanningEngine';

export type RegenerationCandidateConfidence = 'low' | 'medium' | 'high';
export type RegenerationCandidateRisk = 'low' | 'medium' | 'high';

export interface SectionRecoveryCandidate {
  sectionIndex: number;
  progressionStage: NarrativeProgressionStage;
  narrativeRole: NarrativePlanningSection['narrativeRole'];
  eligibility: RegenerationEligibility;
  priority: EditorialRemediationPriority;
  confidence: RegenerationCandidateConfidence;
  risk: RegenerationCandidateRisk;
  recoveryTargets: readonly string[];
  rewriteBoundaries: readonly string[];
  preservationRequirements: readonly string[];
  selectionReason: string;
}

export interface RegenerationCandidateSelection {
  version: 'regeneration-candidate-selection-v1';
  generatedAt: string;
  contentType: string;
  topic: string;
  overallRecoveryEligibility: RegenerationEligibility;
  recommendedRecoveryTargets: readonly string[];
  safeRewriteCandidates: readonly SectionRecoveryCandidate[];
  highRiskRewriteCandidates: readonly SectionRecoveryCandidate[];
  rewriteDeferralCandidates: readonly SectionRecoveryCandidate[];
  candidatePriorityMap: Record<string, EditorialRemediationPriority>;
  candidateConfidenceMap: Record<string, RegenerationCandidateConfidence>;
  candidateExecutionOrder: readonly SectionRecoveryCandidate[];
  narrativeSafeRecoveryCandidates: readonly SectionRecoveryCandidate[];
  authoritySafeRecoveryCandidates: readonly SectionRecoveryCandidate[];
  antiRepetitionRecoveryCandidates: readonly SectionRecoveryCandidate[];
  sectionRecoveryCandidates: readonly SectionRecoveryCandidate[];
  recoveryRiskBalance: {
    lowRisk: number;
    mediumRisk: number;
    highRisk: number;
    deferred: number;
  };
}

export interface RegenerationCandidateSelectionInput {
  regenerationReadinessContract: RegenerationReadinessContract;
  editorialRemediationPlan: EditorialRemediationPlan;
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

function targetHas(targets: readonly string[], pattern: RegExp): boolean {
  return targets.some((target) => pattern.test(target));
}

function candidateRisk(target: SectionRewriteTarget, input: RegenerationCandidateSelectionInput): RegenerationCandidateRisk {
  const narrativeHeavy = target.progressionStage === 'diagnose' || target.progressionStage === 'reframe';
  const highRiskContract = input.regenerationReadinessContract.rewriteRiskAssessment.risk === 'high';
  const hasNarrativeRewrite = targetHas(target.rewriteTargets, /narrative|strategic|reader/i);
  if (highRiskContract && (narrativeHeavy || hasNarrativeRewrite)) return 'high';
  if (target.sourceRisks.length > 8 || target.rewritePriority === 'critical') return 'medium';
  if (target.eligibility === 'deferred') return 'medium';
  return 'low';
}

function candidateConfidence(target: SectionRewriteTarget, risk: RegenerationCandidateRisk, input: RegenerationCandidateSelectionInput): RegenerationCandidateConfidence {
  if (
    risk === 'low'
    && input.regenerationReadinessContract.regenerationConfidence === 'high'
    && input.behavioralAdherenceDiagnostics.alignmentSummary.confidence !== 'low'
  ) return 'high';
  if (risk === 'high' || input.regenerationReadinessContract.regenerationConfidence === 'low') return 'low';
  return 'medium';
}

function selectionReason(target: SectionRewriteTarget, risk: RegenerationCandidateRisk): string {
  if (target.eligibility === 'deferred') return 'deferred by regeneration readiness contract';
  if (risk === 'high') return 'high rewrite risk requires future executor safeguards';
  if (targetHas(target.rewriteTargets, /anti-repetition|section differentiation/i)) return 'safe structural recovery target';
  if (targetHas(target.rewriteTargets, /authority|proof/i)) return 'bounded authority recovery target';
  return 'eligible bounded section recovery target';
}

function toCandidate(target: SectionRewriteTarget, input: RegenerationCandidateSelectionInput): SectionRecoveryCandidate {
  const risk = candidateRisk(target, input);
  return {
    sectionIndex: target.sectionIndex,
    progressionStage: target.progressionStage,
    narrativeRole: target.narrativeRole,
    eligibility: target.eligibility,
    priority: target.rewritePriority,
    confidence: candidateConfidence(target, risk, input),
    risk,
    recoveryTargets: target.rewriteTargets,
    rewriteBoundaries: target.rewriteBoundaries,
    preservationRequirements: target.preservationRequirements,
    selectionReason: selectionReason(target, risk),
  };
}

function executionOrder(candidates: readonly SectionRecoveryCandidate[]): SectionRecoveryCandidate[] {
  return candidates
    .slice()
    .sort((a, b) => {
      const priorityDelta = priorityRank(b.priority) - priorityRank(a.priority);
      if (priorityDelta !== 0) return priorityDelta;
      const riskDelta = riskRank(a.risk) - riskRank(b.risk);
      if (riskDelta !== 0) return riskDelta;
      return a.sectionIndex - b.sectionIndex;
    });
}

function riskRank(risk: RegenerationCandidateRisk): number {
  return risk === 'high' ? 3 : risk === 'medium' ? 2 : 1;
}

export function selectRegenerationCandidates(input: RegenerationCandidateSelectionInput): RegenerationCandidateSelection {
  const sectionRecoveryCandidates = input.regenerationReadinessContract.sectionRewriteTargets.map((target) => toCandidate(target, input));
  const safeRewriteCandidates = sectionRecoveryCandidates.filter((candidate) => (
    candidate.eligibility === 'eligible'
    && candidate.risk === 'low'
    && candidate.confidence !== 'low'
  ));
  const highRiskRewriteCandidates = sectionRecoveryCandidates.filter((candidate) => candidate.risk === 'high');
  const rewriteDeferralCandidates = sectionRecoveryCandidates.filter((candidate) => (
    candidate.eligibility !== 'eligible'
    || candidate.risk === 'high'
    || (candidate.risk === 'medium' && targetHas(candidate.recoveryTargets, /narrative|strategic|reader/i))
  ));
  const candidateExecutionOrder = executionOrder([
    ...safeRewriteCandidates,
    ...sectionRecoveryCandidates.filter((candidate) => candidate.risk === 'medium' && candidate.eligibility === 'eligible'),
  ]);

  const candidatePriorityMap = Object.fromEntries(sectionRecoveryCandidates.map((candidate) => [
    String(candidate.sectionIndex),
    candidate.priority,
  ]));
  const candidateConfidenceMap = Object.fromEntries(sectionRecoveryCandidates.map((candidate) => [
    String(candidate.sectionIndex),
    candidate.confidence,
  ]));

  return {
    version: 'regeneration-candidate-selection-v1',
    generatedAt: new Date(0).toISOString(),
    contentType: input.regenerationReadinessContract.contentType,
    topic: input.regenerationReadinessContract.topic,
    overallRecoveryEligibility: input.regenerationReadinessContract.regenerationEligibility,
    recommendedRecoveryTargets: unique([
      ...input.editorialRemediationPlan.criticalRecoveryTargets,
      ...safeRewriteCandidates.flatMap((candidate) => candidate.recoveryTargets),
    ], 12),
    safeRewriteCandidates,
    highRiskRewriteCandidates,
    rewriteDeferralCandidates,
    candidatePriorityMap,
    candidateConfidenceMap,
    candidateExecutionOrder,
    narrativeSafeRecoveryCandidates: safeRewriteCandidates.filter((candidate) => targetHas(candidate.recoveryTargets, /narrative|reader|transition/i)),
    authoritySafeRecoveryCandidates: safeRewriteCandidates.filter((candidate) => targetHas(candidate.recoveryTargets, /authority|proof|claim/i)),
    antiRepetitionRecoveryCandidates: sectionRecoveryCandidates.filter((candidate) => targetHas(candidate.recoveryTargets, /anti-repetition|section differentiation/i)),
    sectionRecoveryCandidates,
    recoveryRiskBalance: {
      lowRisk: sectionRecoveryCandidates.filter((candidate) => candidate.risk === 'low').length,
      mediumRisk: sectionRecoveryCandidates.filter((candidate) => candidate.risk === 'medium').length,
      highRisk: highRiskRewriteCandidates.length,
      deferred: rewriteDeferralCandidates.length,
    },
  };
}

export function serializeRegenerationCandidateSelection(selection: RegenerationCandidateSelection): string {
  return [
    '## REGENERATION CANDIDATE SELECTION',
    `Version: ${selection.version}`,
    `Topic: ${selection.topic}`,
    `Content type: ${selection.contentType}`,
    `Overall eligibility: ${selection.overallRecoveryEligibility}`,
    `Safe candidates: ${selection.safeRewriteCandidates.length}`,
    `High-risk candidates: ${selection.highRiskRewriteCandidates.length}`,
    `Deferred candidates: ${selection.rewriteDeferralCandidates.length}`,
    `Execution order: ${selection.candidateExecutionOrder.map((candidate) => candidate.sectionIndex).join(', ') || 'none'}`,
  ].join('\n');
}
