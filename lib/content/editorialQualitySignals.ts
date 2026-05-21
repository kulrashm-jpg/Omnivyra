import type { BehavioralAdherenceDiagnosticReport, BehavioralDiagnosticDimension } from './behavioralAdherenceDiagnostics';
import type { EditorialDiagnosticDimension, EditorialDiagnosticReport } from './editorialDiagnosticObserver';
import type { GeneratorBehavioralSteering } from './generatorBehavioralSteering';
import type { GeneratorRuntimeAlignment } from './generatorRuntimeAlignment';
import type { NarrativePlanningSection, NarrativeProgressionStage } from './narrativePlanningEngine';

export type EditorialQualitySignalRisk = 'low' | 'medium' | 'high';
export type EditorialQualitySignalConfidence = 'low' | 'medium' | 'high';
export type EditorialQualitySignalStrength = 'weak' | 'moderate' | 'strong';

type SourceDimension = EditorialDiagnosticDimension | BehavioralDiagnosticDimension;

export interface EditorialQualitySignal {
  aligned: boolean;
  risk: EditorialQualitySignalRisk;
  confidence: EditorialQualitySignalConfidence;
  signalStrength: EditorialQualitySignalStrength;
  indicators: readonly string[];
  riskIndicators: readonly string[];
  sourceDimensions: readonly string[];
  sectionsAffected: readonly number[];
}

export interface SectionEditorialQualitySignal {
  sectionIndex: number;
  progressionStage: NarrativeProgressionStage;
  narrativeRole: NarrativePlanningSection['narrativeRole'];
  alignedDimensions: number;
  totalDimensions: number;
  dominantRisk: EditorialQualitySignalRisk;
  qualityRiskFlags: readonly string[];
}

export interface EditorialQualitySignalReport {
  version: 'editorial-quality-signals-v1';
  generatedAt: string;
  contentType: string;
  topic: string;
  narrativeQualitySignals: EditorialQualitySignal;
  authorityQualitySignals: EditorialQualitySignal;
  depthQualitySignals: EditorialQualitySignal;
  audienceAlignmentSignals: EditorialQualitySignal;
  operationalRealismSignals: EditorialQualitySignal;
  antiRepetitionSignals: EditorialQualitySignal;
  transitionQualitySignals: EditorialQualitySignal;
  readerStateProgressionSignals: EditorialQualitySignal;
  strategicTensionSignals: EditorialQualitySignal;
  claimQualificationSignals: EditorialQualitySignal;
  behavioralConsistencySignals: EditorialQualitySignal;
  editorialRiskSignals: readonly string[];
  sectionQualitySignals: readonly SectionEditorialQualitySignal[];
  signalSummary: {
    overallRisk: EditorialQualitySignalRisk;
    strongestSignals: readonly string[];
    weakestSignals: readonly string[];
    highRiskSignals: number;
    mediumRiskSignals: number;
    confidence: EditorialQualitySignalConfidence;
  };
}

export interface EditorialQualitySignalInput {
  editorialDiagnostics: EditorialDiagnosticReport;
  behavioralAdherenceDiagnostics: BehavioralAdherenceDiagnosticReport;
  generatorBehavioralSteering: GeneratorBehavioralSteering;
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

function confidenceRank(confidence: EditorialQualitySignalConfidence): number {
  return confidence === 'high' ? 3 : confidence === 'medium' ? 2 : 1;
}

function maxRisk(dimensions: readonly SourceDimension[]): EditorialQualitySignalRisk {
  if (dimensions.some((dimension) => dimension.risk === 'high')) return 'high';
  if (dimensions.some((dimension) => dimension.risk === 'medium')) return 'medium';
  return 'low';
}

function minConfidence(dimensions: readonly SourceDimension[]): EditorialQualitySignalConfidence {
  if (!dimensions.length) return 'low';
  if (dimensions.some((dimension) => dimension.confidence === 'low')) return 'low';
  if (dimensions.some((dimension) => dimension.confidence === 'medium')) return 'medium';
  return 'high';
}

function signalStrength(dimensions: readonly SourceDimension[]): EditorialQualitySignalStrength {
  if (!dimensions.length) return 'weak';
  const aligned = dimensions.filter((dimension) => dimension.aligned).length;
  const ratio = aligned / dimensions.length;
  if (ratio >= 0.75) return 'strong';
  if (ratio >= 0.4) return 'moderate';
  return 'weak';
}

function buildSignal(input: {
  dimensions: readonly SourceDimension[];
  sourceDimensions: readonly string[];
  sectionsAffected: readonly number[];
  extraRiskIndicators?: readonly string[];
  extraIndicators?: readonly string[];
}): EditorialQualitySignal {
  const riskIndicators = unique([
    ...input.dimensions.flatMap((dimension) => dimension.driftIndicators),
    ...(input.extraRiskIndicators || []),
  ]);
  return {
    aligned: input.dimensions.length > 0 && input.dimensions.every((dimension) => dimension.aligned),
    risk: maxRisk(input.dimensions),
    confidence: minConfidence(input.dimensions),
    signalStrength: signalStrength(input.dimensions),
    indicators: unique([
      ...input.dimensions.flatMap((dimension) => dimension.indicators),
      ...(input.extraIndicators || []),
    ], 10),
    riskIndicators,
    sourceDimensions: unique(input.sourceDimensions, 8),
    sectionsAffected: Array.from(new Set(input.sectionsAffected)).sort((a, b) => a - b),
  };
}

function trueDriftKeys(driftIndicators: Record<string, boolean>): string[] {
  return Object.entries(driftIndicators)
    .filter(([, active]) => active)
    .map(([key]) => key);
}

function sectionDimensions(input: EditorialQualitySignalInput, sectionIndex: number): SourceDimension[] {
  const editorial = input.editorialDiagnostics.sections.find((section) => section.sectionIndex === sectionIndex);
  const behavioral = input.behavioralAdherenceDiagnostics.sections.find((section) => section.sectionIndex === sectionIndex);
  return [
    editorial?.sectionRoleAlignment,
    editorial?.narrativeStageAlignment,
    editorial?.readerStateProgression,
    editorial?.repetitionRisk,
    editorial?.frameworkReuseRisk,
    editorial?.genericFramingRisk,
    editorial?.proofBehaviorAlignment,
    editorial?.transitionAlignment,
    editorial?.sectionDifferentiationAlignment,
    behavioral?.behavioralPriorityAlignment,
    behavioral?.narrativeBehaviorAlignment,
    behavioral?.authorityBehaviorAlignment,
    behavioral?.depthBehaviorAlignment,
    behavioral?.audienceBehaviorAlignment,
    behavioral?.antiRepetitionBehaviorAlignment,
    behavioral?.claimQualificationBehaviorAlignment,
    behavioral?.operationalRealismBehaviorAlignment,
    behavioral?.readerStateBehaviorAlignment,
    behavioral?.strategicTensionBehaviorAlignment,
  ].filter((dimension): dimension is SourceDimension => Boolean(dimension));
}

function affectedSections(
  sections: readonly { sectionIndex: number }[],
  dimensionsBySection: (sectionIndex: number) => readonly SourceDimension[],
): number[] {
  return sections
    .filter((section) => dimensionsBySection(section.sectionIndex).some((dimension) => dimension.risk !== 'low' || !dimension.aligned))
    .map((section) => section.sectionIndex);
}

export function buildEditorialQualitySignals(input: EditorialQualitySignalInput): EditorialQualitySignalReport {
  const editorialSections = input.editorialDiagnostics.sections;
  const behavioralSections = input.behavioralAdherenceDiagnostics.sections;
  const allSectionIndexes = Array.from(new Set([
    ...editorialSections.map((section) => section.sectionIndex),
    ...behavioralSections.map((section) => section.sectionIndex),
  ])).sort((a, b) => a - b);

  const narrativeQualitySignals = buildSignal({
    dimensions: [
      ...editorialSections.map((section) => section.narrativeStageAlignment),
      ...behavioralSections.map((section) => section.narrativeBehaviorAlignment),
    ],
    sourceDimensions: ['narrativeStageAlignment', 'narrativeBehaviorAlignment'],
    sectionsAffected: affectedSections(editorialSections, (sectionIndex) => [
      editorialSections.find((section) => section.sectionIndex === sectionIndex)?.narrativeStageAlignment,
      behavioralSections.find((section) => section.sectionIndex === sectionIndex)?.narrativeBehaviorAlignment,
    ].filter((dimension): dimension is SourceDimension => Boolean(dimension))),
    extraRiskIndicators: trueDriftKeys({ collapsedNarrativeProgression: input.editorialDiagnostics.driftIndicators.collapsedNarrativeProgression }),
    extraIndicators: input.generatorRuntimeAlignment.runtimeNarrativeSequence,
  });

  const authorityQualitySignals = buildSignal({
    dimensions: [
      ...editorialSections.map((section) => section.proofBehaviorAlignment),
      ...behavioralSections.map((section) => section.authorityBehaviorAlignment),
    ],
    sourceDimensions: ['proofBehaviorAlignment', 'authorityBehaviorAlignment'],
    sectionsAffected: affectedSections(behavioralSections, (sectionIndex) => [
      editorialSections.find((section) => section.sectionIndex === sectionIndex)?.proofBehaviorAlignment,
      behavioralSections.find((section) => section.sectionIndex === sectionIndex)?.authorityBehaviorAlignment,
    ].filter((dimension): dimension is SourceDimension => Boolean(dimension))),
    extraRiskIndicators: trueDriftKeys({ weakAuthorityDiscipline: input.behavioralAdherenceDiagnostics.driftIndicators.weakAuthorityDiscipline }),
    extraIndicators: input.generatorRuntimeAlignment.runtimeAuthorityTargets,
  });

  const depthQualitySignals = buildSignal({
    dimensions: behavioralSections.map((section) => section.depthBehaviorAlignment),
    sourceDimensions: ['depthBehaviorAlignment'],
    sectionsAffected: affectedSections(behavioralSections, (sectionIndex) => [
      behavioralSections.find((section) => section.sectionIndex === sectionIndex)?.depthBehaviorAlignment,
    ].filter((dimension): dimension is SourceDimension => Boolean(dimension))),
    extraIndicators: input.generatorRuntimeAlignment.runtimeDepthTargets,
  });

  const audienceAlignmentSignals = buildSignal({
    dimensions: behavioralSections.map((section) => section.audienceBehaviorAlignment),
    sourceDimensions: ['audienceBehaviorAlignment'],
    sectionsAffected: affectedSections(behavioralSections, (sectionIndex) => [
      behavioralSections.find((section) => section.sectionIndex === sectionIndex)?.audienceBehaviorAlignment,
    ].filter((dimension): dimension is SourceDimension => Boolean(dimension))),
    extraRiskIndicators: trueDriftKeys({ audienceSophisticationDrift: input.behavioralAdherenceDiagnostics.driftIndicators.audienceSophisticationDrift }),
    extraIndicators: input.generatorBehavioralSteering.audienceBehaviorSignals,
  });

  const operationalRealismSignals = buildSignal({
    dimensions: behavioralSections.map((section) => section.operationalRealismBehaviorAlignment),
    sourceDimensions: ['operationalRealismBehaviorAlignment'],
    sectionsAffected: affectedSections(behavioralSections, (sectionIndex) => [
      behavioralSections.find((section) => section.sectionIndex === sectionIndex)?.operationalRealismBehaviorAlignment,
    ].filter((dimension): dimension is SourceDimension => Boolean(dimension))),
    extraRiskIndicators: trueDriftKeys({ weakOperationalRealism: input.behavioralAdherenceDiagnostics.driftIndicators.weakOperationalRealism }),
    extraIndicators: input.generatorBehavioralSteering.operationalRealismBehaviorSignals,
  });

  const antiRepetitionSignals = buildSignal({
    dimensions: [
      ...editorialSections.flatMap((section) => [section.repetitionRisk, section.frameworkReuseRisk, section.sectionDifferentiationAlignment]),
      ...behavioralSections.map((section) => section.antiRepetitionBehaviorAlignment),
    ],
    sourceDimensions: ['repetitionRisk', 'frameworkReuseRisk', 'sectionDifferentiationAlignment', 'antiRepetitionBehaviorAlignment'],
    sectionsAffected: allSectionIndexes.filter((sectionIndex) => sectionDimensions(input, sectionIndex).some((dimension) => (
      dimension.driftIndicators.includes('repeated behavioral pattern')
      || dimension.driftIndicators.includes('repeated direct-answer shape')
      || dimension.driftIndicators.includes('repeated section intent')
      || dimension.driftIndicators.includes('weak section differentiation')
    ))),
    extraRiskIndicators: trueDriftKeys({
      repeatedDirectAnswerShape: input.editorialDiagnostics.driftIndicators.repeatedDirectAnswerShape,
      repeatedBehavioralPatterns: input.behavioralAdherenceDiagnostics.driftIndicators.repeatedBehavioralPatterns,
      repeatedSectionIntent: input.editorialDiagnostics.driftIndicators.repeatedSectionIntent,
    }),
    extraIndicators: input.generatorRuntimeAlignment.runtimeAntiRepetitionSignals,
  });

  const transitionQualitySignals = buildSignal({
    dimensions: [
      ...editorialSections.map((section) => section.transitionAlignment),
      ...behavioralSections.map((section) => section.transitionBehaviorAlignment),
    ],
    sourceDimensions: ['transitionAlignment', 'transitionBehaviorAlignment'],
    sectionsAffected: affectedSections(editorialSections, (sectionIndex) => [
      editorialSections.find((section) => section.sectionIndex === sectionIndex)?.transitionAlignment,
      behavioralSections.find((section) => section.sectionIndex === sectionIndex)?.transitionBehaviorAlignment,
    ].filter((dimension): dimension is SourceDimension => Boolean(dimension))),
    extraRiskIndicators: trueDriftKeys({ repetitiveTransitionBehavior: input.behavioralAdherenceDiagnostics.driftIndicators.repetitiveTransitionBehavior }),
    extraIndicators: input.generatorRuntimeAlignment.runtimeTransitionTargets,
  });

  const readerStateProgressionSignals = buildSignal({
    dimensions: [
      ...editorialSections.map((section) => section.readerStateProgression),
      ...behavioralSections.map((section) => section.readerStateBehaviorAlignment),
    ],
    sourceDimensions: ['readerStateProgression', 'readerStateBehaviorAlignment'],
    sectionsAffected: affectedSections(editorialSections, (sectionIndex) => [
      editorialSections.find((section) => section.sectionIndex === sectionIndex)?.readerStateProgression,
      behavioralSections.find((section) => section.sectionIndex === sectionIndex)?.readerStateBehaviorAlignment,
    ].filter((dimension): dimension is SourceDimension => Boolean(dimension))),
    extraRiskIndicators: trueDriftKeys({
      missingReaderStateMovement: input.editorialDiagnostics.driftIndicators.missingReaderStateMovement,
      flatReaderStateMovement: input.behavioralAdherenceDiagnostics.driftIndicators.flatReaderStateMovement,
    }),
    extraIndicators: input.generatorRuntimeAlignment.runtimeReaderStateTargets,
  });

  const strategicTensionSignals = buildSignal({
    dimensions: [
      ...editorialSections.map((section) => section.genericFramingRisk),
      ...editorialSections.map((section) => section.doctrineAlignment),
      ...behavioralSections.map((section) => section.strategicTensionBehaviorAlignment),
    ],
    sourceDimensions: ['genericFramingRisk', 'doctrineAlignment', 'strategicTensionBehaviorAlignment'],
    sectionsAffected: allSectionIndexes.filter((sectionIndex) => sectionDimensions(input, sectionIndex).some((dimension) => (
      dimension.driftIndicators.includes('generic strategic framing')
      || dimension.driftIndicators.includes('generic SaaS framing')
      || dimension.driftIndicators.includes('missing strategic tension')
      || dimension.driftIndicators.includes('doctrine drift')
    ))),
    extraRiskIndicators: trueDriftKeys({
      genericSaasFraming: input.editorialDiagnostics.driftIndicators.genericSaasFraming,
      genericStrategicFraming: input.behavioralAdherenceDiagnostics.driftIndicators.genericStrategicFraming,
      missingStrategicTension: input.behavioralAdherenceDiagnostics.driftIndicators.missingStrategicTension,
      doctrineDrift: input.editorialDiagnostics.driftIndicators.doctrineDrift,
    }),
    extraIndicators: input.generatorBehavioralSteering.strategicTensionBehaviorSignals,
  });

  const claimQualificationSignals = buildSignal({
    dimensions: behavioralSections.map((section) => section.claimQualificationBehaviorAlignment),
    sourceDimensions: ['claimQualificationBehaviorAlignment'],
    sectionsAffected: affectedSections(behavioralSections, (sectionIndex) => [
      behavioralSections.find((section) => section.sectionIndex === sectionIndex)?.claimQualificationBehaviorAlignment,
    ].filter((dimension): dimension is SourceDimension => Boolean(dimension))),
    extraRiskIndicators: trueDriftKeys({ shallowProofBehavior: input.behavioralAdherenceDiagnostics.driftIndicators.shallowProofBehavior }),
    extraIndicators: input.generatorRuntimeAlignment.runtimeClaimQualificationTargets,
  });

  const behavioralConsistencySignals = buildSignal({
    dimensions: [
      ...editorialSections.map((section) => section.sectionRoleAlignment),
      ...editorialSections.map((section) => section.sectionDifferentiationAlignment),
      ...behavioralSections.map((section) => section.behavioralPriorityAlignment),
    ],
    sourceDimensions: ['sectionRoleAlignment', 'sectionDifferentiationAlignment', 'behavioralPriorityAlignment'],
    sectionsAffected: allSectionIndexes.filter((sectionIndex) => sectionDimensions(input, sectionIndex).some((dimension) => (
      dimension.driftIndicators.includes('behavioral priority drift')
      || dimension.driftIndicators.includes('weak section differentiation')
      || dimension.driftIndicators.includes('role mismatch')
    ))),
    extraIndicators: input.generatorBehavioralSteering.sectionBehavioralPriorities.map((section) => section.primaryBehavior),
  });

  const namedSignals = {
    narrativeQualitySignals,
    authorityQualitySignals,
    depthQualitySignals,
    audienceAlignmentSignals,
    operationalRealismSignals,
    antiRepetitionSignals,
    transitionQualitySignals,
    readerStateProgressionSignals,
    strategicTensionSignals,
    claimQualificationSignals,
    behavioralConsistencySignals,
  };

  const editorialRiskSignals = unique([
    ...input.editorialDiagnostics.riskFlags,
    ...input.behavioralAdherenceDiagnostics.riskFlags,
    ...trueDriftKeys(input.editorialDiagnostics.driftIndicators),
    ...trueDriftKeys(input.behavioralAdherenceDiagnostics.driftIndicators),
    ...Object.values(namedSignals).flatMap((signal) => signal.riskIndicators),
  ], 40);

  const sectionQualitySignals = allSectionIndexes.map((sectionIndex): SectionEditorialQualitySignal => {
    const editorial = editorialSections.find((section) => section.sectionIndex === sectionIndex);
    const behavioral = behavioralSections.find((section) => section.sectionIndex === sectionIndex);
    const dimensions = sectionDimensions(input, sectionIndex);
    const riskFlags = unique([
      ...(editorial?.riskFlags || []),
      ...(behavioral?.behavioralRiskFlags || []),
      ...dimensions.flatMap((dimension) => dimension.driftIndicators),
    ], 10);
    return {
      sectionIndex,
      progressionStage: behavioral?.progressionStage || editorial?.progressionStage || input.generatorBehavioralSteering.sectionBehavioralPriorities[sectionIndex]?.progressionStage || 'diagnose',
      narrativeRole: behavioral?.narrativeRole || editorial?.narrativeRole || input.generatorBehavioralSteering.sectionBehavioralPriorities[sectionIndex]?.narrativeRole || 'problem_diagnosis',
      alignedDimensions: dimensions.filter((dimension) => dimension.aligned).length,
      totalDimensions: dimensions.length,
      dominantRisk: maxRisk(dimensions),
      qualityRiskFlags: riskFlags,
    };
  });

  const signalEntries = Object.entries(namedSignals);
  const highRiskSignals = signalEntries.filter(([, signal]) => signal.risk === 'high').length;
  const mediumRiskSignals = signalEntries.filter(([, signal]) => signal.risk === 'medium').length;
  const confidence = signalEntries.some(([, signal]) => confidenceRank(signal.confidence) === 1)
    ? 'low'
    : signalEntries.some(([, signal]) => confidenceRank(signal.confidence) === 2)
      ? 'medium'
      : 'high';

  return {
    version: 'editorial-quality-signals-v1',
    generatedAt: new Date(0).toISOString(),
    contentType: input.editorialDiagnostics.contentType,
    topic: input.editorialDiagnostics.topic,
    ...namedSignals,
    editorialRiskSignals,
    sectionQualitySignals,
    signalSummary: {
      overallRisk: highRiskSignals > 0 ? 'high' : mediumRiskSignals > 3 ? 'medium' : 'low',
      strongestSignals: signalEntries.filter(([, signal]) => signal.signalStrength === 'strong').map(([name]) => name),
      weakestSignals: signalEntries.filter(([, signal]) => signal.signalStrength === 'weak' || signal.risk === 'high').map(([name]) => name),
      highRiskSignals,
      mediumRiskSignals,
      confidence,
    },
  };
}

export function serializeEditorialQualitySignals(report: EditorialQualitySignalReport): string {
  const signalSummary = [
    ['narrative', report.narrativeQualitySignals],
    ['authority', report.authorityQualitySignals],
    ['depth', report.depthQualitySignals],
    ['audience', report.audienceAlignmentSignals],
    ['operational realism', report.operationalRealismSignals],
    ['anti-repetition', report.antiRepetitionSignals],
    ['transition', report.transitionQualitySignals],
    ['reader state', report.readerStateProgressionSignals],
    ['strategic tension', report.strategicTensionSignals],
    ['claim qualification', report.claimQualificationSignals],
    ['behavioral consistency', report.behavioralConsistencySignals],
  ].map(([label, signal]) => `${label}: risk=${(signal as EditorialQualitySignal).risk}; strength=${(signal as EditorialQualitySignal).signalStrength}`);

  return [
    '## EDITORIAL QUALITY SIGNALS',
    `Version: ${report.version}`,
    `Topic: ${report.topic}`,
    `Content type: ${report.contentType}`,
    `Overall risk: ${report.signalSummary.overallRisk}`,
    `Risk signals: ${report.editorialRiskSignals.join('; ') || 'none'}`,
    'Signal summary:',
    ...signalSummary,
  ].join('\n');
}
