/**
 * Content Generation Orchestrator
 *
 * Thin orchestration layer that centralizes all intelligence + prompt preparation
 * into a single reusable pipeline. Delegates to existing engines:
 *   - SEO Intelligence Engine    (keyword targeting + cannibalization)
 *   - Feedback Optimization Engine (angle effectiveness + performance learnings)
 *   - Trend Intelligence Engine  (market signals + freshness)
 *   - Structure Templates        (format-specific structural rules)
 *
 * Constraints:
 *   - NO duplicated logic — pure delegation to existing engines
 *   - Non-blocking — every engine call is wrapped in safeCall
 *   - Content-type agnostic — supports blog, article, case-study, whitepaper, post, story
 */

import { getSEOIntelligence, type SEOIntelligenceResult } from '../blog/seoIntelligenceEngine';
import { getFeedbackOptimization, type FeedbackOptimizationResult } from '../blog/feedbackOptimizationEngine';
import { getTrendIntelligence, type TrendIntelligenceResult, type TrendSignal } from '../blog/trendIntelligenceEngine';
import { getStructureRules, type StructureRules, type BlogFormatType, isValidBlogFormat } from '../blog/blogStructureTemplates';
import {
  assimilateCompanyEditorialPrimitives,
  type AssimilatedEditorialPrimitives,
  type CompanyAssimilationInput,
} from './companyAssimilationMiddleware';
import {
  resolveOmnivyraDoctrineGenerationContext,
  type OmnivyraDoctrineGenerationContext,
} from './omnivyraEditorialDoctrine';
import {
  buildNarrativePlanningPrimitives,
  type NarrativePlanningOutput,
} from './narrativePlanningEngine';
import {
  buildGenerationGuidanceContract,
  type GenerationGuidanceContract,
} from './generationGuidanceContracts';
import {
  buildEditorialDepthIntelligence,
  type EditorialDepthIntelligence,
} from './editorialDepthIntelligence';
import {
  buildEditorialAuthorityIntelligence,
  type EditorialAuthorityIntelligence,
} from './editorialAuthorityIntelligence';
import {
  buildAudienceMaturityIntelligence,
  type AudienceMaturityIntelligence,
} from './audienceMaturityIntelligence';
import {
  assembleUnifiedEditorialBrief,
  type UnifiedEditorialBrief,
} from './unifiedEditorialBriefAssembler';
import {
  prioritizeEditorialRuntimeContext,
  serializeEditorialRuntimeContext,
  type EditorialRuntimeContext,
} from './editorialRuntimeContextPrioritizer';
import {
  buildGeneratorRuntimeAlignment,
  serializeGeneratorRuntimeAlignment,
  type GeneratorRuntimeAlignment,
} from './generatorRuntimeAlignment';
import {
  buildGeneratorBehavioralSteering,
  serializeGeneratorBehavioralSteering,
  type GeneratorBehavioralSteering,
} from './generatorBehavioralSteering';

// ── Types ────────────────────────────────────────────────────────────────────

export type ContentType =
  | 'blog'
  | 'article'
  | 'case-study'
  | 'whitepaper'
  | 'newsletter'
  | 'post'
  | 'story'
  | 'guide';

export interface OrchestratorInput {
  contentType:    ContentType;
  topic:          string;
  companyId:      string;
  /** Table to query for SEO intelligence (blogs vs public_blogs) */
  blogTable?:     'blogs' | 'public_blogs';

  intent?:        string;
  audience?:      string;
  formatType?:    string;
  targetWordCount?: number;
  companyContext?: CompanyAssimilationInput;
  searchIntent?: string;
  keywords?: readonly string[];
  seoContext?: string | null;
  sectionCount?: number;

  /** Pre-aggregated trend signals — skips DB fetch if provided */
  trendSignals?:  TrendSignal[];
}

export interface OrchestratorResult {
  seo:        SEOIntelligenceResult | null;
  feedback:   FeedbackOptimizationResult | null;
  trends:     TrendIntelligenceResult | null;
  structure:  StructureRules | null;
  doctrine:   OmnivyraDoctrineGenerationContext;
  assimilation: AssimilatedEditorialPrimitives;
  narrativePlanning: NarrativePlanningOutput;
  generationGuidance: GenerationGuidanceContract;
  editorialDepth: EditorialDepthIntelligence;
  editorialAuthority: EditorialAuthorityIntelligence;
  audienceMaturity: AudienceMaturityIntelligence;
  unifiedEditorialBrief: UnifiedEditorialBrief;
  editorialRuntimeContext: EditorialRuntimeContext;
  generatorRuntimeAlignment: GeneratorRuntimeAlignment;
  generatorBehavioralSteering: GeneratorBehavioralSteering;
}

// ── Safe call wrapper ────────────────────────────────────────────────────────

async function safeCall<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

// ── Map content type to feedback engine's expected type ──────────────────────

function toFeedbackContentType(ct: ContentType): 'blog' | 'article' {
  return ct === 'blog' || ct === 'post' || ct === 'story' ? 'blog' : 'article';
}

// ── Core function ────────────────────────────────────────────────────────────

/**
 * Runs all intelligence engines in parallel and returns their results.
 * Every call is best-effort — failures return null for that engine.
 */
export async function buildGenerationContext(
  input: OrchestratorInput,
): Promise<OrchestratorResult> {
  const {
    contentType,
    topic,
    companyId,
    blogTable = 'blogs',
    trendSignals,
    formatType,
    targetWordCount = 1200,
    companyContext,
    searchIntent,
    keywords,
    seoContext,
    sectionCount,
  } = input;

  const [seo, feedback, trends] = await Promise.all([
    safeCall(() => getSEOIntelligence({ topic, companyId, blogTable })),
    safeCall(() => getFeedbackOptimization(companyId, toFeedbackContentType(contentType))),
    safeCall(() => getTrendIntelligence({ companyId, topic, trendSignals })),
  ]);

  // Structure rules are synchronous — no need for safeCall
  const validFormat: BlogFormatType = isValidBlogFormat(formatType) ? formatType : 'standard';
  const structure = getStructureRules(validFormat, targetWordCount);
  const doctrine = resolveOmnivyraDoctrineGenerationContext();
  const assimilation = assimilateCompanyEditorialPrimitives(companyContext);
  const narrativePlanning = buildNarrativePlanningPrimitives({
    topic,
    contentType,
    searchIntent,
    keywords,
    seoContext,
    doctrine,
    assimilation,
    sectionCount,
  });
  const generationGuidance = buildGenerationGuidanceContract({
    doctrine,
    assimilation,
    narrativePlanning,
  });
  const editorialDepth = buildEditorialDepthIntelligence({
    doctrine,
    assimilation,
    narrativePlanning,
    generationGuidance,
  });
  const editorialAuthority = buildEditorialAuthorityIntelligence({
    doctrine,
    assimilation,
    narrativePlanning,
    generationGuidance,
    editorialDepth,
  });
  const audienceMaturity = buildAudienceMaturityIntelligence({
    doctrine,
    assimilation,
    narrativePlanning,
    generationGuidance,
    editorialDepth,
    editorialAuthority,
  });
  const unifiedEditorialBrief = assembleUnifiedEditorialBrief({
    doctrine,
    assimilation,
    narrativePlanning,
    generationGuidance,
    editorialDepth,
    editorialAuthority,
    audienceMaturity,
  });
  const editorialRuntimeContext = prioritizeEditorialRuntimeContext({
    unifiedEditorialBrief,
    doctrine,
    assimilation,
    narrativePlanning,
    generationGuidance,
    editorialDepth,
    editorialAuthority,
    audienceMaturity,
  });
  const generatorRuntimeAlignment = buildGeneratorRuntimeAlignment({
    editorialRuntimeContext,
    unifiedEditorialBrief,
    narrativePlanning,
    generationGuidance,
  });
  const generatorBehavioralSteering = buildGeneratorBehavioralSteering({
    generatorRuntimeAlignment,
    editorialRuntimeContext,
    unifiedEditorialBrief,
  });

  return { seo, feedback, trends, structure, doctrine, assimilation, narrativePlanning, generationGuidance, editorialDepth, editorialAuthority, audienceMaturity, unifiedEditorialBrief, editorialRuntimeContext, generatorRuntimeAlignment, generatorBehavioralSteering };
}

// ── Unified prompt context builder ───────────────────────────────────────────

/**
 * Collapses all intelligence results into a single prompt fragment string.
 * Injected as a single "INTELLIGENCE CONTEXT" section in the generation prompt.
 */
export function buildUnifiedPromptContext(ctx: OrchestratorResult): string {
  const parts: string[] = [];

  parts.push(serializeEditorialRuntimeContext(ctx.editorialRuntimeContext));
  parts.push(serializeGeneratorRuntimeAlignment(ctx.generatorRuntimeAlignment));
  parts.push(serializeGeneratorBehavioralSteering(ctx.generatorBehavioralSteering));

  if (ctx.feedback?.performance_learnings_prompt) {
    parts.push(ctx.feedback.performance_learnings_prompt);
  }

  if (ctx.seo?.keyword_context_prompt) {
    parts.push(ctx.seo.keyword_context_prompt);
  }

  if (ctx.trends?.trend_context_prompt) {
    parts.push(ctx.trends.trend_context_prompt);
  }

  if (ctx.trends?.freshness_directive) {
    parts.push(ctx.trends.freshness_directive);
  }

  // Balance directive — only when both keyword + performance data present
  if (ctx.seo?.keyword_context_prompt && ctx.feedback?.performance_learnings_prompt) {
    parts.push('## BALANCE DIRECTIVE\nBalance keyword targeting with effective angle style. Do not compromise clarity for keyword placement.');
  }

  if (parts.length === 0) return '';

  return '\n## INTELLIGENCE CONTEXT\n\n' + parts.join('\n\n');
}
