import type { EditorialRuntimeContext } from './editorialRuntimeContextPrioritizer';
import type { GeneratorBehavioralSteering, SectionBehavioralPriority } from './generatorBehavioralSteering';
import type { GeneratorRuntimeAlignment } from './generatorRuntimeAlignment';
import type { NarrativePlanningSection, NarrativeProgressionStage } from './narrativePlanningEngine';
import type { UnifiedEditorialBrief } from './unifiedEditorialBriefAssembler';

export type BehavioralAdherenceRisk = 'low' | 'medium' | 'high';
export type BehavioralAdherenceConfidence = 'low' | 'medium' | 'high';

export interface BehavioralDiagnosticDimension {
  aligned: boolean;
  risk: BehavioralAdherenceRisk;
  confidence: BehavioralAdherenceConfidence;
  summary: string;
  indicators: readonly string[];
  driftIndicators: readonly string[];
}

export interface SectionBehavioralDiagnostic {
  sectionIndex: number;
  progressionStage: NarrativeProgressionStage;
  narrativeRole: NarrativePlanningSection['narrativeRole'];
  behavioralPriorityAlignment: BehavioralDiagnosticDimension;
  narrativeBehaviorAlignment: BehavioralDiagnosticDimension;
  authorityBehaviorAlignment: BehavioralDiagnosticDimension;
  depthBehaviorAlignment: BehavioralDiagnosticDimension;
  audienceBehaviorAlignment: BehavioralDiagnosticDimension;
  transitionBehaviorAlignment: BehavioralDiagnosticDimension;
  antiRepetitionBehaviorAlignment: BehavioralDiagnosticDimension;
  claimQualificationBehaviorAlignment: BehavioralDiagnosticDimension;
  operationalRealismBehaviorAlignment: BehavioralDiagnosticDimension;
  readerStateBehaviorAlignment: BehavioralDiagnosticDimension;
  strategicTensionBehaviorAlignment: BehavioralDiagnosticDimension;
  behavioralRiskFlags: readonly string[];
}

export interface BehavioralAdherenceDiagnosticReport {
  version: 'behavioral-adherence-diagnostics-v1';
  generatedAt: string;
  contentType: string;
  topic: string;
  riskFlags: readonly string[];
  alignmentSummary: {
    overallRisk: BehavioralAdherenceRisk;
    observedSections: number;
    expectedSections: number;
    highRiskDimensions: number;
    mediumRiskDimensions: number;
    confidence: BehavioralAdherenceConfidence;
  };
  driftIndicators: {
    collapsedNarrativeBehavior: boolean;
    repeatedBehavioralPatterns: boolean;
    weakOperationalRealism: boolean;
    weakAuthorityDiscipline: boolean;
    audienceSophisticationDrift: boolean;
    flatReaderStateMovement: boolean;
    genericStrategicFraming: boolean;
    repetitiveTransitionBehavior: boolean;
    shallowProofBehavior: boolean;
    missingStrategicTension: boolean;
  };
  sections: readonly SectionBehavioralDiagnostic[];
}

export interface BehavioralAdherenceDiagnosticInput {
  generatedContent: {
    title?: string;
    excerpt?: string;
    content_html?: string;
    content_blocks?: unknown[];
    key_insights?: readonly string[];
  };
  generatorBehavioralSteering: GeneratorBehavioralSteering;
  generatorRuntimeAlignment: GeneratorRuntimeAlignment;
  unifiedEditorialBrief: UnifiedEditorialBrief;
  editorialRuntimeContext?: EditorialRuntimeContext;
}

const NARRATIVE_MARKERS: Record<NarrativeProgressionStage, readonly RegExp[]> = {
  diagnose: [/\btension\b/i, /\bpain\b/i, /\bproblem\b/i, /\bcause\b/i, /\bstakes\b/i],
  reframe: [/\breframe\b/i, /\bassumption\b/i, /\binstead\b/i, /\bdefault\b/i, /\bbelief\b/i],
  expand: [/\bmechanism\b/i, /\bdistinction\b/i, /\bimplication\b/i, /\bcausal\b/i],
  operationalize: [/\bworkflow\b/i, /\bdecision\b/i, /\bowner\b/i, /\bcheck\b/i, /\btrade-?off\b/i],
  validate: [/\bproof\b/i, /\bevidence\b/i, /\bconstraint\b/i, /\bscenario\b/i, /\bexample\b/i],
  resolve: [/\btherefore\b/i, /\bultimately\b/i, /\boperating implication\b/i, /\btakeaway\b/i],
};

const AUTHORITY_MARKERS = [/\bevidence\b/i, /\bproof\b/i, /\bconstraint\b/i, /\bqualif/i, /\bscenario\b/i, /\bobserved\b/i];
const OPERATIONAL_MARKERS = [/\bworkflow\b/i, /\bdecision\b/i, /\bowner\b/i, /\bhandoff\b/i, /\breview\b/i, /\bconstraint\b/i, /\btrade-?off\b/i, /\bcheck\b/i];
const AUDIENCE_MARKERS = [/\boperator\b/i, /\bleader\b/i, /\bexecutive\b/i, /\bmanager\b/i, /\bstakeholder\b/i, /\bteam\b/i];
const CLAIM_QUALIFICATION_MARKERS = [/\bwhen\b/i, /\bunless\b/i, /\bwithout\b/i, /\bconstraint\b/i, /\bqualif/i, /\bnot universal\b/i, /\bdepends\b/i];
const GENERIC_STRATEGIC_MARKERS = [/\bleverage\b/i, /\bunlock\b/i, /\bdrive growth\b/i, /\bbest practices\b/i, /\bseamless\b/i, /\binnovative\b/i];
const TRANSITION_MARKERS = [/\btherefore\b/i, /\bnext\b/i, /\bthis leads\b/i, /\bfrom here\b/i, /\bso\b/i, /\bultimately\b/i];

function cleanText(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    : '';
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function tokens(value: string): string[] {
  return Array.from(new Set(normalize(value).split(/\s+/).filter((token) => token.length >= 4)));
}

function flattenBlocks(blocks: unknown[]): string[] {
  const output: string[] = [];
  const visit = (block: unknown): void => {
    if (!block || typeof block !== 'object') return;
    const record = block as Record<string, unknown>;
    for (const key of ['text', 'html', 'body', 'title', 'quote', 'caption']) {
      const text = cleanText(record[key]);
      if (text) output.push(text);
    }
    if (Array.isArray(record.items)) {
      for (const item of record.items) {
        if (typeof item === 'string') output.push(cleanText(item));
        else visit(item);
      }
    }
    if (Array.isArray(record.children)) {
      for (const child of record.children) visit(child);
    }
  };
  for (const block of blocks) visit(block);
  return output;
}

function extractText(input: BehavioralAdherenceDiagnosticInput['generatedContent']): string {
  return [
    input.title,
    input.excerpt,
    input.content_html,
    ...(Array.isArray(input.key_insights) ? input.key_insights : []),
    ...(Array.isArray(input.content_blocks) ? flattenBlocks(input.content_blocks) : []),
  ].map(cleanText).filter(Boolean).join('\n\n');
}

function splitSections(input: BehavioralAdherenceDiagnosticInput['generatedContent'], plannedCount: number): string[] {
  const html = typeof input.content_html === 'string' ? input.content_html : '';
  const htmlSections = html
    .split(/<h2[^>]*>|<h3[^>]*>/i)
    .map(cleanText)
    .filter((section) => section.split(/\s+/).length >= 10);
  if (htmlSections.length > 0) return htmlSections.slice(0, plannedCount);

  if (Array.isArray(input.content_blocks)) {
    const sections: string[] = [];
    let current: string[] = [];
    for (const block of input.content_blocks) {
      const record = block && typeof block === 'object' ? block as Record<string, unknown> : {};
      const type = String(record.type || '');
      if ((type === 'heading' || type === 'section_heading') && current.length > 0) {
        sections.push(current.join(' '));
        current = [];
      }
      const text = flattenBlocks([block]).join(' ');
      if (text) current.push(text);
    }
    if (current.length > 0) sections.push(current.join(' '));
    if (sections.length > 1) return sections.slice(0, plannedCount);
  }

  const text = extractText(input);
  if (!text) return [];
  const paragraphs = text.split(/\n{2,}/).map(cleanText).filter(Boolean);
  if (paragraphs.length <= plannedCount) return paragraphs;
  const perSection = Math.ceil(paragraphs.length / plannedCount);
  return Array.from({ length: plannedCount }, (_, index) => paragraphs.slice(index * perSection, (index + 1) * perSection).join(' ')).filter(Boolean);
}

function countMatches(text: string, patterns: readonly RegExp[]): number {
  return patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
}

function keywordHits(text: string, values: readonly string[]): string[] {
  const haystack = normalize(text);
  return values.filter((value) => {
    const valueTokens = tokens(value);
    if (valueTokens.length === 0) return false;
    const hits = valueTokens.filter((token) => haystack.includes(token)).length;
    return hits >= Math.min(2, valueTokens.length);
  });
}

function makeDimension(input: {
  aligned: boolean;
  risk: BehavioralAdherenceRisk;
  confidence?: BehavioralAdherenceConfidence;
  summary: string;
  indicators?: readonly string[];
  driftIndicators?: readonly string[];
}): BehavioralDiagnosticDimension {
  return {
    aligned: input.aligned,
    risk: input.risk,
    confidence: input.confidence ?? 'medium',
    summary: input.summary,
    indicators: input.indicators ?? [],
    driftIndicators: input.driftIndicators ?? [],
  };
}

function allDimensionValues(section: SectionBehavioralDiagnostic): BehavioralDiagnosticDimension[] {
  return [
    section.behavioralPriorityAlignment,
    section.narrativeBehaviorAlignment,
    section.authorityBehaviorAlignment,
    section.depthBehaviorAlignment,
    section.audienceBehaviorAlignment,
    section.transitionBehaviorAlignment,
    section.antiRepetitionBehaviorAlignment,
    section.claimQualificationBehaviorAlignment,
    section.operationalRealismBehaviorAlignment,
    section.readerStateBehaviorAlignment,
    section.strategicTensionBehaviorAlignment,
  ];
}

function repeatedShape(text: string): string {
  const firstSentence = cleanText(text).split(/[.!?]/).map((sentence) => sentence.trim()).find(Boolean) || '';
  return normalize(firstSentence.replace(/^[A-Z0-9]\s+/i, '')).slice(0, 50);
}

function dimensionFromHits(input: {
  hits: readonly string[];
  minimum?: number;
  successSummary: string;
  failureSummary: string;
  drift: string;
}): BehavioralDiagnosticDimension {
  const minimum = input.minimum ?? 1;
  const aligned = input.hits.length >= minimum;
  return makeDimension({
    aligned,
    risk: aligned ? 'low' : 'medium',
    summary: aligned ? input.successSummary : input.failureSummary,
    indicators: input.hits.slice(0, 5),
    driftIndicators: aligned ? [] : [input.drift],
  });
}

export function observeBehavioralAdherenceDiagnostics(
  input: BehavioralAdherenceDiagnosticInput,
): BehavioralAdherenceDiagnosticReport {
  const expectedSections = input.generatorBehavioralSteering.sectionBehavioralPriorities.length;
  const sectionsText = splitSections(input.generatedContent, expectedSections);
  const fullText = extractText(input.generatedContent);
  const sectionShapes = sectionsText.map(repeatedShape).filter(Boolean);
  const repeatedBehavioralPatterns = new Set(sectionShapes).size < sectionShapes.length;
  const transitionShapeCount = sectionsText.filter((section) => countMatches(section, TRANSITION_MARKERS) > 0).length;

  const diagnostics = input.generatorBehavioralSteering.sectionBehavioralPriorities.map((steering, index): SectionBehavioralDiagnostic => {
    const sectionText = sectionsText[index] || '';
    const alignmentSection = input.generatorRuntimeAlignment.sectionRuntimeObjectives.find((section) => section.sectionIndex === steering.sectionIndex);
    const briefSection = input.unifiedEditorialBrief.sections.find((section) => section.sectionIndex === steering.sectionIndex);
    const priorityHits = keywordHits(sectionText, steering.behavioralPriorities);
    const narrativeHitCount = countMatches(sectionText, NARRATIVE_MARKERS[steering.progressionStage]);
    const authorityMarkerCount = countMatches(sectionText, AUTHORITY_MARKERS);
    const authorityHits = keywordHits(sectionText, steering.authorityBehaviorSignals);
    const depthHits = keywordHits(sectionText, steering.depthBehaviorSignals);
    const audienceHits = keywordHits(sectionText, steering.audienceBehaviorSignals);
    const operationalMarkerCount = countMatches(sectionText, OPERATIONAL_MARKERS);
    const operationalHits = keywordHits(sectionText, steering.operationalRealismBehaviorSignals);
    const claimMarkerCount = countMatches(sectionText, CLAIM_QUALIFICATION_MARKERS);
    const claimHits = keywordHits(sectionText, steering.claimQualificationBehaviorSignals);
    const readerHits = keywordHits(sectionText, steering.readerStateBehaviorSignals);
    const strategicHits = keywordHits(sectionText, steering.strategicTensionBehaviorSignals);
    const genericStrategicCount = countMatches(sectionText, GENERIC_STRATEGIC_MARKERS);
    const transitionHitCount = countMatches(sectionText, TRANSITION_MARKERS);
    const antiRepetitionHits = keywordHits(sectionText, steering.antiRepetitionBehaviorSignals);
    const shape = repeatedShape(sectionText);
    const repeatedShapeRisk = Boolean(shape && sectionShapes.filter((candidate) => candidate === shape).length > 1);

    const behavioralPriorityAlignment = dimensionFromHits({
      hits: priorityHits,
      successSummary: 'Behavioral priorities are visibly reflected.',
      failureSummary: 'Section does not visibly follow its behavioral priorities.',
      drift: 'behavioral priority drift',
    });

    const narrativeBehaviorAlignment = makeDimension({
      aligned: narrativeHitCount > 0,
      risk: narrativeHitCount > 0 ? 'low' : 'medium',
      summary: narrativeHitCount > 0 ? 'Narrative behavior markers are visible.' : 'Narrative behavior appears collapsed or generic.',
      indicators: [`stage marker count: ${narrativeHitCount}`],
      driftIndicators: narrativeHitCount > 0 ? [] : ['collapsed narrative behavior'],
    });

    const authorityBehaviorAlignment = makeDimension({
      aligned: authorityMarkerCount > 0 || authorityHits.length > 0,
      risk: authorityMarkerCount > 0 || authorityHits.length > 0 ? 'low' : 'medium',
      summary: authorityMarkerCount > 0 || authorityHits.length > 0 ? 'Authority discipline is visible.' : 'Authority behavior is weak or unsupported.',
      indicators: [...authorityHits, `authority marker count: ${authorityMarkerCount}`].slice(0, 5),
      driftIndicators: authorityMarkerCount > 0 || authorityHits.length > 0 ? [] : ['weak authority discipline'],
    });

    const depthBehaviorAlignment = dimensionFromHits({
      hits: depthHits,
      successSummary: 'Depth behavior signals are visible.',
      failureSummary: 'Depth behavior is thin or detached from steering.',
      drift: 'weak depth behavior',
    });

    const audienceBehaviorAlignment = makeDimension({
      aligned: audienceHits.length > 0 || countMatches(sectionText, AUDIENCE_MARKERS) > 0,
      risk: audienceHits.length > 0 || countMatches(sectionText, AUDIENCE_MARKERS) > 0 ? 'low' : 'medium',
      summary: audienceHits.length > 0 ? 'Audience calibration is visible.' : 'Audience sophistication is weak or generic.',
      indicators: audienceHits.slice(0, 5),
      driftIndicators: audienceHits.length > 0 || countMatches(sectionText, AUDIENCE_MARKERS) > 0 ? [] : ['audience sophistication drift'],
    });

    const transitionBehaviorAlignment = makeDimension({
      aligned: index === expectedSections - 1 || transitionHitCount > 0 || keywordHits(sectionText, [alignmentSection?.transitionTarget || '']).length > 0,
      risk: index === expectedSections - 1 || transitionHitCount > 0 ? 'low' : 'medium',
      summary: index === expectedSections - 1 || transitionHitCount > 0 ? 'Transition behavior is visible or not required.' : 'Transition behavior is weak.',
      indicators: [`transition marker count: ${transitionHitCount}`],
      driftIndicators: index === expectedSections - 1 || transitionHitCount > 0 ? [] : ['repetitive or weak transition behavior'],
    });

    const antiRepetitionBehaviorAlignment = makeDimension({
      aligned: !repeatedShapeRisk,
      risk: repeatedShapeRisk ? 'high' : antiRepetitionHits.length > 0 ? 'low' : 'medium',
      summary: repeatedShapeRisk ? 'Section repeats a behavioral opening shape.' : 'No repeated behavioral shape detected.',
      indicators: antiRepetitionHits.slice(0, 4),
      driftIndicators: repeatedShapeRisk ? ['repeated behavioral pattern'] : [],
    });

    const claimQualificationBehaviorAlignment = makeDimension({
      aligned: claimMarkerCount > 0 || claimHits.length > 0 || steering.progressionStage !== 'validate',
      risk: claimMarkerCount > 0 || claimHits.length > 0 ? 'low' : steering.progressionStage === 'validate' ? 'high' : 'medium',
      summary: claimMarkerCount > 0 || claimHits.length > 0 ? 'Claim qualification behavior is visible.' : 'Claim qualification is weak.',
      indicators: [...claimHits, `claim marker count: ${claimMarkerCount}`].slice(0, 5),
      driftIndicators: claimMarkerCount > 0 || claimHits.length > 0 ? [] : ['shallow proof behavior'],
    });

    const operationalRealismBehaviorAlignment = makeDimension({
      aligned: operationalMarkerCount > 0 || operationalHits.length > 0,
      risk: operationalMarkerCount > 0 || operationalHits.length > 0 ? 'low' : 'medium',
      summary: operationalMarkerCount > 0 || operationalHits.length > 0 ? 'Operational realism is visible.' : 'Operational realism is weak.',
      indicators: [...operationalHits, `operational marker count: ${operationalMarkerCount}`].slice(0, 5),
      driftIndicators: operationalMarkerCount > 0 || operationalHits.length > 0 ? [] : ['weak operational realism'],
    });

    const readerStateBehaviorAlignment = makeDimension({
      aligned: readerHits.length > 0 || keywordHits(sectionText, [briefSection?.sectionReaderStateTarget || '']).length > 0,
      risk: readerHits.length > 0 ? 'low' : 'medium',
      summary: readerHits.length > 0 ? 'Reader-state behavior is visible.' : 'Reader-state movement appears flat.',
      indicators: readerHits.slice(0, 5),
      driftIndicators: readerHits.length > 0 ? [] : ['flat reader-state movement'],
    });

    const strategicTensionBehaviorAlignment = makeDimension({
      aligned: strategicHits.length > 0 && genericStrategicCount === 0,
      risk: genericStrategicCount > 0 ? 'high' : strategicHits.length > 0 ? 'low' : 'medium',
      summary: strategicHits.length > 0 ? 'Strategic tension is visible.' : 'Strategic tension is missing or generic.',
      indicators: strategicHits.slice(0, 5),
      driftIndicators: genericStrategicCount > 0 ? ['generic strategic framing'] : strategicHits.length === 0 ? ['missing strategic tension'] : [],
    });

    const section: SectionBehavioralDiagnostic = {
      sectionIndex: steering.sectionIndex,
      progressionStage: steering.progressionStage,
      narrativeRole: steering.narrativeRole,
      behavioralPriorityAlignment,
      narrativeBehaviorAlignment,
      authorityBehaviorAlignment,
      depthBehaviorAlignment,
      audienceBehaviorAlignment,
      transitionBehaviorAlignment,
      antiRepetitionBehaviorAlignment,
      claimQualificationBehaviorAlignment,
      operationalRealismBehaviorAlignment,
      readerStateBehaviorAlignment,
      strategicTensionBehaviorAlignment,
      behavioralRiskFlags: [],
    };

    const behavioralRiskFlags = allDimensionValues(section)
      .flatMap((dimension) => dimension.driftIndicators)
      .filter((value, flagIndex, all) => all.indexOf(value) === flagIndex);

    return { ...section, behavioralRiskFlags };
  });

  const allDimensions = diagnostics.flatMap(allDimensionValues);
  const highRiskDimensions = allDimensions.filter((dimension) => dimension.risk === 'high').length;
  const mediumRiskDimensions = allDimensions.filter((dimension) => dimension.risk === 'medium').length;
  const riskFlags = diagnostics.flatMap((section) => section.behavioralRiskFlags).filter((value, index, all) => all.indexOf(value) === index);

  return {
    version: 'behavioral-adherence-diagnostics-v1',
    generatedAt: new Date(0).toISOString(),
    contentType: input.generatorBehavioralSteering.contentType,
    topic: input.generatorBehavioralSteering.topic,
    riskFlags,
    alignmentSummary: {
      overallRisk: highRiskDimensions > 0 ? 'high' : mediumRiskDimensions > 4 ? 'medium' : 'low',
      observedSections: sectionsText.length,
      expectedSections,
      highRiskDimensions,
      mediumRiskDimensions,
      confidence: sectionsText.length >= expectedSections ? 'high' : sectionsText.length > 0 ? 'medium' : 'low',
    },
    driftIndicators: {
      collapsedNarrativeBehavior: diagnostics.some((section) => section.narrativeBehaviorAlignment.driftIndicators.includes('collapsed narrative behavior')),
      repeatedBehavioralPatterns,
      weakOperationalRealism: diagnostics.some((section) => section.operationalRealismBehaviorAlignment.driftIndicators.includes('weak operational realism')),
      weakAuthorityDiscipline: diagnostics.some((section) => section.authorityBehaviorAlignment.driftIndicators.includes('weak authority discipline')),
      audienceSophisticationDrift: diagnostics.some((section) => section.audienceBehaviorAlignment.driftIndicators.includes('audience sophistication drift')),
      flatReaderStateMovement: diagnostics.some((section) => section.readerStateBehaviorAlignment.driftIndicators.includes('flat reader-state movement')),
      genericStrategicFraming: countMatches(fullText, GENERIC_STRATEGIC_MARKERS) > 0,
      repetitiveTransitionBehavior: transitionShapeCount > 2,
      shallowProofBehavior: diagnostics.some((section) => section.claimQualificationBehaviorAlignment.driftIndicators.includes('shallow proof behavior')),
      missingStrategicTension: diagnostics.some((section) => section.strategicTensionBehaviorAlignment.driftIndicators.includes('missing strategic tension')),
    },
    sections: diagnostics,
  };
}

export function serializeBehavioralAdherenceDiagnostics(report: BehavioralAdherenceDiagnosticReport): string {
  const sectionSummaries = report.sections.map((section) => {
    const flags = section.behavioralRiskFlags.length ? section.behavioralRiskFlags.join(', ') : 'none';
    return `${section.sectionIndex + 1}. ${section.progressionStage}/${section.narrativeRole}: flags=${flags}`;
  });

  return [
    '## BEHAVIORAL ADHERENCE DIAGNOSTICS',
    `Version: ${report.version}`,
    `Topic: ${report.topic}`,
    `Content type: ${report.contentType}`,
    `Overall risk: ${report.alignmentSummary.overallRisk}`,
    `Observed/expected sections: ${report.alignmentSummary.observedSections}/${report.alignmentSummary.expectedSections}`,
    `Risk flags: ${report.riskFlags.join('; ') || 'none'}`,
    `Drift indicators: ${Object.entries(report.driftIndicators).filter(([, value]) => value).map(([key]) => key).join('; ') || 'none'}`,
    'Section behavioral observations:',
    ...sectionSummaries,
  ].join('\n');
}
