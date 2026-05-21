import type { BehavioralAdherenceDiagnosticReport } from './behavioralAdherenceDiagnostics';
import type { EditorialDiagnosticReport } from './editorialDiagnosticObserver';
import type {
  EditorialQualityReadinessReport,
  EditorialReadinessDimension,
  EditorialReadinessTier,
} from './editorialQualityReadiness';
import type { EditorialQualitySignal, EditorialQualitySignalReport } from './editorialQualitySignals';
import type { NarrativePlanningSection, NarrativeProgressionStage } from './narrativePlanningEngine';

export type EditorialRemediationPriority = 'critical' | 'high' | 'medium' | 'low';
export type EditorialRemediationConfidence = 'low' | 'medium' | 'high';

export interface EditorialRemediationHint {
  priority: EditorialRemediationPriority;
  confidence: EditorialRemediationConfidence;
  targetDimension: string;
  remediationIntent: string;
  correctionSignals: readonly string[];
  avoidSignals: readonly string[];
  sectionsAffected: readonly number[];
  sourceRisks: readonly string[];
}

export interface SectionEditorialRemediationHint {
  sectionIndex: number;
  progressionStage: NarrativeProgressionStage;
  narrativeRole: NarrativePlanningSection['narrativeRole'];
  remediationPriority: EditorialRemediationPriority;
  remediationTargets: readonly string[];
  readinessTier: EditorialReadinessTier;
  sourceRisks: readonly string[];
}

export interface EditorialRemediationHintReport {
  version: 'editorial-remediation-hints-v1';
  generatedAt: string;
  contentType: string;
  topic: string;
  narrativeRemediationHints: readonly EditorialRemediationHint[];
  authorityRemediationHints: readonly EditorialRemediationHint[];
  depthRemediationHints: readonly EditorialRemediationHint[];
  audienceAlignmentRemediationHints: readonly EditorialRemediationHint[];
  operationalRealismRemediationHints: readonly EditorialRemediationHint[];
  antiRepetitionRemediationHints: readonly EditorialRemediationHint[];
  transitionRemediationHints: readonly EditorialRemediationHint[];
  readerStateRemediationHints: readonly EditorialRemediationHint[];
  strategicTensionRemediationHints: readonly EditorialRemediationHint[];
  claimQualificationRemediationHints: readonly EditorialRemediationHint[];
  behavioralConsistencyRemediationHints: readonly EditorialRemediationHint[];
  editorialRiskRemediationHints: readonly EditorialRemediationHint[];
  sectionRemediationHints: readonly SectionEditorialRemediationHint[];
  remediationPriority: EditorialRemediationPriority;
  remediationConfidence: EditorialRemediationConfidence;
}

export interface EditorialRemediationHintInput {
  editorialQualityReadiness: EditorialQualityReadinessReport;
  editorialQualitySignals: EditorialQualitySignalReport;
  behavioralAdherenceDiagnostics: BehavioralAdherenceDiagnosticReport;
  editorialDiagnostics: EditorialDiagnosticReport;
}

function unique(values: readonly string[], limit = 10): string[] {
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

function priorityFromTier(tier: EditorialReadinessTier, riskCount: number): EditorialRemediationPriority {
  if (tier === 'not_ready') return 'critical';
  if (tier === 'at_risk') return 'high';
  if (tier === 'developing' || riskCount > 0) return 'medium';
  return 'low';
}

function confidenceFromDimension(dimension: EditorialReadinessDimension): EditorialRemediationConfidence {
  if (dimension.confidence === 'high' && dimension.blockingRisks.length > 0) return 'high';
  if (dimension.confidence === 'low') return 'low';
  return 'medium';
}

function buildHints(input: {
  dimension: EditorialReadinessDimension;
  signal: EditorialQualitySignal;
  targetDimension: string;
  remediationIntent: string;
  correctionSignals: readonly string[];
  avoidSignals: readonly string[];
}): readonly EditorialRemediationHint[] {
  const priority = priorityFromTier(input.dimension.tier, input.dimension.blockingRisks.length);
  if (priority === 'low' && input.signal.riskIndicators.length === 0) return [];
  return [{
    priority,
    confidence: confidenceFromDimension(input.dimension),
    targetDimension: input.targetDimension,
    remediationIntent: input.remediationIntent,
    correctionSignals: unique([
      ...input.correctionSignals,
      ...input.dimension.supportingSignals,
      ...input.signal.indicators,
    ], 8),
    avoidSignals: unique([
      ...input.avoidSignals,
      ...input.dimension.blockingRisks,
      ...input.signal.riskIndicators,
    ], 8),
    sectionsAffected: input.dimension.sectionsAffected,
    sourceRisks: unique([
      ...input.dimension.blockingRisks,
      ...input.signal.riskIndicators,
    ], 10),
  }];
}

function aggregatePriority(hints: readonly EditorialRemediationHint[]): EditorialRemediationPriority {
  if (hints.length === 0) return 'low';
  return hints.reduce((highest, hint) => (
    priorityRank(hint.priority) > priorityRank(highest) ? hint.priority : highest
  ), 'low' as EditorialRemediationPriority);
}

function aggregateConfidence(hints: readonly EditorialRemediationHint[]): EditorialRemediationConfidence {
  if (hints.some((hint) => hint.confidence === 'high')) return 'high';
  if (hints.some((hint) => hint.confidence === 'medium')) return 'medium';
  return 'low';
}

function sectionTargets(risks: readonly string[]): string[] {
  const targets: string[] = [];
  const joined = risks.join(' ').toLowerCase();
  if (/narrative|stage|progression/.test(joined)) targets.push('narrative progression');
  if (/proof|authority|claim|qualification/.test(joined)) targets.push('authority and proof discipline');
  if (/workflow|operational|decision|owner/.test(joined)) targets.push('operational realism');
  if (/repeat|framework|differentiation|section intent/.test(joined)) targets.push('section differentiation');
  if (/audience|operator|sophistication/.test(joined)) targets.push('audience calibration');
  if (/transition|reader-state|reader state/.test(joined)) targets.push('reader-state movement');
  if (/generic|strategic|doctrine|pov/.test(joined)) targets.push('strategic POV');
  return unique(targets.length ? targets : ['editorial alignment'], 6);
}

function sectionPriority(tier: EditorialReadinessTier, riskCount: number): EditorialRemediationPriority {
  return priorityFromTier(tier, riskCount);
}

export function buildEditorialRemediationHints(input: EditorialRemediationHintInput): EditorialRemediationHintReport {
  const readiness = input.editorialQualityReadiness;
  const signals = input.editorialQualitySignals;

  const narrativeRemediationHints = buildHints({
    dimension: readiness.narrativeReadiness,
    signal: signals.narrativeQualitySignals,
    targetDimension: 'narrative',
    remediationIntent: 'restore progression-stage behavior and prevent collapsed section logic',
    correctionSignals: ['preserve diagnose/reframe/expand/operationalize/validate/resolve movement'],
    avoidSignals: ['collapsed narrative behavior', 'mechanical sequential expansion'],
  });
  const authorityRemediationHints = buildHints({
    dimension: readiness.authorityReadiness,
    signal: signals.authorityQualitySignals,
    targetDimension: 'authority',
    remediationIntent: 'strengthen evidence behavior and credibility discipline',
    correctionSignals: ['add proof boundaries, scenarios, constraints, and qualified evidence behavior'],
    avoidSignals: ['unsupported claims', 'weak authority discipline'],
  });
  const depthRemediationHints = buildHints({
    dimension: readiness.depthReadiness,
    signal: signals.depthQualitySignals,
    targetDimension: 'depth',
    remediationIntent: 'increase operational nuance and strategic depth',
    correctionSignals: ['surface tradeoffs, implementation friction, stakeholder complexity, and failure patterns'],
    avoidSignals: ['thin depth behavior', 'generic explanation'],
  });
  const audienceAlignmentRemediationHints = buildHints({
    dimension: readiness.audienceAlignmentReadiness,
    signal: signals.audienceAlignmentSignals,
    targetDimension: 'audience alignment',
    remediationIntent: 'calibrate assumptions for the intended operator or decision-maker maturity',
    correctionSignals: ['name operator, leader, stakeholder, and decision context explicitly'],
    avoidSignals: ['audience sophistication drift', 'beginner-grade framing'],
  });
  const operationalRealismRemediationHints = buildHints({
    dimension: readiness.operationalRealismReadiness,
    signal: signals.operationalRealismSignals,
    targetDimension: 'operational realism',
    remediationIntent: 'anchor guidance in workflows, owners, constraints, and decisions',
    correctionSignals: ['add workflow owner, decision point, handoff, review check, and tradeoff signals'],
    avoidSignals: ['weak operational realism', 'abstract implementation advice'],
  });
  const antiRepetitionRemediationHints = buildHints({
    dimension: readiness.antiRepetitionReadiness,
    signal: signals.antiRepetitionSignals,
    targetDimension: 'anti-repetition',
    remediationIntent: 'separate section responsibilities and remove repeated answer shapes',
    correctionSignals: ['assign distinct section movement, example type, proof role, and argument boundary'],
    avoidSignals: ['repeated behavioral pattern', 'repeated direct-answer shape', 'reused framework loop'],
  });
  const transitionRemediationHints = buildHints({
    dimension: readiness.transitionReadiness,
    signal: signals.transitionQualitySignals,
    targetDimension: 'transition',
    remediationIntent: 'restore clear movement between section states',
    correctionSignals: ['connect each section to the next reader-state shift'],
    avoidSignals: ['weak transition behavior', 'repetitive transition behavior'],
  });
  const readerStateRemediationHints = buildHints({
    dimension: readiness.readerStateProgressionReadiness,
    signal: signals.readerStateProgressionSignals,
    targetDimension: 'reader state',
    remediationIntent: 'make reader-state movement visible in each section',
    correctionSignals: ['show what the reader should understand, question, decide, or trust next'],
    avoidSignals: ['flat reader-state movement', 'missing reader-state movement'],
  });
  const strategicTensionRemediationHints = buildHints({
    dimension: readiness.strategicTensionReadiness,
    signal: signals.strategicTensionSignals,
    targetDimension: 'strategic tension',
    remediationIntent: 'replace generic strategic framing with company-conditioned tension',
    correctionSignals: ['surface default assumption, enemy assumption, strategic belief, and company POV'],
    avoidSignals: ['generic strategic framing', 'generic SaaS framing', 'doctrine drift'],
  });
  const claimQualificationRemediationHints = buildHints({
    dimension: readiness.claimQualificationReadiness,
    signal: signals.claimQualificationSignals,
    targetDimension: 'claim qualification',
    remediationIntent: 'bound claims by conditions, limits, and evidence maturity',
    correctionSignals: ['qualify claims with when, unless, without, constraint, and depends signals'],
    avoidSignals: ['shallow proof behavior', 'unqualified claims'],
  });
  const behavioralConsistencyRemediationHints = buildHints({
    dimension: readiness.behavioralConsistencyReadiness,
    signal: signals.behavioralConsistencySignals,
    targetDimension: 'behavioral consistency',
    remediationIntent: 'realign generated sections with assigned runtime behavioral priorities',
    correctionSignals: ['use the section primary behavior as the local editorial objective'],
    avoidSignals: ['behavioral priority drift', 'role mismatch'],
  });
  const editorialRiskRemediationHints = buildHints({
    dimension: readiness.editorialRiskReadiness,
    signal: {
      aligned: readiness.editorialRiskReadiness.tier === 'ready' || readiness.editorialRiskReadiness.tier === 'strong',
      risk: readiness.editorialRiskReadiness.riskLevel,
      confidence: readiness.editorialRiskReadiness.confidence,
      signalStrength: readiness.editorialRiskReadiness.blockingRisks.length > 0 ? 'weak' : 'strong',
      indicators: readiness.editorialRiskReadiness.supportingSignals,
      riskIndicators: readiness.editorialRiskReadiness.blockingRisks,
      sourceDimensions: ['editorialRiskReadiness'],
      sectionsAffected: readiness.editorialRiskReadiness.sectionsAffected,
    },
    targetDimension: 'editorial risk',
    remediationIntent: 'prioritize the densest cross-diagnostic editorial risks before optimization',
    correctionSignals: ['address critical readiness blockers before style or expansion changes'],
    avoidSignals: ['risk stacking across diagnostics'],
  });

  const allDimensionHints = [
    ...narrativeRemediationHints,
    ...authorityRemediationHints,
    ...depthRemediationHints,
    ...audienceAlignmentRemediationHints,
    ...operationalRealismRemediationHints,
    ...antiRepetitionRemediationHints,
    ...transitionRemediationHints,
    ...readerStateRemediationHints,
    ...strategicTensionRemediationHints,
    ...claimQualificationRemediationHints,
    ...behavioralConsistencyRemediationHints,
    ...editorialRiskRemediationHints,
  ];

  const sectionRemediationHints = readiness.sectionReadiness
    .filter((section) => section.readinessTier !== 'strong' || section.readinessRisks.length > 0)
    .map((section): SectionEditorialRemediationHint => {
      const editorial = input.editorialDiagnostics.sections.find((candidate) => candidate.sectionIndex === section.sectionIndex);
      const behavioral = input.behavioralAdherenceDiagnostics.sections.find((candidate) => candidate.sectionIndex === section.sectionIndex);
      const sourceRisks = unique([
        ...section.readinessRisks,
        ...(editorial?.riskFlags || []),
        ...(behavioral?.behavioralRiskFlags || []),
      ], 12);
      return {
        sectionIndex: section.sectionIndex,
        progressionStage: section.progressionStage,
        narrativeRole: section.narrativeRole,
        remediationPriority: sectionPriority(section.readinessTier, sourceRisks.length),
        remediationTargets: sectionTargets(sourceRisks),
        readinessTier: section.readinessTier,
        sourceRisks,
      };
    });

  return {
    version: 'editorial-remediation-hints-v1',
    generatedAt: new Date(0).toISOString(),
    contentType: readiness.contentType,
    topic: readiness.topic,
    narrativeRemediationHints,
    authorityRemediationHints,
    depthRemediationHints,
    audienceAlignmentRemediationHints,
    operationalRealismRemediationHints,
    antiRepetitionRemediationHints,
    transitionRemediationHints,
    readerStateRemediationHints,
    strategicTensionRemediationHints,
    claimQualificationRemediationHints,
    behavioralConsistencyRemediationHints,
    editorialRiskRemediationHints,
    sectionRemediationHints,
    remediationPriority: aggregatePriority(allDimensionHints),
    remediationConfidence: aggregateConfidence(allDimensionHints),
  };
}

export function serializeEditorialRemediationHints(report: EditorialRemediationHintReport): string {
  const dimensionSummary = [
    ['narrative', report.narrativeRemediationHints],
    ['authority', report.authorityRemediationHints],
    ['depth', report.depthRemediationHints],
    ['audience', report.audienceAlignmentRemediationHints],
    ['operational realism', report.operationalRealismRemediationHints],
    ['anti-repetition', report.antiRepetitionRemediationHints],
    ['transition', report.transitionRemediationHints],
    ['reader state', report.readerStateRemediationHints],
    ['strategic tension', report.strategicTensionRemediationHints],
    ['claim qualification', report.claimQualificationRemediationHints],
    ['behavioral consistency', report.behavioralConsistencyRemediationHints],
    ['editorial risk', report.editorialRiskRemediationHints],
  ].map(([label, hints]) => {
    const dimensionHints = hints as readonly EditorialRemediationHint[];
    return `${label}: hints=${dimensionHints.length}; priority=${aggregatePriority(dimensionHints)}`;
  });

  return [
    '## EDITORIAL REMEDIATION HINTS',
    `Version: ${report.version}`,
    `Topic: ${report.topic}`,
    `Content type: ${report.contentType}`,
    `Remediation priority: ${report.remediationPriority}`,
    `Confidence: ${report.remediationConfidence}`,
    `Section hints: ${report.sectionRemediationHints.length}`,
    'Dimension hints:',
    ...dimensionSummary,
  ].join('\n');
}
