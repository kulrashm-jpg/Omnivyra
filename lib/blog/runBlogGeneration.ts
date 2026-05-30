/**
 * runBlogGeneration
 *
 * COMPATIBILITY CORE:
 * Public long-form callers should use lib/content/unifiedLongFormEngine.ts.
 * This module remains as the existing generation core while architecture is
 * consolidated behind the unified facade.
 *
 * Single source of truth for all blog generation logic.
 * Called by:
 *   - /api/admin/blog/generate  (Super Admin — public_blogs)
 *   - /api/blogs/generate       (Company Admin — blogs)
 *
 * API routes are responsible ONLY for:
 *   1. Auth / role enforcement
 *   2. Company context injection (placeholder per route)
 *   3. Calling runBlogGeneration(input)
 *   4. Returning res.status(200).json(result)
 *
 * No generation logic lives inside any API route file.
 *
 * PURE FUNCTION DESIGN
 * ─────────────────────
 * runBlogGeneration does NOT access req, res, cookies, headers, or session.
 * All external data access is injected via BlogGenerationRequest:
 *   - fetchAngleData   — overrideable for testing / mocking
 *   - fetchSeriesData  — overrideable for testing / mocking
 * Default implementations are module-level functions that use supabase.
 * Injectable overrides let callers eliminate all DB coupling in unit tests.
 */

import { runCompletionWithOperation } from '../../backend/services/aiGateway';
import { htmlToBlocks } from './htmlToBlocks';
import type { ContentBlock } from './blockTypes';
import {
  generateClarificationQuestions,
  type ThemeInput,
} from './blogClarificationEngine';
import {
  buildAnglesSystemPrompt,
  buildAnglesUserPrompt,
  validateAnglesOutput,
  buildFallbackAngles,
  buildGenerationFallback,
  type BlogAngle,
  type AngleType,
  type BlogGenerationInput,
  type SeriesSummary,
} from './blogGenerationEngine';
import { extractPrimaryKeyword } from './seoIntelligenceEngine';
import {
  buildGenerationContext,
  buildUnifiedPromptContext,
  type OrchestratorResult,
} from '../content/contentGenerationOrchestrator';
import { assimilateCompanyEditorialPrimitives } from '../content/companyAssimilationMiddleware';
import { buildAudienceMaturityIntelligence } from '../content/audienceMaturityIntelligence';
import { buildEditorialAuthorityIntelligence } from '../content/editorialAuthorityIntelligence';
import { buildEditorialDepthIntelligence } from '../content/editorialDepthIntelligence';
import { buildGenerationGuidanceContract } from '../content/generationGuidanceContracts';
import { buildNarrativePlanningPrimitives } from '../content/narrativePlanningEngine';
import { resolveOmnivyraDoctrineGenerationContext } from '../content/omnivyraEditorialDoctrine';
// Phase 1.2 — Dead validator/recovery/acceptance/regeneration envelope cascade
// removed. The previous 40+ imports built nested diagnostic contracts that
// were attached as metadata but never gated regeneration or any other
// behavior. They have been deleted (along with their tests). The lightweight
// replacement diagnostics live in `attachEditorialDiagnostics` below and are
// typed in `blogRunnerTypes.ts` as `LightweightEditorialDiagnostics`.
import { assembleUnifiedEditorialBrief } from '../content/unifiedEditorialBriefAssembler';
import { prioritizeEditorialRuntimeContext } from '../content/editorialRuntimeContextPrioritizer';
import { buildGeneratorRuntimeAlignment } from '../content/generatorRuntimeAlignment';
import { buildGeneratorBehavioralSteering } from '../content/generatorBehavioralSteering';
import { getDefaultBlogTemplates, instantiateBlogTemplate } from './defaultBlogTemplates';
import { deriveTemplateDepthGuidance } from './runBlogGenerationPureHelpers';
import { type CompanyIdentity } from '../content/companyContextBlock';
import {
  buildCanonicalCompanyIdentity,
  validateIdentityConsistency,
} from '../content/identityConsistencyValidator';
import {
  buildSectionStrategicAssignments,
  renderSectionStrategicAssignmentsForPrompt,
} from '../content/sectionStrategicAssignments';
import {
  defaultFetchAngleData,
  defaultFetchSeriesData,
  injectInternalLinks,
} from './runBlogGenerationDataAccess';
import type { CompanyContext, BlogGenerationRequest, BlogGenerationResult } from './blogRunnerTypes';
// Re-export types for callers that import them from this module
export type { CompanyContext, BlogGenerationRequest, BlogGenerationResult } from './blogRunnerTypes';
import { runStandardHtmlBlogGeneration } from './runStandardBlogGeneration';
import { runTemplateBlogGenerationPath } from './runTemplateBlogGeneration';
import {
  buildGovernanceExplainabilityMetadata,
  type GovernancePromptContext,
} from '../../backend/services/creator/strategyGovernancePromptContext';

type FullBlogGenerationResult = Extract<
  BlogGenerationResult,
  { needs_clarification: false; mode: 'full' }
>;

function isFullBlogGenerationResult(
  result: BlogGenerationResult,
): result is FullBlogGenerationResult {
  return result.needs_clarification === false && result.mode === 'full';
}

/**
 * Phase 1.2 — Lightweight editorial diagnostics.
 *
 * Replaces the previous 30+-stage validator/recovery/acceptance/regeneration
 * envelope cascade, which was inert (built nested contracts but never gated
 * regeneration). The new payload exposes only operational metadata:
 *   - which engine produced the result (always 'compatibility-core' here —
 *     `unifiedLongFormEngine` wraps this and reports the user-facing engine)
 *   - generation mode + duration
 *   - section count and retry count if known
 *
 * The function signature is preserved so existing call sites in
 * `runStandardHtmlBlogGeneration`, `runTemplateBlogGenerationPath`, and the
 * fallback path continue to compile.
 */
function attachEditorialDiagnostics(
  result: BlogGenerationResult,
  _ctx: OrchestratorResult | null,
  meta?: {
    generationStartMs?: number;
    retryCount?: number;
  },
): BlogGenerationResult {
  if (!isFullBlogGenerationResult(result)) return result;

  const generationStartMs = meta?.generationStartMs;
  const generationDurationMs = typeof generationStartMs === 'number'
    ? Math.max(0, Date.now() - generationStartMs)
    : 0;

  let sectionCount: number | undefined;
  try {
    const blocks = result.result?.content_blocks;
    if (Array.isArray(blocks)) {
      // Count H2-level headings as sections — matches what end users perceive
      // as a "section" and what the prompt mandates count against.
      sectionCount = blocks.reduce<number>((acc, block) => {
        const b = block as { type?: string; level?: number; heading_level?: number };
        if (b?.type === 'heading' && (b.level === 2 || b.heading_level === 2)) return acc + 1;
        return acc;
      }, 0);
    }
  } catch {
    sectionCount = undefined;
  }

  return {
    ...result,
    editorial_diagnostics: {
      generation_engine: 'compatibility-core',
      generation_mode: result.mode,
      fallback_triggered: false,
      generation_duration_ms: generationDurationMs,
      section_count: sectionCount,
      retry_count: meta?.retryCount,
    },
  };
}

/**
 * Blog Governance Parity — attaches the canonical governance metadata
 * envelope to the blog generation result. Always present (carries
 * `industry='none'` when no policy applies) so downstream consumers can
 * rely on a stable shape.
 */
function attachBlogGovernanceMetadata(
  result: BlogGenerationResult,
  governance: GovernancePromptContext | null,
): BlogGenerationResult {
  return {
    ...result,
    governance: buildGovernanceExplainabilityMetadata(governance),
  };
}

// ── Main function ─────────────────────────────────────────────────────────────

export async function runBlogGeneration(
  req: BlogGenerationRequest,
): Promise<BlogGenerationResult> {
  // Phase 1.2 — Capture start time so attachEditorialDiagnostics can report
  // generation_duration_ms in the lightweight metadata payload.
  const generationStartMs = Date.now();

  const {
    company_id,
    mode = 'full',
    topic,
    cluster,
    intent,
    related_blogs,
    series_blog_ids,
    series_context,
    answers,
    selected_angle,
    tone,
    goal_type,
    blogTable       = 'blogs',
    fetchAngleData  = defaultFetchAngleData,
    fetchSeriesData = defaultFetchSeriesData,
    companyContext,
    contentType     = 'blog',
    formatType: rawFormatType,
    target_words,
    template_blocks,
    template_name,
    cache_version,
  } = req;

  // Default format per content type
  const formatType = rawFormatType || (contentType === 'whitepaper' ? 'research' : contentType === 'guide' ? 'comprehensive' : contentType === 'newsletter' ? 'weekly-brief' : contentType === 'story' ? 'short_story' : contentType === 'article' ? 'narrative' : 'standard');

  const resolveDefaultBlogTemplate = (
    requestedFormat: typeof formatType,
    targetWords?: number,
  ): { templateName?: string; templateBlocks?: ContentBlock[] } => {
    if (contentType !== 'blog') return {};
    if (Array.isArray(template_blocks) && template_blocks.length > 0) {
      return {
        templateName: typeof template_name === 'string' ? template_name : undefined,
        templateBlocks: template_blocks,
      };
    }

    const normalizedFormat = typeof requestedFormat === 'string'
      ? requestedFormat.trim().toLowerCase()
      : '';
    if (normalizedFormat !== 'tutorial' && normalizedFormat !== 'comparison') {
      return {};
    }

    const matchedTemplate = getDefaultBlogTemplates().find((template) => {
      return template.content_type === 'blog' && template.format_type === normalizedFormat;
    });

    if (!matchedTemplate) return {};

    return {
      templateName: matchedTemplate.name,
      templateBlocks: instantiateBlogTemplate(matchedTemplate, targetWords),
    };
  };

  const themeInput: ThemeInput = {
    topic:          topic.trim(),
    cluster:        typeof cluster        === 'string' ? cluster.trim()        : undefined,
    intent:         typeof intent         === 'string' ? intent.trim()         : undefined,
    related_blogs:  Array.isArray(related_blogs)
      ? related_blogs.filter((b: unknown) => typeof b === 'string')
      : undefined,
    series_context: typeof series_context === 'string' ? series_context.trim() : undefined,
  };

  // Blog Governance Parity: resolve once per generation and expose a stable
  // public metadata envelope on every result branch.
  const governance: GovernancePromptContext | null = await (async () => {
    try {
      const { getProfile } = await import('../../backend/services/companyProfileService');
      const { buildGovernancePromptContext } = await import('../../backend/services/creator/strategyGovernancePromptContext');
      const profile = await getProfile(company_id, { autoRefine: false });
      if (!profile) return null;
      const ctx = buildGovernancePromptContext({
        companyContext: {
          industry: profile.industry ?? null,
          industry_list: profile.industry_list ?? null,
          category: profile.category ?? null,
          category_list: profile.category_list ?? null,
        },
        contentType: 'image',
        selectedStrategy: null,
      });
      const { maybeAuditRestrictedStrategySelection } =
        await import('../../backend/services/creator/governanceItemEnricher');
      maybeAuditRestrictedStrategySelection({
        context: ctx,
        companyId: company_id,
        contentType,
        actorUserId: null,
      });
      return ctx;
    } catch {
      return null;
    }
  })();

  const hasAnswers = (
    answers !== null &&
    answers !== undefined &&
    typeof answers === 'object' &&
    Object.keys(answers).length > 0
  );

  // ── Clarification check ─────────────────────────────────────────────────────
  if (!hasAnswers && !selected_angle) {
    const questions = generateClarificationQuestions(themeInput);
    if (questions.length > 0) {
      return attachBlogGovernanceMetadata({
        needs_clarification: true,
        questions,
        governance: buildGovernanceExplainabilityMetadata(governance),
      }, governance);
    }
  }

  const confidence: 'high' | 'medium' = hasAnswers ? 'medium' : 'high';

  const contextualAnswers: Record<string, string> = {
    ...(hasAnswers ? (answers as Record<string, string>) : {}),
  };
  if (companyContext?.audience && !contextualAnswers.audience) {
    contextualAnswers.audience = companyContext.audience;
  }
  if (companyContext?.industry && !contextualAnswers.industry) {
    contextualAnswers.industry = companyContext.industry;
  }
  if (companyContext?.brand_voice && !contextualAnswers.tone) {
    contextualAnswers.tone = companyContext.brand_voice;
  }

  // ── Auto-enrich contextual fields from company profile ─────────────────────
  // These fields dramatically improve AI output depth. Only populate when the
  // user hasn't explicitly provided them, so manual overrides always win.

  if (!contextualAnswers.uniqueness_directive && companyContext) {
    const parts: string[] = [];
    if (companyContext.uniqueValue) parts.push(companyContext.uniqueValue);
    if (companyContext.competitiveAdvantages) parts.push(companyContext.competitiveAdvantages);
    if (parts.length > 0) {
      contextualAnswers.uniqueness_directive =
        `Differentiate by highlighting: ${parts.join('. ')}. Avoid generic advice — tie insights back to these unique strengths.`;
    }
  }

  // Phase 2.7 — Section-level strategic assignments replace the
  // must_include_points comma-joined blob.
  //
  // The previous synthesis dumped every company anchor (core problem, pain
  // points, transformation, authority, key messages, products/services,
  // tier-dependent directives) into one comma-joined string and assigned it
  // to `must_include_points`. The model treated this as a flat global
  // checklist → repetitive narrative inflation, every section name-dropping
  // every anchor.
  //
  // We now distribute the anchors across sections (intro / body / closing)
  // with deterministic rules — see lib/content/sectionStrategicAssignments.ts.
  // The downstream prompt receives a structured per-section directive block
  // via a new answer key (`section_strategic_assignments`) rather than the
  // old `must_include_points` blob.
  //
  // User-supplied `must_include_points` (passed in via `answers`) is
  // preserved — this branch only stops the AUTO-SYNTHESIS.
  if (!contextualAnswers.section_strategic_assignments && companyContext) {
    const twRaw = contextualAnswers.target_word_count ? parseInt(contextualAnswers.target_word_count, 10) : 0;
    const bundle = buildSectionStrategicAssignments(companyContext, {
      targetWordCount: twRaw || undefined,
      companyName: companyContext.companyName,
    });
    if (bundle.hasAssignments) {
      const rendered = renderSectionStrategicAssignmentsForPrompt(bundle);
      if (rendered) {
        contextualAnswers.section_strategic_assignments = rendered;
      }
    }
  }

  if (!contextualAnswers.campaign_objective && companyContext) {
    const objParts: string[] = [];
    if (companyContext.campaignFocus) objParts.push(companyContext.campaignFocus);
    else if (companyContext.growthPriorities) objParts.push(companyContext.growthPriorities);
    else if (companyContext.goals) objParts.push(companyContext.goals);
    if (intent) {
      const intentMap: Record<string, string> = {
        awareness:  'Build awareness and educate the audience',
        authority:  'Establish thought leadership and deep expertise',
        conversion: 'Drive readers toward a decision or action',
        retention:  'Deepen engagement with existing audience',
      };
      objParts.push(intentMap[intent] ?? intent);
    }
    if (objParts.length > 0) {
      contextualAnswers.campaign_objective = objParts.join('. ');
    }
  }

  // Strategy perspective is NO LONGER injected into contextualAnswers (A2).
  // It is now a MANDATORY part of the system prompt via buildIdentityLock +
  // buildAntiGenericRules — propagated through companyIdentity below.

  if (!contextualAnswers.trend_context && companyContext) {
    const trendParts: string[] = [];
    if (companyContext.industry) trendParts.push(`Industry: ${companyContext.industry}`);
    if (companyContext.geography) trendParts.push(`Geography: ${companyContext.geography}`);
    if (companyContext.contentThemes) trendParts.push(`Key themes: ${companyContext.contentThemes}`);
    if (trendParts.length > 0) {
      contextualAnswers.trend_context = trendParts.join('. ') + '. Reference current industry trends and developments.';
    }
  }

  const twRaw = contextualAnswers.target_word_count ? parseInt(contextualAnswers.target_word_count, 10) : 0;
  const defaultBlogTemplate = resolveDefaultBlogTemplate(formatType, twRaw || undefined);
  const effectiveTemplateName =
    defaultBlogTemplate.templateName ??
    (typeof template_name === 'string' ? template_name : undefined);
  const effectiveTemplateBlocks =
    defaultBlogTemplate.templateBlocks ??
    (Array.isArray(template_blocks) ? template_blocks : undefined);

  const templateDepthGuidance = deriveTemplateDepthGuidance(contentType, effectiveTemplateName, formatType, twRaw);
  if (templateDepthGuidance) {
    contextualAnswers.uniqueness_directive = contextualAnswers.uniqueness_directive
      ? `${contextualAnswers.uniqueness_directive} ${templateDepthGuidance.uniquenessRule}`
      : templateDepthGuidance.uniquenessRule;

    contextualAnswers.must_include_points = contextualAnswers.must_include_points
      ? `${contextualAnswers.must_include_points}; ${templateDepthGuidance.mustIncludePoints.join('; ')}`
      : templateDepthGuidance.mustIncludePoints.join('; ');
  }

  const hasContextualAnswers = Object.keys(contextualAnswers).length > 0;

  // Phase 2.5 — Canonical CompanyIdentity construction.
  //
  // Previously this site built CompanyIdentity directly from CompanyContext
  // (lossy projection) and dropped entityArchetype, competitorIntelligence,
  // and userGuidance — the three richest strategic fields. Long-form
  // generation therefore had a weaker identity lock than short-form.
  //
  // We now prefer `req.companyProfile` (canonical typed shape) and fall
  // back to CompanyContext only when the caller didn't supply a profile.
  // The consistency validator emits a structured warning if anything is
  // lossy or critical fields are missing.
  const builtFromFallback = !req.companyProfile && Boolean(companyContext);
  const companyIdentity: CompanyIdentity | undefined = buildCanonicalCompanyIdentity({
    profile: req.companyProfile,
    fallbackContext: companyContext,
  });
  validateIdentityConsistency(companyIdentity, {
    source: 'runBlogGeneration',
    builtFromFallback,
  });

  const baseInput: BlogGenerationInput = {
    ...themeInput,
    answers:        hasContextualAnswers ? contextualAnswers : undefined,
    selected_angle: selected_angle as BlogAngle | undefined,
    tone:           typeof tone      === 'string' ? tone.trim()      : undefined,
    goal_type:      typeof goal_type === 'string' ? goal_type.trim() : undefined,
    writingStyleInstructions: companyContext?.writingStyleInstructions,
    contentType,
    formatType,
    templateName: effectiveTemplateName,
    primaryKeyword: extractPrimaryKeyword(topic.trim()),
  };

  // ── Mode: angles ────────────────────────────────────────────────────────────
  if (mode === 'angles') {
    const [anglesResult, perfData, orchestratorResult] = await Promise.allSettled([

      // AI angle generation
      (async (): Promise<ReturnType<typeof validateAnglesOutput>> => {
        const aiResult = await runCompletionWithOperation({
          operation:       'blogGeneration',
          companyId:       company_id,
          cache_version:   cache_version,
          model:           'gpt-4o-mini',
          temperature:     0.7,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: buildAnglesSystemPrompt(contentType, companyIdentity, governance) },
            { role: 'user',   content: buildAnglesUserPrompt(baseInput) },
          ],
        });
        const raw = aiResult.output ? JSON.parse(aiResult.output) : null;
        return raw ? validateAnglesOutput(raw) : null;
      })(),

      // Angle frequency proxy — fallback when feedback data is insufficient
      fetchAngleData(company_id, blogTable),

      // Orchestrator: SEO + feedback + trend intelligence (parallel internally)
      buildGenerationContext({ contentType, topic: topic.trim(), companyId: company_id, blogTable }),
    ]);

    const angles = (anglesResult.status === 'fulfilled' && anglesResult.value)
      ? anglesResult.value
      : buildFallbackAngles(topic.trim());

    // Extract orchestrator results (best-effort)
    const ctx: OrchestratorResult | null =
      orchestratorResult.status === 'fulfilled' ? orchestratorResult.value : null;

    // Prefer effectiveness-based recommendation; fall back to frequency
    const feedback = ctx?.feedback ?? null;

    let recommended_angle: AngleType | null = null;
    let effectiveness_based = false;

    if (feedback?.has_sufficient_data && feedback.recommended_angle_type) {
      recommended_angle = feedback.recommended_angle_type;
      effectiveness_based = true;
    } else {
      recommended_angle =
        (perfData.status === 'fulfilled' && perfData.value) ? perfData.value : null;
    }

    return attachBlogGovernanceMetadata({
      needs_clarification: false,
      mode:                'angles',
      angles,
      recommended_angle,
      angle_effectiveness: feedback?.angle_effectiveness ?? {},
      effectiveness_based,
      seo_intelligence:    ctx?.seo ?? undefined,
      trend_intelligence:  ctx?.trends ?? undefined,
      governance:          buildGovernanceExplainabilityMetadata(governance),
    }, governance);
  }

  // ── Mode: full ──────────────────────────────────────────────────────────────

  // Orchestrator: all intelligence engines in parallel (non-blocking)
  const ctx = await buildGenerationContext({
    contentType, topic: topic.trim(), companyId: company_id, blogTable,
    formatType, targetWordCount: baseInput.answers?.target_word_count
      ? parseInt(String(baseInput.answers.target_word_count), 10) || 1200
      : 1200,
    companyContext,
  }).catch((): OrchestratorResult => {
    const doctrine = resolveOmnivyraDoctrineGenerationContext();
    const assimilation = assimilateCompanyEditorialPrimitives(companyContext);
    const narrativePlanning = buildNarrativePlanningPrimitives({
      topic: topic.trim(),
      contentType,
      doctrine,
      assimilation,
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
    return {
      seo: null,
      feedback: null,
      trends: null,
      structure: null,
      doctrine,
      assimilation,
      narrativePlanning,
      generationGuidance,
      editorialDepth,
      editorialAuthority,
      audienceMaturity,
      unifiedEditorialBrief,
      editorialRuntimeContext,
      generatorRuntimeAlignment,
      generatorBehavioralSteering,
    };
  });

  const unifiedPromptContext = buildUnifiedPromptContext(ctx);

  // Series continuation: fetch prior blog summaries via injectable
  let series_summaries: SeriesSummary[] | undefined;

  if (Array.isArray(series_blog_ids) && series_blog_ids.length > 0) {
    const validIds = series_blog_ids.filter((id: unknown) => typeof id === 'string');

    if (validIds.length > 0) {
      const fetched = await fetchSeriesData(validIds, company_id, blogTable);
      if (fetched.length > 0) series_summaries = fetched;
    }
  }

  const generationInput: BlogGenerationInput = { ...baseInput, series_summaries, unifiedPromptContext };

  try {
    const rawTargetWordCount =
      generationInput.answers?.target_word_count ??
      generationInput.answers?.word_count ??
      target_words;
    const targetWc = rawTargetWordCount != null
      ? parseInt(String(rawTargetWordCount), 10) || undefined
      : undefined;

    // Scale max_tokens to word target.
    // Template-aware path outputs JSON with block structure, metadata, and nested objects
    // which requires ~5 tokens per target word. Standard HTML path needs ~2.5 tokens/word.
    //
    // The 16384 ceiling is NOT arbitrary: it is gpt-4o's hard max-output-token
    // limit. Requesting more would be rejected by the provider, so we clamp
    // here. The practical consequence: at 2.5 tok/word the standard path tops
    // out near ~6500 words and the template path (5 tok/word) near ~3200 words.
    // Beyond that the model is forced to truncate; the AI gateway now logs
    // [ai-gateway] output-truncated (finish_reason=length) when this happens so
    // truncated long-form no longer ships silently.
    const TOKEN_OUTPUT_CEILING = 16384; // gpt-4o hard max output tokens
    const isTemplatePath = effectiveTemplateBlocks && Array.isArray(effectiveTemplateBlocks) && effectiveTemplateBlocks.length > 0;
    const tokensPerWord = isTemplatePath ? 5 : 2.5;
    const maxTokens = targetWc && targetWc >= 800
      ? Math.min(TOKEN_OUTPUT_CEILING, Math.max(4096, Math.round(targetWc * tokensPerWord)))
      : 4096;

    // Warn up-front when the requested word target cannot physically fit the
    // token ceiling — operators see the cause before the truncation log fires.
    if (targetWc && Math.round(targetWc * tokensPerWord) > TOKEN_OUTPUT_CEILING) {
      const maxAchievableWords = Math.floor(TOKEN_OUTPUT_CEILING / tokensPerWord);
      console.warn('[blog-generation] target-exceeds-token-budget', {
        contentType,
        requestedWords: targetWc,
        maxAchievableWords,
        tokensPerWord,
        path: isTemplatePath ? 'template' : 'standard',
        note: 'output will be truncated near maxAchievableWords for this model',
      });
    }

    // ── Template-aware generation path ─────────────────────────────────────
    // When a template is provided, AI fills the block structure directly
    // instead of generating a monolithic HTML blob.
    if (effectiveTemplateBlocks && Array.isArray(effectiveTemplateBlocks) && effectiveTemplateBlocks.length > 0) {
      const templateResult = await runTemplateBlogGenerationPath({
        company_id, topic, blogTable, cache_version, contentType, formatType,
        effectiveTemplateBlocks, effectiveTemplateName, targetWc, maxTokens,
        generationInput, ctx, confidence, selected_angle: selected_angle as BlogAngle | undefined,
        companyIdentity,
        governance,
      });
      if (templateResult !== null) {
        const result = attachEditorialDiagnostics(templateResult, ctx, { generationStartMs });
        return attachBlogGovernanceMetadata(result, governance);
      }
    }

    const standardResult = await runStandardHtmlBlogGeneration({
      company_id,
      topic,
      blogTable,
      targetWc,
      contentType,
      formatType,
      cache_version,
      maxTokens,
      generationInput,
      effectiveTemplateName,
      confidence,
      ctx,
      companyIdentity,
      // Phase 2.8 — Pass companyContext so the standard path emits
      // LONGFORM_CONTEXT_USAGE_REPORT against the actual assembled prompt.
      companyContext,
      governance,
    });
    const result = attachEditorialDiagnostics(standardResult, ctx, { generationStartMs });
    return attachBlogGovernanceMetadata(result, governance);

  } catch (err) {
    // C3: CompanyContextEnforcementError must propagate to the API route so
    // the caller returns a 422 quality-gate response instead of silently
    // shipping a weak fallback.
    if (err instanceof Error && err.name === 'CompanyContextEnforcementError') {
      throw err;
    }

    const fallback       = buildGenerationFallback(generationInput);
    let content_blocks = htmlToBlocks(fallback.content_html);

    // Best-effort internal links even on fallback
    content_blocks = await injectInternalLinks(
      content_blocks,
      topic.trim(),
      company_id,
      blogTable,
    );

    const fallbackResult = attachEditorialDiagnostics({
      needs_clarification: false,
      mode:                'full',
      confidence:          'medium',
      result:              { ...fallback, content_blocks },
      hook_assessment:     { strength: 'moderate', note: 'Review before publishing.' },
      governance:          buildGovernanceExplainabilityMetadata(governance),
    }, ctx, { generationStartMs });
    return attachBlogGovernanceMetadata(fallbackResult, governance);
  }
}
