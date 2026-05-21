import type { AssimilatedEditorialPrimitives } from './companyAssimilationMiddleware';
import type { BehavioralAdherenceDiagnosticReport } from './behavioralAdherenceDiagnostics';
import type { EditorialQualityReadinessReport } from './editorialQualityReadiness';
import type { EditorialQualitySignalReport } from './editorialQualitySignals';
import type { EditorialRemediationHintReport } from './editorialRemediationHints';
import type { EditorialRemediationPlan } from './editorialRemediationPlanAssembler';
import type { RegenerationCandidateSelection } from './regenerationCandidateSelector';
import type { RegenerationExecutionManifest } from './regenerationExecutionManifest';
import type { RegenerationReadinessContract } from './regenerationReadinessContracts';
import type { RecoveryExecutionDryRunPlan } from './recoveryExecutionDryRunPlanner';
import type { RecoveryExecutorContractReport } from './recoveryExecutorContracts';
import type { GenerationGuidanceContract, SectionGenerationGuidanceContract } from './generationGuidanceContracts';
import type { NarrativePlanningOutput, NarrativeProgressionStage } from './narrativePlanningEngine';
import type { OmnivyraDoctrineGenerationContext } from './omnivyraEditorialDoctrine';

export type EditorialDiagnosticRisk = 'low' | 'medium' | 'high';
export type EditorialDiagnosticConfidence = 'low' | 'medium' | 'high';

export interface EditorialDiagnosticDimension {
  aligned: boolean;
  risk: EditorialDiagnosticRisk;
  confidence: EditorialDiagnosticConfidence;
  summary: string;
  indicators: readonly string[];
  driftIndicators: readonly string[];
}

export interface SectionEditorialDiagnostic {
  sectionIndex: number;
  progressionStage: NarrativeProgressionStage;
  narrativeRole: SectionGenerationGuidanceContract['narrativeRole'];
  sectionRoleAlignment: EditorialDiagnosticDimension;
  narrativeStageAlignment: EditorialDiagnosticDimension;
  readerStateProgression: EditorialDiagnosticDimension;
  repetitionRisk: EditorialDiagnosticDimension;
  frameworkReuseRisk: EditorialDiagnosticDimension;
  genericFramingRisk: EditorialDiagnosticDimension;
  doctrineAlignment: EditorialDiagnosticDimension;
  assimilationAlignment: EditorialDiagnosticDimension;
  proofBehaviorAlignment: EditorialDiagnosticDimension;
  transitionAlignment: EditorialDiagnosticDimension;
  sectionDifferentiationAlignment: EditorialDiagnosticDimension;
  riskFlags: readonly string[];
}

export interface EditorialDiagnosticReport {
  version: 'editorial-diagnostic-observer-v1';
  generatedAt: string;
  contentType: string;
  topic: string;
  riskFlags: readonly string[];
  alignmentSummary: {
    overallRisk: EditorialDiagnosticRisk;
    observedSections: number;
    plannedSections: number;
    highRiskDimensions: number;
    mediumRiskDimensions: number;
    confidence: EditorialDiagnosticConfidence;
  };
  driftIndicators: {
    repeatedSectionIntent: boolean;
    repeatedDirectAnswerShape: boolean;
    genericSaasFraming: boolean;
    weakPovDifferentiation: boolean;
    collapsedNarrativeProgression: boolean;
    recycledExamples: boolean;
    missingReaderStateMovement: boolean;
    proofPatternAbsence: boolean;
    doctrineDrift: boolean;
    assimilationDrift: boolean;
  };
  sections: readonly SectionEditorialDiagnostic[];
  behavioralAdherence?: BehavioralAdherenceDiagnosticReport;
  qualitySignals?: EditorialQualitySignalReport;
  qualityReadiness?: EditorialQualityReadinessReport;
  remediationHints?: EditorialRemediationHintReport;
  remediationPlan?: EditorialRemediationPlan;
  regenerationReadinessContract?: RegenerationReadinessContract;
  regenerationCandidateSelection?: RegenerationCandidateSelection;
  regenerationExecutionManifest?: RegenerationExecutionManifest;
  recoveryExecutionDryRun?: RecoveryExecutionDryRunPlan;
  recoveryExecutorContracts?: RecoveryExecutorContractReport;
}

export interface EditorialDiagnosticInput {
  generatedContent: {
    title?: string;
    excerpt?: string;
    content_html?: string;
    content_blocks?: unknown[];
    key_insights?: readonly string[];
  };
  doctrine: OmnivyraDoctrineGenerationContext;
  assimilation: AssimilatedEditorialPrimitives;
  narrativePlanning: NarrativePlanningOutput;
  generationGuidance: GenerationGuidanceContract;
}

const DIRECT_ANSWER_PATTERNS = [
  /\bthe (key|main|best) (is|way|benefit)\b/i,
  /\bin short\b/i,
  /\bsimply put\b/i,
  /\bthis means\b/i,
  /\bwhy it matters\b/i,
];

const GENERIC_SAAS_PATTERNS = [
  /\bstreamline\b/i,
  /\bleverage\b/i,
  /\bcutting-edge\b/i,
  /\bunlock\b/i,
  /\bdrive growth\b/i,
  /\bseamless\b/i,
  /\binnovative solutions\b/i,
  /\bfast-paced digital\b/i,
  /\bbest practices\b/i,
];

const PROOF_PATTERNS = [
  /\bfor example\b/i,
  /\bscenario\b/i,
  /\bcase\b/i,
  /\bconstraint\b/i,
  /\btrade-?off\b/i,
  /\bevidence\b/i,
  /\bproof\b/i,
  /\bmetric\b/i,
  /\bobserved\b/i,
  /\bworkflow\b/i,
];

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

function extractText(input: EditorialDiagnosticInput['generatedContent']): string {
  const parts = [
    input.title,
    input.excerpt,
    input.content_html,
    ...(Array.isArray(input.key_insights) ? input.key_insights : []),
    ...(Array.isArray(input.content_blocks) ? flattenBlocks(input.content_blocks) : []),
  ];
  return parts.map(cleanText).filter(Boolean).join('\n\n');
}

function splitSections(input: EditorialDiagnosticInput['generatedContent'], plannedCount: number): string[] {
  const html = typeof input.content_html === 'string' ? input.content_html : '';
  const htmlSections = html
    .split(/<h2[^>]*>|<h3[^>]*>/i)
    .map(cleanText)
    .filter((section) => section.split(/\s+/).length >= 12);
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
  const sections: string[] = [];
  for (let index = 0; index < plannedCount; index++) {
    const chunk = paragraphs.slice(index * perSection, (index + 1) * perSection).join(' ');
    if (chunk) sections.push(chunk);
  }
  return sections;
}

function countMatches(text: string, patterns: readonly RegExp[]): number {
  return patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
}

function keywordHits(text: string, values: readonly string[]): string[] {
  const haystack = normalize(text);
  return values.filter((value) => {
    const phrase = normalize(value);
    if (!phrase) return false;
    const phraseTokens = phrase.split(/\s+/).filter((token) => token.length >= 4);
    if (phraseTokens.length === 0) return false;
    const hits = phraseTokens.filter((token) => haystack.includes(token)).length;
    return hits >= Math.min(2, phraseTokens.length);
  });
}

function makeDimension(input: {
  aligned: boolean;
  risk: EditorialDiagnosticRisk;
  confidence?: EditorialDiagnosticConfidence;
  summary: string;
  indicators?: readonly string[];
  driftIndicators?: readonly string[];
}): EditorialDiagnosticDimension {
  return {
    aligned: input.aligned,
    risk: input.risk,
    confidence: input.confidence ?? 'medium',
    summary: input.summary,
    indicators: input.indicators ?? [],
    driftIndicators: input.driftIndicators ?? [],
  };
}

function directAnswerShape(text: string): string {
  const sentences = cleanText(text).split(/[.!?]/).map((sentence) => sentence.trim()).filter(Boolean);
  const matched = sentences.find((sentence) => DIRECT_ANSWER_PATTERNS.some((pattern) => pattern.test(sentence)));
  if (matched) {
    const normalizedMatch = matched.replace(
      /^.*?\b(in short|simply put|this means|why it matters|the key|the main|the best)\b/i,
      '$1',
    );
    return normalize(normalizedMatch).slice(0, 42);
  }
  return '';
}

function stageMarkers(stage: NarrativeProgressionStage): readonly RegExp[] {
  const markers: Record<NarrativeProgressionStage, readonly RegExp[]> = {
    diagnose: [/\btension\b/i, /\bpain\b/i, /\bproblem\b/i, /\bcause\b/i, /\bstakes\b/i],
    reframe: [/\breframe\b/i, /\bassumption\b/i, /\binstead\b/i, /\bdefault\b/i, /\bbelief\b/i],
    expand: [/\bmechanism\b/i, /\bmeans\b/i, /\bimplication\b/i, /\bdistinction\b/i],
    operationalize: [/\bworkflow\b/i, /\bdecision\b/i, /\bprocess\b/i, /\btrade-?off\b/i, /\bcheck\b/i],
    validate: [/\bproof\b/i, /\bevidence\b/i, /\bconstraint\b/i, /\bexample\b/i, /\bscenario\b/i],
    resolve: [/\btherefore\b/i, /\bultimately\b/i, /\boperating\b/i, /\bimplication\b/i, /\btakeaway\b/i],
  };
  return markers[stage];
}

function riskFromCount(count: number, highAt: number, mediumAt = 1): EditorialDiagnosticRisk {
  if (count >= highAt) return 'high';
  if (count >= mediumAt) return 'medium';
  return 'low';
}

function allDimensionValues(section: SectionEditorialDiagnostic): EditorialDiagnosticDimension[] {
  return [
    section.sectionRoleAlignment,
    section.narrativeStageAlignment,
    section.readerStateProgression,
    section.repetitionRisk,
    section.frameworkReuseRisk,
    section.genericFramingRisk,
    section.doctrineAlignment,
    section.assimilationAlignment,
    section.proofBehaviorAlignment,
    section.transitionAlignment,
    section.sectionDifferentiationAlignment,
  ];
}

export function observeEditorialDiagnostics(input: EditorialDiagnosticInput): EditorialDiagnosticReport {
  const fullText = extractText(input.generatedContent);
  const sectionsText = splitSections(input.generatedContent, input.generationGuidance.sections.length);
  const roleShapeCounts = new Map<string, number>();
  const directAnswerShapes = sectionsText.map(directAnswerShape).filter(Boolean);
  for (const section of input.generationGuidance.sections) {
    roleShapeCounts.set(section.narrativeRole, (roleShapeCounts.get(section.narrativeRole) ?? 0) + 1);
  }
  const repeatedDirectAnswerShape = new Set(directAnswerShapes).size < directAnswerShapes.length;
  const genericForbiddenHits = keywordHits(fullText, input.doctrine.forbiddenGenericFraming);
  const genericPatternCount = countMatches(fullText, GENERIC_SAAS_PATTERNS);
  const doctrineHits = keywordHits(fullText, [
    input.doctrine.worldview.thesis,
    ...input.doctrine.strategicBeliefs,
    ...input.doctrine.approvedPovArchetypes.map((pov) => pov.label),
    ...input.doctrine.approvedPovArchetypes.map((pov) => pov.editorialMove),
  ]);
  const assimilationHits = keywordHits(fullText, [
    input.assimilation.buyerTension.statement,
    input.assimilation.operatingPain.primary,
    input.assimilation.transformationMechanism.mechanism,
    input.assimilation.authorityClaim.claim,
    input.assimilation.differentiatorLogic.logic,
    ...input.assimilation.approvedPovAngles.map((angle) => angle.angle),
  ]);

  const diagnostics = input.generationGuidance.sections.map((contract, index): SectionEditorialDiagnostic => {
    const sectionText = sectionsText[index] || '';
    const stageHitCount = countMatches(sectionText, stageMarkers(contract.progressionStage));
    const genericHits = [
      ...keywordHits(sectionText, input.doctrine.forbiddenGenericFraming),
      ...GENERIC_SAAS_PATTERNS.filter((pattern) => pattern.test(sectionText)).map((pattern) => String(pattern)),
    ];
    const proofHitCount = countMatches(sectionText, PROOF_PATTERNS);
    const allowedHits = keywordHits(sectionText, contract.allowedNarrativeMoves);
    const forbiddenHits = keywordHits(sectionText, contract.forbiddenNarrativeMoves);
    const sectionTokens = tokens(sectionText);
    const intentTokens = tokens(contract.sectionGenerationIntent);
    const roleOverlap = intentTokens.filter((token) => sectionTokens.includes(token)).length;
    const readerShiftTokens = tokens(contract.readerAwarenessTarget);
    const readerHits = readerShiftTokens.filter((token) => sectionTokens.includes(token));
    const differentiationHits = keywordHits(sectionText, [contract.sectionDifferentiationRule]);
    const frameworkCount = (sectionText.match(/\b(framework|pillar|playbook|blueprint|step[- ]by[- ]step|checklist)\b/gi) || []).length;
    const directShape = directAnswerShape(sectionText);
    const sectionDoctrineHits = keywordHits(sectionText, [
      input.doctrine.worldview.thesis,
      ...input.doctrine.strategicBeliefs,
      ...input.doctrine.approvedPovArchetypes.map((pov) => pov.label),
    ]);
    const sectionAssimilationHits = keywordHits(sectionText, [
      input.assimilation.operatingPain.primary,
      input.assimilation.transformationMechanism.mechanism,
      input.assimilation.differentiatorLogic.logic,
      input.assimilation.authorityClaim.claim,
      ...input.assimilation.approvedPovAngles.map((angle) => angle.angle),
    ]);
    const nextSection = sectionsText[index + 1] || '';
    const transitionOverlap = nextSection
      ? tokens(contract.transitionBehavior).filter((token) => tokens(nextSection).includes(token)).length
      : 0;

    const sectionRoleAlignment = makeDimension({
      aligned: roleOverlap >= 2 || allowedHits.length > 0,
      risk: roleOverlap >= 2 || allowedHits.length > 0 ? 'low' : 'medium',
      summary: roleOverlap >= 2 || allowedHits.length > 0
        ? 'Section appears to carry its assigned editorial responsibility.'
        : 'Section does not visibly reflect its assigned intent or allowed moves.',
      indicators: allowedHits.slice(0, 3),
      driftIndicators: roleOverlap < 2 ? ['weak section intent visibility'] : [],
    });

    const narrativeStageAlignment = makeDimension({
      aligned: stageHitCount > 0,
      risk: stageHitCount > 0 ? 'low' : 'medium',
      summary: stageHitCount > 0
        ? `Observed ${contract.progressionStage} stage markers.`
        : `No clear ${contract.progressionStage} stage markers observed.`,
      indicators: [`stage marker count: ${stageHitCount}`],
      driftIndicators: stageHitCount === 0 ? ['collapsed narrative stage'] : [],
    });

    const readerStateProgression = makeDimension({
      aligned: readerHits.length >= 2,
      risk: readerHits.length >= 2 ? 'low' : 'medium',
      summary: readerHits.length >= 2
        ? 'Reader-state shift is visible in the section language.'
        : 'Reader-state movement is weak or implicit.',
      indicators: readerHits.slice(0, 5),
      driftIndicators: readerHits.length < 2 ? ['missing reader-state movement'] : [],
    });

    const repetitionRisk = makeDimension({
      aligned: !(directShape && repeatedDirectAnswerShape),
      risk: directShape && repeatedDirectAnswerShape ? 'high' : directShape ? 'medium' : 'low',
      summary: directShape && repeatedDirectAnswerShape
        ? 'Section repeats a direct-answer shape used elsewhere.'
        : directShape
          ? 'Section uses a direct-answer shape; monitor repetition.'
          : 'No repeated direct-answer shape detected.',
      indicators: directShape ? [directShape] : [],
      driftIndicators: directShape && repeatedDirectAnswerShape ? ['repeated direct-answer shape'] : [],
    });

    const frameworkReuseRisk = makeDimension({
      aligned: frameworkCount <= 1,
      risk: riskFromCount(frameworkCount, 3, 2),
      summary: frameworkCount <= 1
        ? 'No heavy framework-loop reuse observed.'
        : 'Repeated framework language may be substituting for section-specific insight.',
      indicators: [`framework marker count: ${frameworkCount}`],
      driftIndicators: frameworkCount > 1 ? ['possible duplicated framework loop'] : [],
    });

    const genericFramingRisk = makeDimension({
      aligned: genericHits.length === 0,
      risk: riskFromCount(genericHits.length, 2),
      summary: genericHits.length === 0
        ? 'No obvious generic SaaS framing observed.'
        : 'Generic SaaS/category framing appears in the section.',
      indicators: genericHits.slice(0, 5),
      driftIndicators: genericHits.length > 0 ? ['generic SaaS framing'] : [],
    });

    const doctrineAlignment = makeDimension({
      aligned: sectionDoctrineHits.length > 0 && forbiddenHits.length === 0 && genericHits.length === 0,
      risk: forbiddenHits.length > 0 || genericHits.length > 0 ? 'high' : sectionDoctrineHits.length > 0 ? 'low' : 'medium',
      summary: sectionDoctrineHits.length > 0
        ? 'Doctrine language or POV appears visible.'
        : 'Doctrine POV is not clearly visible.',
      indicators: sectionDoctrineHits.slice(0, 4),
      driftIndicators: forbiddenHits.length > 0 || genericHits.length > 0 ? ['doctrine forbidden framing'] : sectionDoctrineHits.length === 0 ? ['weak doctrine visibility'] : [],
    });

    const assimilationAlignment = makeDimension({
      aligned: sectionAssimilationHits.length > 0,
      risk: sectionAssimilationHits.length > 0 ? 'low' : 'medium',
      summary: sectionAssimilationHits.length > 0
        ? 'Company assimilation primitives appear in the section.'
        : 'Company-conditioned primitives are not clearly visible.',
      indicators: sectionAssimilationHits.slice(0, 4),
      driftIndicators: sectionAssimilationHits.length === 0 ? ['assimilation drift'] : [],
    });

    const proofBehaviorAlignment = makeDimension({
      aligned: proofHitCount > 0 || contract.progressionStage !== 'validate',
      risk: proofHitCount > 0 ? 'low' : contract.progressionStage === 'validate' ? 'high' : 'medium',
      summary: proofHitCount > 0
        ? 'Proof or constraint behavior is visible.'
        : 'Proof behavior is absent or too implicit.',
      indicators: [`proof marker count: ${proofHitCount}`],
      driftIndicators: proofHitCount === 0 ? ['proof-pattern absence'] : [],
    });

    const transitionAlignment = makeDimension({
      aligned: index === input.generationGuidance.sections.length - 1 || transitionOverlap > 0,
      risk: index === input.generationGuidance.sections.length - 1 || transitionOverlap > 0 ? 'low' : 'medium',
      confidence: nextSection ? 'medium' : 'low',
      summary: nextSection && transitionOverlap > 0
        ? 'Transition objective appears to connect into the next section.'
        : index === input.generationGuidance.sections.length - 1
          ? 'Final section does not require a forward transition.'
          : 'Transition into the next section is weak.',
      indicators: [`transition overlap: ${transitionOverlap}`],
      driftIndicators: index < input.generationGuidance.sections.length - 1 && transitionOverlap === 0 ? ['weak transition behavior'] : [],
    });

    const sectionDifferentiationAlignment = makeDimension({
      aligned: differentiationHits.length > 0 || allowedHits.length > 0,
      risk: differentiationHits.length > 0 || allowedHits.length > 0 ? 'low' : 'medium',
      summary: differentiationHits.length > 0
        ? 'Section differentiation rule is visibly represented.'
        : allowedHits.length > 0
          ? 'Allowed moves create some differentiation, but company POV signal is indirect.'
          : 'Section differentiation is weak.',
      indicators: [...differentiationHits, ...allowedHits].slice(0, 4),
      driftIndicators: differentiationHits.length === 0 && allowedHits.length === 0 ? ['weak POV differentiation'] : [],
    });

    const section: SectionEditorialDiagnostic = {
      sectionIndex: contract.sectionIndex,
      progressionStage: contract.progressionStage,
      narrativeRole: contract.narrativeRole,
      sectionRoleAlignment,
      narrativeStageAlignment,
      readerStateProgression,
      repetitionRisk,
      frameworkReuseRisk,
      genericFramingRisk,
      doctrineAlignment,
      assimilationAlignment,
      proofBehaviorAlignment,
      transitionAlignment,
      sectionDifferentiationAlignment,
      riskFlags: [],
    };

    const riskFlags = allDimensionValues(section)
      .flatMap((dimension) => dimension.driftIndicators)
      .filter((value, flagIndex, all) => all.indexOf(value) === flagIndex);

    return { ...section, riskFlags };
  });

  const allDimensions = diagnostics.flatMap(allDimensionValues);
  const highRiskDimensions = allDimensions.filter((dimension) => dimension.risk === 'high').length;
  const mediumRiskDimensions = allDimensions.filter((dimension) => dimension.risk === 'medium').length;
  const globalRiskFlags = diagnostics.flatMap((section) => section.riskFlags);
  const uniqueGlobalRiskFlags = globalRiskFlags.filter((flag, index, all) => all.indexOf(flag) === index);
  const proofPatternAbsence = diagnostics.some((section) => section.proofBehaviorAlignment.driftIndicators.includes('proof-pattern absence'));
  const weakPovDifferentiation = diagnostics.some((section) => section.sectionDifferentiationAlignment.driftIndicators.includes('weak POV differentiation'));
  const missingReaderStateMovement = diagnostics.some((section) => section.readerStateProgression.driftIndicators.includes('missing reader-state movement'));
  const collapsedNarrativeProgression = diagnostics.some((section) => section.narrativeStageAlignment.driftIndicators.includes('collapsed narrative stage'));
  const genericSaasFraming = genericForbiddenHits.length > 0 || genericPatternCount > 1;
  const doctrineDrift = doctrineHits.length === 0 || genericForbiddenHits.length > 0;
  const assimilationDrift = assimilationHits.length === 0 || diagnostics.filter((section) => !section.assimilationAlignment.aligned).length > diagnostics.length / 2;
  const recycledExamples = (fullText.match(/\bfor example\b/gi) || []).length > 2 && new Set((fullText.match(/\bfor example[^.]+/gi) || []).map(normalize)).size <= 1;

  return {
    version: 'editorial-diagnostic-observer-v1',
    generatedAt: new Date(0).toISOString(),
    contentType: input.generationGuidance.contentType,
    topic: input.generationGuidance.topic,
    riskFlags: uniqueGlobalRiskFlags,
    alignmentSummary: {
      overallRisk: highRiskDimensions > 0 ? 'high' : mediumRiskDimensions > 3 ? 'medium' : 'low',
      observedSections: sectionsText.length,
      plannedSections: input.generationGuidance.sections.length,
      highRiskDimensions,
      mediumRiskDimensions,
      confidence: sectionsText.length >= input.generationGuidance.sections.length ? 'high' : sectionsText.length > 0 ? 'medium' : 'low',
    },
    driftIndicators: {
      repeatedSectionIntent: Array.from(roleShapeCounts.values()).some((count) => count > 1),
      repeatedDirectAnswerShape,
      genericSaasFraming,
      weakPovDifferentiation,
      collapsedNarrativeProgression,
      recycledExamples,
      missingReaderStateMovement,
      proofPatternAbsence,
      doctrineDrift,
      assimilationDrift,
    },
    sections: diagnostics,
  };
}

export function serializeEditorialDiagnosticReport(report: EditorialDiagnosticReport): string {
  const sectionSummaries = report.sections.map((section) => {
    const flags = section.riskFlags.length ? section.riskFlags.join(', ') : 'none';
    return `${section.sectionIndex + 1}. ${section.progressionStage}/${section.narrativeRole}: flags=${flags}`;
  });

  return [
    '## EDITORIAL DIAGNOSTIC OBSERVER',
    `Version: ${report.version}`,
    `Topic: ${report.topic}`,
    `Content type: ${report.contentType}`,
    `Overall risk: ${report.alignmentSummary.overallRisk}`,
    `Observed/planned sections: ${report.alignmentSummary.observedSections}/${report.alignmentSummary.plannedSections}`,
    `Risk flags: ${report.riskFlags.join('; ') || 'none'}`,
    `Drift indicators: ${Object.entries(report.driftIndicators).filter(([, value]) => value).map(([key]) => key).join('; ') || 'none'}`,
    'Section observations:',
    ...sectionSummaries,
  ].join('\n');
}
