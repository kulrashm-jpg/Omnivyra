import type { BehavioralAdherenceDiagnosticReport } from './behavioralAdherenceDiagnostics';
import type { EditorialDiagnosticReport } from './editorialDiagnosticObserver';
import type {
  EditorialQualitySignal,
  EditorialQualitySignalReport,
  SectionEditorialQualitySignal,
} from './editorialQualitySignals';
import type { GeneratorRuntimeAlignment } from './generatorRuntimeAlignment';
import type { NarrativePlanningSection, NarrativeProgressionStage } from './narrativePlanningEngine';

export type EditorialReadinessTier =
  | 'strong'
  | 'ready'
  | 'developing'
  | 'at_risk'
  | 'not_ready';

export type EditorialReadinessConfidence = 'low' | 'medium' | 'high';

export interface EditorialReadinessDimension {
  tier: EditorialReadinessTier;
  confidence: EditorialReadinessConfidence;
  riskLevel: 'low' | 'medium' | 'high';
  readinessSummary: string;
  supportingSignals: readonly string[];
  blockingRisks: readonly string[];
  sectionsAffected: readonly number[];
}

export interface SectionEditorialReadiness {
  sectionIndex: number;
  progressionStage: NarrativeProgressionStage;
  narrativeRole: NarrativePlanningSection['narrativeRole'];
  readinessTier: EditorialReadinessTier;
  readinessConfidence: EditorialReadinessConfidence;
  alignedDimensions: number;
  totalDimensions: number;
  readinessRisks: readonly string[];
}

export interface EditorialQualityReadinessReport {
  version: 'editorial-quality-readiness-v1';
  generatedAt: string;
  contentType: string;
  topic: string;
  overallReadinessTier: EditorialReadinessTier;
  narrativeReadiness: EditorialReadinessDimension;
  authorityReadiness: EditorialReadinessDimension;
  depthReadiness: EditorialReadinessDimension;
  audienceAlignmentReadiness: EditorialReadinessDimension;
  operationalRealismReadiness: EditorialReadinessDimension;
  antiRepetitionReadiness: EditorialReadinessDimension;
  transitionReadiness: EditorialReadinessDimension;
  readerStateProgressionReadiness: EditorialReadinessDimension;
  strategicTensionReadiness: EditorialReadinessDimension;
  claimQualificationReadiness: EditorialReadinessDimension;
  behavioralConsistencyReadiness: EditorialReadinessDimension;
  editorialRiskReadiness: EditorialReadinessDimension;
  sectionReadiness: readonly SectionEditorialReadiness[];
  readinessConfidence: EditorialReadinessConfidence;
}

export interface EditorialQualityReadinessInput {
  editorialQualitySignals: EditorialQualitySignalReport;
  behavioralAdherenceDiagnostics: BehavioralAdherenceDiagnosticReport;
  editorialDiagnostics: EditorialDiagnosticReport;
  generatorRuntimeAlignment: GeneratorRuntimeAlignment;
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

function confidenceRank(confidence: EditorialReadinessConfidence): number {
  return confidence === 'high' ? 3 : confidence === 'medium' ? 2 : 1;
}

function tierRank(tier: EditorialReadinessTier): number {
  const ranks: Record<EditorialReadinessTier, number> = {
    strong: 5,
    ready: 4,
    developing: 3,
    at_risk: 2,
    not_ready: 1,
  };
  return ranks[tier];
}

function signalTier(signal: EditorialQualitySignal): EditorialReadinessTier {
  if (signal.risk === 'high') return 'not_ready';
  if (signal.risk === 'medium' && signal.signalStrength === 'weak') return 'at_risk';
  if (signal.risk === 'medium') return 'developing';
  if (signal.signalStrength === 'strong' && signal.aligned) return 'strong';
  if (signal.signalStrength === 'moderate' || signal.aligned) return 'ready';
  return 'developing';
}

function signalConfidence(signal: EditorialQualitySignal): EditorialReadinessConfidence {
  if (signal.confidence === 'high' && signal.indicators.length > 0) return 'high';
  if (signal.confidence === 'low') return 'low';
  return 'medium';
}

function dimensionFromSignal(input: {
  signal: EditorialQualitySignal;
  label: string;
  runtimeSignals?: readonly string[];
}): EditorialReadinessDimension {
  const tier = signalTier(input.signal);
  const confidence = signalConfidence(input.signal);
  return {
    tier,
    confidence,
    riskLevel: input.signal.risk,
    readinessSummary: `${input.label} readiness is ${tier}.`,
    supportingSignals: unique([
      ...input.signal.indicators,
      ...(input.runtimeSignals || []),
    ], 8),
    blockingRisks: unique(input.signal.riskIndicators, 10),
    sectionsAffected: input.signal.sectionsAffected,
  };
}

function sectionTier(section: SectionEditorialQualitySignal): EditorialReadinessTier {
  const ratio = section.totalDimensions > 0 ? section.alignedDimensions / section.totalDimensions : 0;
  if (section.dominantRisk === 'high') return 'not_ready';
  if (section.dominantRisk === 'medium' && ratio < 0.5) return 'at_risk';
  if (section.dominantRisk === 'medium') return 'developing';
  if (ratio >= 0.85) return 'strong';
  if (ratio >= 0.65) return 'ready';
  return 'developing';
}

function sectionConfidence(section: SectionEditorialQualitySignal): EditorialReadinessConfidence {
  if (section.totalDimensions >= 8 && section.alignedDimensions > 0) return 'high';
  if (section.totalDimensions >= 4) return 'medium';
  return 'low';
}

function aggregateTier(dimensions: readonly EditorialReadinessDimension[]): EditorialReadinessTier {
  if (dimensions.some((dimension) => dimension.tier === 'not_ready')) return 'not_ready';
  if (dimensions.filter((dimension) => dimension.tier === 'at_risk').length >= 2) return 'at_risk';
  if (dimensions.some((dimension) => dimension.tier === 'at_risk')) return 'developing';
  if (dimensions.filter((dimension) => dimension.tier === 'developing').length >= 4) return 'developing';
  if (dimensions.every((dimension) => dimension.tier === 'strong')) return 'strong';
  if (dimensions.every((dimension) => tierRank(dimension.tier) >= tierRank('ready'))) return 'ready';
  return 'developing';
}

function aggregateConfidence(dimensions: readonly EditorialReadinessDimension[]): EditorialReadinessConfidence {
  if (dimensions.some((dimension) => confidenceRank(dimension.confidence) === 1)) return 'low';
  if (dimensions.some((dimension) => confidenceRank(dimension.confidence) === 2)) return 'medium';
  return 'high';
}

export function buildEditorialQualityReadiness(input: EditorialQualityReadinessInput): EditorialQualityReadinessReport {
  const signals = input.editorialQualitySignals;

  const narrativeReadiness = dimensionFromSignal({
    signal: signals.narrativeQualitySignals,
    label: 'Narrative',
    runtimeSignals: input.generatorRuntimeAlignment.runtimeNarrativeSequence,
  });
  const authorityReadiness = dimensionFromSignal({
    signal: signals.authorityQualitySignals,
    label: 'Authority',
    runtimeSignals: input.generatorRuntimeAlignment.runtimeAuthorityTargets,
  });
  const depthReadiness = dimensionFromSignal({
    signal: signals.depthQualitySignals,
    label: 'Depth',
    runtimeSignals: input.generatorRuntimeAlignment.runtimeDepthTargets,
  });
  const audienceAlignmentReadiness = dimensionFromSignal({
    signal: signals.audienceAlignmentSignals,
    label: 'Audience alignment',
  });
  const operationalRealismReadiness = dimensionFromSignal({
    signal: signals.operationalRealismSignals,
    label: 'Operational realism',
  });
  const antiRepetitionReadiness = dimensionFromSignal({
    signal: signals.antiRepetitionSignals,
    label: 'Anti-repetition',
    runtimeSignals: input.generatorRuntimeAlignment.runtimeAntiRepetitionSignals,
  });
  const transitionReadiness = dimensionFromSignal({
    signal: signals.transitionQualitySignals,
    label: 'Transition',
    runtimeSignals: input.generatorRuntimeAlignment.runtimeTransitionTargets,
  });
  const readerStateProgressionReadiness = dimensionFromSignal({
    signal: signals.readerStateProgressionSignals,
    label: 'Reader-state progression',
    runtimeSignals: input.generatorRuntimeAlignment.runtimeReaderStateTargets,
  });
  const strategicTensionReadiness = dimensionFromSignal({
    signal: signals.strategicTensionSignals,
    label: 'Strategic tension',
  });
  const claimQualificationReadiness = dimensionFromSignal({
    signal: signals.claimQualificationSignals,
    label: 'Claim qualification',
    runtimeSignals: input.generatorRuntimeAlignment.runtimeClaimQualificationTargets,
  });
  const behavioralConsistencyReadiness = dimensionFromSignal({
    signal: signals.behavioralConsistencySignals,
    label: 'Behavioral consistency',
  });
  const editorialRiskReadiness: EditorialReadinessDimension = {
    tier: signals.editorialRiskSignals.length > 12
      ? 'not_ready'
      : signals.editorialRiskSignals.length > 6
        ? 'at_risk'
        : signals.editorialRiskSignals.length > 0
          ? 'developing'
          : 'ready',
    confidence: signals.signalSummary.confidence,
    riskLevel: signals.signalSummary.overallRisk,
    readinessSummary: 'Editorial risk readiness reflects normalized cross-diagnostic risk density.',
    supportingSignals: unique([
      `editorial diagnostic risk: ${input.editorialDiagnostics.alignmentSummary.overallRisk}`,
      `behavioral diagnostic risk: ${input.behavioralAdherenceDiagnostics.alignmentSummary.overallRisk}`,
    ]),
    blockingRisks: unique(signals.editorialRiskSignals, 16),
    sectionsAffected: unique([
      ...input.editorialDiagnostics.sections.flatMap((section) => section.riskFlags.length ? [String(section.sectionIndex)] : []),
      ...input.behavioralAdherenceDiagnostics.sections.flatMap((section) => section.behavioralRiskFlags.length ? [String(section.sectionIndex)] : []),
    ]).map((sectionIndex) => Number(sectionIndex)).sort((a, b) => a - b),
  };

  const readinessDimensions = [
    narrativeReadiness,
    authorityReadiness,
    depthReadiness,
    audienceAlignmentReadiness,
    operationalRealismReadiness,
    antiRepetitionReadiness,
    transitionReadiness,
    readerStateProgressionReadiness,
    strategicTensionReadiness,
    claimQualificationReadiness,
    behavioralConsistencyReadiness,
    editorialRiskReadiness,
  ];

  const sectionReadiness = signals.sectionQualitySignals.map((section): SectionEditorialReadiness => ({
    sectionIndex: section.sectionIndex,
    progressionStage: section.progressionStage,
    narrativeRole: section.narrativeRole,
    readinessTier: sectionTier(section),
    readinessConfidence: sectionConfidence(section),
    alignedDimensions: section.alignedDimensions,
    totalDimensions: section.totalDimensions,
    readinessRisks: unique(section.qualityRiskFlags, 10),
  }));

  return {
    version: 'editorial-quality-readiness-v1',
    generatedAt: new Date(0).toISOString(),
    contentType: signals.contentType,
    topic: signals.topic,
    overallReadinessTier: aggregateTier(readinessDimensions),
    narrativeReadiness,
    authorityReadiness,
    depthReadiness,
    audienceAlignmentReadiness,
    operationalRealismReadiness,
    antiRepetitionReadiness,
    transitionReadiness,
    readerStateProgressionReadiness,
    strategicTensionReadiness,
    claimQualificationReadiness,
    behavioralConsistencyReadiness,
    editorialRiskReadiness,
    sectionReadiness,
    readinessConfidence: aggregateConfidence(readinessDimensions),
  };
}

export function serializeEditorialQualityReadiness(report: EditorialQualityReadinessReport): string {
  const dimensionSummary = [
    ['narrative', report.narrativeReadiness],
    ['authority', report.authorityReadiness],
    ['depth', report.depthReadiness],
    ['audience', report.audienceAlignmentReadiness],
    ['operational realism', report.operationalRealismReadiness],
    ['anti-repetition', report.antiRepetitionReadiness],
    ['transition', report.transitionReadiness],
    ['reader state', report.readerStateProgressionReadiness],
    ['strategic tension', report.strategicTensionReadiness],
    ['claim qualification', report.claimQualificationReadiness],
    ['behavioral consistency', report.behavioralConsistencyReadiness],
    ['editorial risk', report.editorialRiskReadiness],
  ].map(([label, readiness]) => `${label}: tier=${(readiness as EditorialReadinessDimension).tier}; risk=${(readiness as EditorialReadinessDimension).riskLevel}`);

  return [
    '## EDITORIAL QUALITY READINESS',
    `Version: ${report.version}`,
    `Topic: ${report.topic}`,
    `Content type: ${report.contentType}`,
    `Overall readiness: ${report.overallReadinessTier}`,
    `Confidence: ${report.readinessConfidence}`,
    'Readiness dimensions:',
    ...dimensionSummary,
  ].join('\n');
}
