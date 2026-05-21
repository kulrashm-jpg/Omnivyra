import type { AssimilatedEditorialPrimitives } from './companyAssimilationMiddleware';
import type { EditorialDepthIntelligence, EditorialMaturityStage } from './editorialDepthIntelligence';
import type { GenerationGuidanceContract, SectionGenerationGuidanceContract } from './generationGuidanceContracts';
import type { NarrativePlanningOutput, NarrativePlanningSection, NarrativeProgressionStage } from './narrativePlanningEngine';
import type { OmnivyraDoctrineGenerationContext } from './omnivyraEditorialDoctrine';

export interface SectionEditorialAuthorityPrimitive {
  sectionIndex: number;
  progressionStage: NarrativeProgressionStage;
  narrativeRole: NarrativePlanningSection['narrativeRole'];
  authoritySignalTargets: readonly string[];
  evidenceExpectations: readonly string[];
  proofTypePreferences: readonly string[];
  citationBehaviorTargets: readonly string[];
  operationalCredibilitySignals: readonly string[];
  scenarioEvidenceTargets: readonly string[];
  implementationProofTargets: readonly string[];
  trustBuildingSignals: readonly string[];
  claimQualificationTargets: readonly string[];
  evidenceDepthExpectations: readonly string[];
  expertiseVisibilityTargets: readonly string[];
  authorityRiskSignals: readonly string[];
}

export interface EditorialAuthorityIntelligence {
  version: 'editorial-authority-intelligence-v1';
  topic: string;
  contentType: string;
  maturityStage: EditorialMaturityStage;
  globalAuthorityExpectations: readonly string[];
  sections: readonly SectionEditorialAuthorityPrimitive[];
}

interface StageAuthorityBehavior {
  authority: readonly string[];
  evidence: readonly string[];
  proofTypes: readonly string[];
  citation: readonly string[];
  credibility: readonly string[];
  scenarios: readonly string[];
  implementationProof: readonly string[];
  trust: readonly string[];
  qualification: readonly string[];
  risks: readonly string[];
}

const BASE_PROOF_STANDARDS = [
  'Never invent metrics, studies, customer names, or outcomes.',
  'Distinguish observed patterns from sourced facts.',
  'Tie recommendations to implementation checks and evidence signals.',
  'Qualify claims when company-specific proof is not supplied.',
];

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object') return value;
  Object.freeze(value);
  for (const nested of Object.values(value as Record<string, unknown>)) {
    if (nested && typeof nested === 'object' && !Object.isFrozen(nested)) {
      deepFreeze(nested);
    }
  }
  return value;
}

function clean(value: unknown, fallback = ''): string {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return text || fallback;
}

function compact(values: readonly string[], limit = 4): string[] {
  const seen = new Set<string>();
  return values
    .map((value) => clean(value))
    .filter(Boolean)
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

function stageAuthorityBehavior(stage: NarrativeProgressionStage): StageAuthorityBehavior {
  const behavior: Record<NarrativeProgressionStage, StageAuthorityBehavior> = {
    diagnose: {
      authority: ['establish authority through problem specificity', 'show familiarity with the operating environment'],
      evidence: ['use observable workflow pressure as evidence', 'name the decision failure caused by the problem'],
      proofTypes: ['operating symptom', 'decision breakdown', 'workflow pressure'],
      citation: ['cite external claims only when naming market facts or benchmarks', 'do not cite generic category claims as proof of company POV'],
      credibility: ['connect the diagnosis to real operator constraints'],
      scenarios: ['show a realistic failure moment before proposing a solution'],
      implementationProof: ['identify where the current process breaks'],
      trust: ['earn trust by diagnosing before prescribing'],
      qualification: ['separate observed pattern from verified fact'],
      risks: ['overclaiming the root cause without evidence', 'opening with generic market scenery'],
    },
    reframe: {
      authority: ['establish authority through a defensible point of view', 'show why the default assumption is insufficient'],
      evidence: ['prove the reframe through contrast and implication', 'explain what changes when the new lens is accepted'],
      proofTypes: ['assumption contrast', 'strategic implication', 'operating consequence'],
      citation: ['cite category definitions only when they clarify the old frame', 'keep POV claims qualified when unsupported by supplied proof'],
      credibility: ['make the strategic logic visible rather than declarative'],
      scenarios: ['show how the old frame misleads a realistic decision'],
      implementationProof: ['show how the reframe changes prioritization or sequencing'],
      trust: ['build trust by naming the tradeoff in adopting the new frame'],
      qualification: ['avoid implying the reframe is universal without scenario boundaries'],
      risks: ['staying neutral when the section needs conviction', 'claiming differentiation without operational consequence'],
    },
    expand: {
      authority: ['establish authority through mechanism clarity', 'separate adjacent concepts with precision'],
      evidence: ['support claims through causal logic and bounded examples', 'show second-order implications without exaggeration'],
      proofTypes: ['mechanism explanation', 'bounded example', 'causal chain'],
      citation: ['cite third-party facts only for external market or technical claims', 'do not use citations to mask weak causal reasoning'],
      credibility: ['make the mechanism inspectable'],
      scenarios: ['use examples that test the mechanism, not decorative anecdotes'],
      implementationProof: ['connect the mechanism to review, interpretation, or operating judgment'],
      trust: ['show where the mechanism holds and where it may not'],
      qualification: ['bound mechanism claims by context and available proof'],
      risks: ['restating benefits instead of evidence', 'confusing outcome claims with proof'],
    },
    operationalize: {
      authority: ['establish authority through implementation realism', 'name actors, handoffs, constraints, and checks'],
      evidence: ['use workflow behavior as proof', 'show how constraints affect execution choices'],
      proofTypes: ['workflow step', 'decision checkpoint', 'implementation constraint', 'failure mode'],
      citation: ['citations are secondary unless external standards or benchmarks are invoked', 'prefer implementation evidence over decorative references'],
      credibility: ['surface who does what, when, and under what constraint'],
      scenarios: ['show a realistic operating sequence with exception handling'],
      implementationProof: ['name decision points, review loops, ownership, thresholds, or handoffs'],
      trust: ['build trust by admitting tradeoffs and adoption friction'],
      qualification: ['avoid presenting workflows as universally applicable without constraints'],
      risks: ['vague advice without implementation behavior', 'ignoring governance, ownership, or measurement limits'],
    },
    validate: {
      authority: ['establish authority through proof standards', 'make the evidence threshold explicit'],
      evidence: ['connect claims to supplied proof, scenario evidence, constraints, or measurable behavior'],
      proofTypes: ['case evidence', 'scenario constraint', 'observable behavior', 'measurement boundary'],
      citation: ['cite sourced facts when used', 'never invent studies, metrics, customer names, or outcomes'],
      credibility: ['state what would make the claim credible or limited'],
      scenarios: ['show the kind of scenario that confirms or weakens the recommendation'],
      implementationProof: ['explain how proof would be captured, checked, or interpreted'],
      trust: ['build trust by qualifying unsupported claims clearly'],
      qualification: ['distinguish evidence, example, inference, and opinion'],
      risks: ['claiming proof without evidence boundaries', 'using confidence language without support'],
    },
    resolve: {
      authority: ['establish authority through disciplined synthesis', 'close with an operating implication supported by prior proof'],
      evidence: ['reuse evidence already established', 'avoid adding new unsupported facts at the end'],
      proofTypes: ['synthesis of established evidence', 'before-after implication', 'decision principle'],
      citation: ['do not introduce fresh citations in the conclusion unless they were already central', 'avoid late unsupported authority claims'],
      credibility: ['make the final implication feel earned by the preceding argument'],
      scenarios: ['show the final before-after state without adding a new case'],
      implementationProof: ['connect resolution to the next credible operating behavior'],
      trust: ['build trust through restraint and closure'],
      qualification: ['avoid overstating what the piece has proven'],
      risks: ['generic CTA replacing evidence-based resolution', 'introducing new claims in the final section'],
    },
  };
  return behavior[stage];
}

function maturityEvidenceExpectations(maturityStage: EditorialMaturityStage): string[] {
  const expectations: Record<EditorialMaturityStage, string[]> = {
    foundational: [
      'define proof expectations before relying on advanced claims',
      'use concrete scenarios when company-specific evidence is sparse',
    ],
    emerging: [
      'connect claims to practical examples and explicit assumptions',
      'qualify strategic recommendations when proof is directional',
    ],
    operational: [
      'prefer workflow evidence, decision checkpoints, constraints, and implementation signals',
      'make evidence useful to practitioners who already understand the category',
    ],
    advanced: [
      'show proof boundaries, second-order implications, and executive-level decision impact',
      'separate sourced facts, operating inference, and company POV with precision',
    ],
  };
  return expectations[maturityStage];
}

function doctrineQualificationTargets(doctrine: OmnivyraDoctrineGenerationContext): string[] {
  return compact([
    ...doctrine.strategicBeliefs.slice(0, 2).map((belief) => `Qualify strategic belief when evidence is not supplied: ${belief}`),
    ...doctrine.forbiddenGenericFraming.slice(0, 2).map((framing) => `Do not treat generic framing as authority: ${framing}`),
  ], 4);
}

function authoritySignals(
  assimilation: AssimilatedEditorialPrimitives,
  behavior: StageAuthorityBehavior,
  section: NarrativePlanningSection,
): string[] {
  return compact([
    ...behavior.authority,
    assimilation.authorityClaim.claim,
    `Use ${assimilation.differentiatorLogic.primary} as authority only when tied to ${section.progressionStage} evidence.`,
  ], 4);
}

function operationalCredibility(
  assimilation: AssimilatedEditorialPrimitives,
  depth: EditorialDepthIntelligence,
  section: NarrativePlanningSection,
  behavior: StageAuthorityBehavior,
): string[] {
  const depthSection = depth.sections.find((candidate) => candidate.sectionIndex === section.sectionIndex);
  return compact([
    ...behavior.credibility,
    assimilation.operatingPain.primary,
    ...(depthSection?.workflowRealismTargets || []),
    ...(depthSection?.implementationFrictionSignals || []),
  ], 5);
}

function expertiseVisibility(
  assimilation: AssimilatedEditorialPrimitives,
  guidance: SectionGenerationGuidanceContract | undefined,
): string[] {
  return compact([
    `Make expertise visible through ${assimilation.authorityClaim.basis.slice(0, 3).join(', ') || assimilation.differentiatorLogic.primary}.`,
    guidance?.sectionDifferentiationRule || '',
    ...assimilation.proofExpectations.slice(0, 2),
  ], 4);
}

export function buildEditorialAuthorityIntelligence(input: {
  doctrine: OmnivyraDoctrineGenerationContext;
  assimilation: AssimilatedEditorialPrimitives;
  narrativePlanning: NarrativePlanningOutput;
  generationGuidance: GenerationGuidanceContract;
  editorialDepth: EditorialDepthIntelligence;
}): EditorialAuthorityIntelligence {
  const { doctrine, assimilation, narrativePlanning, generationGuidance, editorialDepth } = input;
  const maturityExpectations = maturityEvidenceExpectations(editorialDepth.maturityStage);
  const sections = narrativePlanning.sections.map((section): SectionEditorialAuthorityPrimitive => {
    const behavior = stageAuthorityBehavior(section.progressionStage);
    const guidance = generationGuidance.sections.find((candidate) => candidate.sectionIndex === section.sectionIndex);
    const depthSection = editorialDepth.sections.find((candidate) => candidate.sectionIndex === section.sectionIndex);
    return {
      sectionIndex: section.sectionIndex,
      progressionStage: section.progressionStage,
      narrativeRole: section.narrativeRole,
      authoritySignalTargets: authoritySignals(assimilation, behavior, section),
      evidenceExpectations: compact([
        ...behavior.evidence,
        section.proofExpectation,
        ...(depthSection?.proofDepthExpectations || []),
      ], 5),
      proofTypePreferences: compact(behavior.proofTypes, 4),
      citationBehaviorTargets: compact([
        ...behavior.citation,
        ...BASE_PROOF_STANDARDS.slice(0, 2),
      ], 4),
      operationalCredibilitySignals: operationalCredibility(assimilation, editorialDepth, section, behavior),
      scenarioEvidenceTargets: compact([
        ...behavior.scenarios,
        `Use scenarios that reflect ${assimilation.buyerTension.audience} facing ${assimilation.operatingPain.primary}.`,
      ], 4),
      implementationProofTargets: compact([
        ...behavior.implementationProof,
        ...(depthSection?.workflowRealismTargets || []),
      ], 5),
      trustBuildingSignals: compact([
        ...behavior.trust,
        ...maturityExpectations,
        guidance?.toneExpectation || '',
      ], 5),
      claimQualificationTargets: compact([
        ...behavior.qualification,
        ...doctrineQualificationTargets(doctrine),
        guidance?.proofBehavior || '',
      ], 5),
      evidenceDepthExpectations: compact([
        ...maturityExpectations,
        ...(depthSection?.maturityStageSignals || []),
        ...(depthSection?.proofDepthExpectations || []),
      ], 5),
      expertiseVisibilityTargets: expertiseVisibility(assimilation, guidance),
      authorityRiskSignals: compact([
        ...behavior.risks,
        ...generationGuidance.globalForbiddenNarrativeMoves.slice(0, 2),
      ], 5),
    };
  });

  return deepFreeze({
    version: 'editorial-authority-intelligence-v1',
    topic: narrativePlanning.topic,
    contentType: narrativePlanning.contentType,
    maturityStage: editorialDepth.maturityStage,
    globalAuthorityExpectations: [
      'Authority must be earned through evidence, operational credibility, and qualified claims.',
      'Never invent metrics, studies, customer names, or outcomes.',
      'Use citations for sourced external facts, not as a substitute for weak reasoning.',
      `Keep claims within the authority ceiling: ${assimilation.authorityClaim.claim}`,
    ],
    sections,
  });
}

export function serializeEditorialAuthorityIntelligence(authority: EditorialAuthorityIntelligence): string {
  const sectionLines = authority.sections.map((section) => [
    `${section.sectionIndex + 1}. ${section.progressionStage}/${section.narrativeRole}`,
    `authority=${section.authoritySignalTargets.slice(0, 2).join(' | ')}`,
    `evidence=${section.evidenceExpectations.slice(0, 2).join(' | ')}`,
    `proof=${section.proofTypePreferences.slice(0, 2).join(' | ')}`,
    `citation=${section.citationBehaviorTargets.slice(0, 2).join(' | ')}`,
    `qualification=${section.claimQualificationTargets.slice(0, 2).join(' | ')}`,
  ].join(' :: '));

  return [
    '## EDITORIAL AUTHORITY INTELLIGENCE',
    `Version: ${authority.version}`,
    `Topic: ${authority.topic}`,
    `Content type: ${authority.contentType}`,
    `Maturity stage: ${authority.maturityStage}`,
    `Global authority expectations: ${authority.globalAuthorityExpectations.join('; ')}`,
    'Section authority primitives:',
    ...sectionLines,
  ].join('\n');
}
