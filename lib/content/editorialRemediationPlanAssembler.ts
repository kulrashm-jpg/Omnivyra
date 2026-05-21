import type { BehavioralAdherenceDiagnosticReport } from './behavioralAdherenceDiagnostics';
import type {
  EditorialRemediationHint,
  EditorialRemediationHintReport,
  EditorialRemediationPriority,
} from './editorialRemediationHints';
import type { EditorialQualityReadinessReport } from './editorialQualityReadiness';
import type { EditorialQualitySignalReport } from './editorialQualitySignals';
import type { NarrativePlanningSection, NarrativeProgressionStage } from './narrativePlanningEngine';

export type EditorialRecoveryConfidence = 'low' | 'medium' | 'high';

export interface EditorialRecoveryStep {
  order: number;
  targetDimension: string;
  priority: EditorialRemediationPriority;
  recoveryIntent: string;
  dependencyReason: string;
  sectionsAffected: readonly number[];
  recoverySignals: readonly string[];
  avoidSignals: readonly string[];
}

export interface EditorialDimensionRecoveryPlan {
  targetDimension: string;
  recoveryPriority: EditorialRemediationPriority;
  recoveryStrategy: string;
  recoverySteps: readonly EditorialRecoveryStep[];
  sectionsAffected: readonly number[];
}

export interface SectionEditorialRecoveryPlan {
  sectionIndex: number;
  progressionStage: NarrativeProgressionStage;
  narrativeRole: NarrativePlanningSection['narrativeRole'];
  recoveryPriority: EditorialRemediationPriority;
  recoveryTargets: readonly string[];
  recoverySequence: readonly string[];
  sourceRisks: readonly string[];
}

export interface EditorialRemediationPlan {
  version: 'editorial-remediation-plan-v1';
  generatedAt: string;
  contentType: string;
  topic: string;
  overallRemediationStrategy: readonly string[];
  remediationExecutionOrder: readonly EditorialRecoveryStep[];
  criticalRecoveryTargets: readonly string[];
  narrativeRecoveryPlan: EditorialDimensionRecoveryPlan;
  authorityRecoveryPlan: EditorialDimensionRecoveryPlan;
  depthRecoveryPlan: EditorialDimensionRecoveryPlan;
  audienceAlignmentRecoveryPlan: EditorialDimensionRecoveryPlan;
  operationalRealismRecoveryPlan: EditorialDimensionRecoveryPlan;
  antiRepetitionRecoveryPlan: EditorialDimensionRecoveryPlan;
  transitionRecoveryPlan: EditorialDimensionRecoveryPlan;
  readerStateRecoveryPlan: EditorialDimensionRecoveryPlan;
  strategicTensionRecoveryPlan: EditorialDimensionRecoveryPlan;
  claimQualificationRecoveryPlan: EditorialDimensionRecoveryPlan;
  behavioralConsistencyRecoveryPlan: EditorialDimensionRecoveryPlan;
  sectionRecoveryPlans: readonly SectionEditorialRecoveryPlan[];
  recoveryPriorityMap: Record<string, EditorialRemediationPriority>;
  recoveryConfidence: EditorialRecoveryConfidence;
}

export interface EditorialRemediationPlanInput {
  editorialRemediationHints: EditorialRemediationHintReport;
  editorialQualityReadiness: EditorialQualityReadinessReport;
  editorialQualitySignals: EditorialQualitySignalReport;
  behavioralAdherenceDiagnostics: BehavioralAdherenceDiagnosticReport;
}

const DEPENDENCY_ORDER: Record<string, number> = {
  'editorial risk': 0,
  'anti-repetition': 1,
  'behavioral consistency': 2,
  narrative: 3,
  'strategic tension': 4,
  'audience alignment': 5,
  authority: 6,
  'claim qualification': 7,
  depth: 8,
  'operational realism': 9,
  'reader state': 10,
  transition: 11,
};

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

function dependencyReason(targetDimension: string): string {
  const reasons: Record<string, string> = {
    'editorial risk': 'risk density must be stabilized before downstream recovery',
    'anti-repetition': 'section differentiation protects later narrative and proof revisions from collapsing into repeated shapes',
    'behavioral consistency': 'runtime behavior must be realigned before section-specific recovery',
    narrative: 'narrative progression sets the sequence for all downstream corrections',
    'strategic tension': 'company-conditioned POV anchors authority, depth, and audience calibration',
    'audience alignment': 'audience maturity calibrates how proof and operational detail should be expressed',
    authority: 'authority behavior depends on stable narrative and POV framing',
    'claim qualification': 'claim boundaries should follow authority recovery',
    depth: 'depth should expand after narrative, audience, and proof expectations are clear',
    'operational realism': 'workflow realism should be layered after depth targets are known',
    'reader state': 'reader-state movement depends on section purpose and recovery sequencing',
    transition: 'transitions should be recovered after section-level responsibilities are stable',
  };
  return reasons[targetDimension] || 'dimension recovery follows dependency and priority order';
}

function strategyFor(targetDimension: string): string {
  const strategies: Record<string, string> = {
    narrative: 'stabilize progression-stage behavior and section movement',
    authority: 'restore proof, scenario, constraint, and evidence behavior',
    depth: 'increase operational nuance after narrative structure is stable',
    'audience alignment': 'calibrate maturity assumptions and decision-maker context',
    'operational realism': 'anchor corrections in workflow, ownership, tradeoffs, and constraints',
    'anti-repetition': 'remove duplicated section shapes before expanding content',
    transition: 'recover handoff logic between sections after section roles are distinct',
    'reader state': 'make reader understanding and decision movement explicit',
    'strategic tension': 'replace generic framing with company-conditioned strategic tension',
    'claim qualification': 'bound claims with conditions, limits, and evidence maturity',
    'behavioral consistency': 'realign sections with runtime behavioral objectives',
    'editorial risk': 'address cross-diagnostic blockers before optimization work',
  };
  return strategies[targetDimension] || 'recover dimension-specific editorial behavior';
}

function toSteps(hints: readonly EditorialRemediationHint[]): EditorialRecoveryStep[] {
  return hints.map((hint, index): EditorialRecoveryStep => ({
    order: index + 1,
    targetDimension: hint.targetDimension,
    priority: hint.priority,
    recoveryIntent: hint.remediationIntent,
    dependencyReason: dependencyReason(hint.targetDimension),
    sectionsAffected: hint.sectionsAffected,
    recoverySignals: hint.correctionSignals,
    avoidSignals: hint.avoidSignals,
  }));
}

function planFor(targetDimension: string, hints: readonly EditorialRemediationHint[]): EditorialDimensionRecoveryPlan {
  const steps = toSteps(hints);
  const priority = hints.reduce((highest, hint) => (
    priorityRank(hint.priority) > priorityRank(highest) ? hint.priority : highest
  ), 'low' as EditorialRemediationPriority);
  return {
    targetDimension,
    recoveryPriority: priority,
    recoveryStrategy: strategyFor(targetDimension),
    recoverySteps: steps,
    sectionsAffected: Array.from(new Set(hints.flatMap((hint) => hint.sectionsAffected))).sort((a, b) => a - b),
  };
}

function orderedSteps(hints: readonly EditorialRemediationHint[]): EditorialRecoveryStep[] {
  return hints
    .slice()
    .sort((a, b) => {
      const priorityDelta = priorityRank(b.priority) - priorityRank(a.priority);
      if (priorityDelta !== 0) return priorityDelta;
      return (DEPENDENCY_ORDER[a.targetDimension] ?? 99) - (DEPENDENCY_ORDER[b.targetDimension] ?? 99);
    })
    .map((hint, index): EditorialRecoveryStep => ({
      order: index + 1,
      targetDimension: hint.targetDimension,
      priority: hint.priority,
      recoveryIntent: hint.remediationIntent,
      dependencyReason: dependencyReason(hint.targetDimension),
      sectionsAffected: hint.sectionsAffected,
      recoverySignals: hint.correctionSignals,
      avoidSignals: hint.avoidSignals,
    }));
}

function confidence(input: EditorialRemediationPlanInput): EditorialRecoveryConfidence {
  if (
    input.editorialRemediationHints.remediationConfidence === 'high'
    && input.editorialQualityReadiness.readinessConfidence === 'high'
    && input.behavioralAdherenceDiagnostics.alignmentSummary.confidence !== 'low'
  ) return 'high';
  if (
    input.editorialRemediationHints.remediationConfidence === 'low'
    || input.editorialQualityReadiness.readinessConfidence === 'low'
    || input.behavioralAdherenceDiagnostics.alignmentSummary.confidence === 'low'
  ) return 'low';
  return 'medium';
}

export function assembleEditorialRemediationPlan(input: EditorialRemediationPlanInput): EditorialRemediationPlan {
  const hints = input.editorialRemediationHints;
  const allHints = [
    ...hints.editorialRiskRemediationHints,
    ...hints.antiRepetitionRemediationHints,
    ...hints.behavioralConsistencyRemediationHints,
    ...hints.narrativeRemediationHints,
    ...hints.strategicTensionRemediationHints,
    ...hints.audienceAlignmentRemediationHints,
    ...hints.authorityRemediationHints,
    ...hints.claimQualificationRemediationHints,
    ...hints.depthRemediationHints,
    ...hints.operationalRealismRemediationHints,
    ...hints.readerStateRemediationHints,
    ...hints.transitionRemediationHints,
  ];
  const executionOrder = orderedSteps(allHints);
  const criticalRecoveryTargets = unique(executionOrder
    .filter((step) => step.priority === 'critical' || step.priority === 'high')
    .map((step) => step.targetDimension), 12);

  const recoveryPriorityMap = Object.fromEntries([
    ['narrative', hints.narrativeRemediationHints],
    ['authority', hints.authorityRemediationHints],
    ['depth', hints.depthRemediationHints],
    ['audience alignment', hints.audienceAlignmentRemediationHints],
    ['operational realism', hints.operationalRealismRemediationHints],
    ['anti-repetition', hints.antiRepetitionRemediationHints],
    ['transition', hints.transitionRemediationHints],
    ['reader state', hints.readerStateRemediationHints],
    ['strategic tension', hints.strategicTensionRemediationHints],
    ['claim qualification', hints.claimQualificationRemediationHints],
    ['behavioral consistency', hints.behavioralConsistencyRemediationHints],
    ['editorial risk', hints.editorialRiskRemediationHints],
  ].map(([dimension, dimensionHints]) => [
    dimension,
    planFor(dimension as string, dimensionHints as readonly EditorialRemediationHint[]).recoveryPriority,
  ]));

  const sectionRecoveryPlans = hints.sectionRemediationHints
    .slice()
    .sort((a, b) => {
      const priorityDelta = priorityRank(b.remediationPriority) - priorityRank(a.remediationPriority);
      if (priorityDelta !== 0) return priorityDelta;
      return a.sectionIndex - b.sectionIndex;
    })
    .map((section): SectionEditorialRecoveryPlan => ({
      sectionIndex: section.sectionIndex,
      progressionStage: section.progressionStage,
      narrativeRole: section.narrativeRole,
      recoveryPriority: section.remediationPriority,
      recoveryTargets: section.remediationTargets,
      recoverySequence: unique(section.remediationTargets
        .slice()
        .sort((a, b) => (DEPENDENCY_ORDER[a] ?? 99) - (DEPENDENCY_ORDER[b] ?? 99))
        .map((target) => strategyFor(target)), 8),
      sourceRisks: section.sourceRisks,
    }));

  return {
    version: 'editorial-remediation-plan-v1',
    generatedAt: new Date(0).toISOString(),
    contentType: hints.contentType,
    topic: hints.topic,
    overallRemediationStrategy: unique([
      'stabilize critical editorial risks before content expansion',
      'recover anti-repetition and section differentiation before narrative refinement',
      'preserve narrative progression before authority, depth, and transition recovery',
      `overall readiness: ${input.editorialQualityReadiness.overallReadinessTier}`,
      `quality risk: ${input.editorialQualitySignals.signalSummary.overallRisk}`,
    ], 8),
    remediationExecutionOrder: executionOrder,
    criticalRecoveryTargets,
    narrativeRecoveryPlan: planFor('narrative', hints.narrativeRemediationHints),
    authorityRecoveryPlan: planFor('authority', hints.authorityRemediationHints),
    depthRecoveryPlan: planFor('depth', hints.depthRemediationHints),
    audienceAlignmentRecoveryPlan: planFor('audience alignment', hints.audienceAlignmentRemediationHints),
    operationalRealismRecoveryPlan: planFor('operational realism', hints.operationalRealismRemediationHints),
    antiRepetitionRecoveryPlan: planFor('anti-repetition', hints.antiRepetitionRemediationHints),
    transitionRecoveryPlan: planFor('transition', hints.transitionRemediationHints),
    readerStateRecoveryPlan: planFor('reader state', hints.readerStateRemediationHints),
    strategicTensionRecoveryPlan: planFor('strategic tension', hints.strategicTensionRemediationHints),
    claimQualificationRecoveryPlan: planFor('claim qualification', hints.claimQualificationRemediationHints),
    behavioralConsistencyRecoveryPlan: planFor('behavioral consistency', hints.behavioralConsistencyRemediationHints),
    sectionRecoveryPlans,
    recoveryPriorityMap,
    recoveryConfidence: confidence(input),
  };
}

export function serializeEditorialRemediationPlan(plan: EditorialRemediationPlan): string {
  return [
    '## EDITORIAL REMEDIATION PLAN',
    `Version: ${plan.version}`,
    `Topic: ${plan.topic}`,
    `Content type: ${plan.contentType}`,
    `Recovery confidence: ${plan.recoveryConfidence}`,
    `Critical targets: ${plan.criticalRecoveryTargets.join('; ') || 'none'}`,
    `Execution steps: ${plan.remediationExecutionOrder.length}`,
    `Section recovery plans: ${plan.sectionRecoveryPlans.length}`,
    `Priority map: ${Object.entries(plan.recoveryPriorityMap).map(([key, value]) => `${key}=${value}`).join('; ')}`,
  ].join('\n');
}
