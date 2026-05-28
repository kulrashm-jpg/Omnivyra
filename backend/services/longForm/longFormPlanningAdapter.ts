/**
 * Planning-layer adapter.
 *
 * Bridges a LongFormRecommendation to the existing long-form planning
 * engine (`lib/content/longFormPlanningEngine.ts`) without modifying the
 * planner itself. Produces:
 *   1. The canonical topic / contentType / formatType / intent / tone fields
 *      the planner already understands.
 *   2. A structured `editorialContext` block that downstream callers can
 *      attach to their planner input (e.g. through `answers` or as a custom
 *      field on `PlannedLongFormGenerationInput`-compatible objects).
 *
 * The adapter is intentionally non-invasive: it RETURNS partial input fields.
 * The caller composes them with their existing companyContext, company_id,
 * answers, etc. — there is no global side effect.
 */

import { contentTypeConfig } from '../../../lib/content/longFormContentTypeConfig';
import type {
  ContentAlignmentMode,
  LongFormRecommendation,
  NarrativeArchetype,
} from './longFormRecommendationTypes';
import type { CompanyContextFoundation } from './companyContextFoundation';

export interface EditorialContextBlock {
  alignmentMode: ContentAlignmentMode;
  editorialAngle: string;
  strategicNarrative: string;
  targetBuyerStage: LongFormRecommendation['targetBuyerStage'];
  whyThisFitsCompany: LongFormRecommendation['whyThisFitsCompany'];
  recommendedContentDirection: LongFormRecommendation['recommendedContentDirection'];
  /** Hard rules the planner / drafter must honor downstream. */
  hardRules: string[];
  /** Soft hints — used to bias section ideation. */
  softHints: string[];

  // ─── Phase 4 continuity additions ────────────────────────────────────
  /** Narrative family this content must continue (planner must not drift). */
  narrativeFamily: {
    archetype: NarrativeArchetype | 'uncategorized';
    familyClusterLabel: string | null;
  };
  /** Concrete ICP context echoed into the planner prompt. */
  icpContext: {
    market: string | null;
    icps: string[];
    buyerStage: LongFormRecommendation['targetBuyerStage'];
    painPoints: string[];
  };
  /** Capability emphasis the planner must keep as a through-line. */
  capabilityEmphasis: {
    primaryCapability: string;
    workflowCategory: string | null;
    measurableOutcomes: string[];
  };
  /** Terminology the planner should prefer over generic synonyms. */
  terminologyEmphasis: {
    domainVocabulary: string[];
    strategicTerminology: string[];
  };
  /** Mode-level constraints surfaced into the prompt (e.g. allowsLowOperationalDepth). */
  modeConstraints: {
    mode: ContentAlignmentMode;
    requiresStrategicNarrative: boolean;
    minCompanyAlignment: number;
  };
}

export interface PlanningInputPartial {
  topic: string;
  contentType: LongFormRecommendation['recommendedContentType'];
  formatType: string;
  /** Maps to BlogGenerationRequest.intent (already consumed by the planner). */
  intent: string;
  /** Maps to BlogGenerationRequest.tone — uses contentType default. */
  tone: string;
  /** SEO context string the planner prompt already injects. */
  seoContext: string;
  /** Recommended target word count tied to depth level. */
  targetWordCount: number;
  /** Structured editorial intent — attach to `answers.editorialContext` or read directly. */
  editorialContext: EditorialContextBlock;
}

function targetWordCountForDepth(depthLevel: string): number {
  switch (depthLevel) {
    case 'authority': return 2200;
    case 'deep': return 1600;
    case 'narrative': return 1200;
    case 'standard':
    default: return 1100;
  }
}

function defaultFormatFor(contentType: LongFormRecommendation['recommendedContentType']): string {
  return contentTypeConfig[contentType].defaultFormat;
}

function defaultToneFor(contentType: LongFormRecommendation['recommendedContentType']): string {
  return contentTypeConfig[contentType].defaultTone;
}

function buildHardRules(recommendation: LongFormRecommendation): string[] {
  const rules: string[] = [];
  rules.push(`Editorial angle MUST be: ${recommendation.editorialAngle}`);
  rules.push(`Target buyer stage: ${recommendation.targetBuyerStage}`);
  rules.push(`Content alignment mode: ${recommendation.contentAlignmentMode}`);
  rules.push(`Strategic narrative anchor: ${recommendation.strategicNarrative}`);
  if (recommendation.recommendedContentDirection.operationalProof.length > 0) {
    rules.push(
      `Must include operational proof: ${recommendation.recommendedContentDirection.operationalProof
        .slice(0, 4)
        .map((p) => `"${p}"`)
        .join('; ')}`,
    );
  }
  if (recommendation.recommendedContentDirection.avoidPatterns.length > 0) {
    rules.push(
      `Must avoid: ${recommendation.recommendedContentDirection.avoidPatterns
        .slice(0, 4)
        .map((p) => `"${p}"`)
        .join('; ')}`,
    );
  }
  return rules;
}

function buildSoftHints(recommendation: LongFormRecommendation): string[] {
  return [
    `whyThisFitsCompany — ICP problem: ${recommendation.whyThisFitsCompany.icpProblemMapping}`,
    `whyThisFitsCompany — capability connection: ${recommendation.whyThisFitsCompany.capabilityConnection}`,
    `whyThisFitsCompany — business context origin: ${recommendation.whyThisFitsCompany.businessContextOrigin}`,
    `Primary editorial angle: ${recommendation.recommendedContentDirection.primaryAngle}`,
  ];
}

/**
 * Convert a recommendation into the partial input fields the existing
 * long-form planner already reads. Caller layers in `company_id`,
 * `companyContext` (the legacy planner-side context), `answers`, etc.
 *
 * Pass the source `foundation` to enrich the editorialContext with the
 * ICP / capability / terminology emphasis fields required by Phase 4
 * continuity. If omitted, those blocks fall back to recommendation-derived
 * values (still useful, just narrower).
 */
export function applyRecommendationToPlanningInput(
  recommendation: LongFormRecommendation,
  options?: {
    foundation?: CompanyContextFoundation;
    /** Override the canonical title from the recommendation if the user edited it. */
    topic?: string;
    formatType?: string;
    tone?: string;
    intent?: string;
    targetWordCount?: number;
    seoContext?: string;
    /** Mode floor for downstream continuity validator. Defaults from recommendation mode. */
    minCompanyAlignment?: number;
    requiresStrategicNarrative?: boolean;
  },
): PlanningInputPartial {
  const config = contentTypeConfig[recommendation.recommendedContentType];
  const topic = options?.topic?.trim() || recommendation.recommendationTitle;
  const formatType = options?.formatType ?? defaultFormatFor(recommendation.recommendedContentType);
  const tone = options?.tone ?? defaultToneFor(recommendation.recommendedContentType);
  const intent = options?.intent ?? recommendation.editorialAngle;
  const targetWordCount = options?.targetWordCount ?? targetWordCountForDepth(config.depthLevel);
  const seoContext =
    options?.seoContext
    ?? `Recommendation-driven topic. Buyer stage: ${recommendation.targetBuyerStage}. Risk level: ${recommendation.genericityRiskLevel ?? 'low'}. Archetype: ${recommendation.narrativeArchetype ?? 'uncategorized'}.`;

  const foundation = options?.foundation;

  return {
    topic,
    contentType: recommendation.recommendedContentType,
    formatType,
    intent,
    tone,
    seoContext,
    targetWordCount,
    editorialContext: {
      alignmentMode: recommendation.contentAlignmentMode,
      editorialAngle: recommendation.editorialAngle,
      strategicNarrative: recommendation.strategicNarrative,
      targetBuyerStage: recommendation.targetBuyerStage,
      whyThisFitsCompany: recommendation.whyThisFitsCompany,
      recommendedContentDirection: recommendation.recommendedContentDirection,
      hardRules: buildHardRules(recommendation),
      softHints: buildSoftHints(recommendation),
      narrativeFamily: {
        archetype: recommendation.narrativeArchetype ?? 'uncategorized',
        familyClusterLabel: recommendation.familyClusterLabel ?? null,
      },
      icpContext: {
        market: foundation?.marketUnderstanding.targetMarket ?? null,
        icps: foundation?.marketUnderstanding.icps ?? [],
        buyerStage: recommendation.targetBuyerStage,
        painPoints: foundation?.marketUnderstanding.marketPainPoints ?? [],
      },
      capabilityEmphasis: {
        primaryCapability: recommendation.whyThisFitsCompany.capabilityConnection,
        workflowCategory:
          foundation?.capabilityMapping.workflowCategories.find((w) =>
            recommendation.whyThisFitsCompany.capabilityConnection.toLowerCase().includes(w.toLowerCase()),
          ) ?? null,
        measurableOutcomes: foundation?.capabilityMapping.measurableOutcomes ?? [],
      },
      terminologyEmphasis: {
        domainVocabulary: foundation?.terminologyLayer.domainVocabulary ?? [],
        strategicTerminology: foundation?.terminologyLayer.strategicTerminology ?? [],
      },
      modeConstraints: {
        mode: recommendation.contentAlignmentMode,
        requiresStrategicNarrative: options?.requiresStrategicNarrative ?? true,
        minCompanyAlignment: options?.minCompanyAlignment
          ?? (recommendation.contentAlignmentMode === 'company_context_led' ? 75
            : recommendation.contentAlignmentMode === 'hybrid_editorial' ? 55
            : 35),
      },
    },
  };
}

/**
 * Pure helper to render the editorial context block as a system-prompt
 * string. Used by callers that want to append the block to an existing
 * planner system prompt without altering the planner's own prompt template.
 */
export function renderEditorialContextForPrompt(block: EditorialContextBlock): string {
  const lines = [
    '═══ RECOMMENDATION-DRIVEN EDITORIAL CONTEXT ═══',
    `Alignment mode: ${block.alignmentMode}`,
    `Mode constraints: minCompanyAlignment=${block.modeConstraints.minCompanyAlignment} requiresStrategicNarrative=${block.modeConstraints.requiresStrategicNarrative}`,
    `Narrative family: ${block.narrativeFamily.archetype}${block.narrativeFamily.familyClusterLabel ? ` (${block.narrativeFamily.familyClusterLabel})` : ''}`,
    `Target buyer stage: ${block.targetBuyerStage}`,
    `Editorial angle: ${block.editorialAngle}`,
    `Strategic narrative: ${block.strategicNarrative}`,
    '',
    'ICP context (must remain the through-line):',
    `  • Market: ${block.icpContext.market ?? '—'}`,
    `  • ICPs: ${block.icpContext.icps.join('; ') || '—'}`,
    `  • Pain points: ${block.icpContext.painPoints.slice(0, 4).join('; ') || '—'}`,
    '',
    'Capability emphasis:',
    `  • Primary capability: ${block.capabilityEmphasis.primaryCapability}`,
    `  • Workflow category: ${block.capabilityEmphasis.workflowCategory ?? '—'}`,
    `  • Measurable outcomes: ${block.capabilityEmphasis.measurableOutcomes.slice(0, 3).join('; ') || '—'}`,
    '',
    'Terminology emphasis (prefer these phrasings):',
    `  • Domain vocabulary: ${block.terminologyEmphasis.domainVocabulary.slice(0, 6).join(', ') || '—'}`,
    `  • Strategic terminology: ${block.terminologyEmphasis.strategicTerminology.slice(0, 6).join(', ') || '—'}`,
    '',
    'Why this fits the company:',
    `  • ${block.whyThisFitsCompany.summary}`,
    `  • ICP problem mapping: ${block.whyThisFitsCompany.icpProblemMapping}`,
    `  • Capability connection: ${block.whyThisFitsCompany.capabilityConnection}`,
    `  • Business context origin: ${block.whyThisFitsCompany.businessContextOrigin}`,
    '',
    'Hard rules (must honor):',
    ...block.hardRules.map((r) => `  • ${r}`),
    '',
    'Soft hints (bias section ideation):',
    ...block.softHints.map((h) => `  • ${h}`),
    '═══════════════════════════════════════════════',
  ];
  return lines.join('\n');
}
