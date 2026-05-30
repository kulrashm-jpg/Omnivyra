/**
 * runTemplateBlogGeneration
 *
 * Template-aware blog generation path.
 * Returns null when the path should fall through to standard HTML generation.
 * Extracted from runBlogGeneration.ts to keep the main orchestrator under 500 lines.
 */

import { runCompletionWithOperation } from '../../backend/services/aiGateway';
import { flattenBlocks } from './blockUtils';
import type { ContentBlock } from './blockTypes';
import {
  normalizeTemplateName,
  buildExcerptFromBlocks,
  analyzeTemplateContentBlocks,
  applyClassicStructuredRepair,
  applyTemplateStructuredRepair,
  assessBlogQualityScore,
  mergeClassicShortParagraphBlocks,
  ensureClassicSummaryBlock,
  stripHtmlForWordCount,
  deriveTemplateDepthGuidance,
  auditDepthCoverage,
} from './runBlogGenerationPureHelpers';
import {
  checkHookStrength,
  type HookAssessment,
} from './hookAssessment';
import {
  type BlogGenerationInput,
  type BlogGenerationOutput,
  type BlogAngle,
} from './blogGenerationEngine';
import type { BlogFormatType } from './blogStructureTemplates';
import { runClassicBlogGeneration } from './runClassicBlogGeneration';
import { runComparisonBlogGeneration } from './runComparisonBlogGeneration';
import { runEditorialBlogGeneration } from './runEditorialBlogGeneration';
import { runTutorialBlogGeneration } from './runTutorialBlogGeneration';
import { injectInternalLinks } from './runBlogGenerationDataAccess';
import { deepenTemplateParagraphsIndividually } from './runTemplateDeepening';
import type { OrchestratorResult } from '../content/contentGenerationOrchestrator';
import type { BlogGenerationResult } from './blogRunnerTypes';
import {
  buildRepairContextAnchor,
  extractCompanyIdentity,
  scoreCompanyContext,
  buildDiagnosticRetryReasons,
  buildIdentityLock,
  buildAntiGenericRules,
  assertCompanyContextAcceptable,
  CompanyContextEnforcementError,
  validateSectionCompanyContext,
  validateStrategyPresence,
  getDynamicContextThreshold,
  splitIntoSections,
  type CompanyIdentity,
} from '../content/companyContextBlock';
import { validateContentVariation } from '../content/contentVariationValidator';
import { getProfile } from '../../backend/services/companyProfileService';
import { buildGovernanceExplainabilityMetadata } from '../../backend/services/creator/strategyGovernancePromptContext';

export interface TemplateBlogGenerationParams {
  company_id: string;
  topic: string;
  blogTable: string;
  cache_version: string | undefined;
  contentType: string;
  formatType: string;
  effectiveTemplateBlocks: ContentBlock[];
  effectiveTemplateName: string | undefined;
  targetWc: number | undefined;
  maxTokens: number;
  generationInput: BlogGenerationInput;
  ctx: OrchestratorResult | null;
  confidence: 'high' | 'medium';
  selected_angle?: BlogAngle;
  /**
   * Company identity for mandatory prompt-level enforcement. When present,
   * buildTemplateAwareSystemPromptV2 is wrapped with buildIdentityLock +
   * buildAntiGenericRules. If omitted, the runner falls back to deriving
   * identity from the profile fetch already performed for repair anchoring.
   */
  companyIdentity?: CompanyIdentity;
  /**
   * Blog Governance Parity — optional governance prompt context.
   * When present, the template-aware system prompt is prepended with
   * the canonical compliance preamble before each AI call.
   */
  governance?: import('../../backend/services/creator/strategyGovernancePromptContext').GovernancePromptContext | null;
}

export async function runTemplateBlogGenerationPath(
  params: TemplateBlogGenerationParams,
): Promise<BlogGenerationResult | null> {
  const {
    company_id,
    topic,
    blogTable,
    cache_version,
    contentType,
    formatType,
    effectiveTemplateBlocks,
    effectiveTemplateName,
    targetWc,
    maxTokens,
    generationInput,
    ctx,
    confidence,
    selected_angle,
    companyIdentity: callerCompanyIdentity,
    governance,
  } = params;
  const governanceMetadata = buildGovernanceExplainabilityMetadata(governance);

  const { buildTemplateAwareSystemPromptV2, buildTemplateAwareUserPrompt, parseTemplateOutput } =
    await import('./blogGenerationEngine');

  // Build company identity for repair context anchoring.
  // must_include_points is auto-enriched from company profile in runBlogGeneration.ts
  // and contains serialized pain points, problem statement, and authority domains.
  const a = generationInput.answers || {};
  const mustInclude = a.must_include_points || '';
  const extractedPainPoints = mustInclude
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 10 && (
      s.toLowerCase().includes('pain') ||
      s.toLowerCase().includes('problem') ||
      s.toLowerCase().includes('challenge') ||
      s.toLowerCase().includes('struggle') ||
      s.toLowerCase().startsWith('key pain') ||
      s.toLowerCase().startsWith('the core')
    ))
    .slice(0, 3);
  const profileIdentity = extractCompanyIdentity(
    await getProfile(company_id, { autoRefine: false, languageRefine: false }).catch(() => null),
  );
  const _identity: CompanyIdentity = {
    ...profileIdentity,
    companyName: a.companyName || profileIdentity.companyName || undefined,
    industry: a.industry || profileIdentity.industry || undefined,
    targetAudience: a.audience || a.target_audience || profileIdentity.targetAudience || undefined,
    coreProblem: a.campaign_objective || profileIdentity.coreProblem || undefined,
    painPoints: extractedPainPoints.length > 0 ? extractedPainPoints : profileIdentity.painPoints,
    uniqueValue: a.uniqueness_directive || profileIdentity.uniqueValue || undefined,
  };
  const repairAnchor = buildRepairContextAnchor(_identity);

  // B2: Company enforcement prefix for repair system prompts. Each structured
  // repair call below prepends this so identity lock + anti-generic rules are
  // never stripped during repair iterations.
  const repairHasIdentity = !!(_identity.companyName || _identity.industry || _identity.coreProblem);
  const repairEnforcementPrefix = repairHasIdentity
    ? `${buildIdentityLock(_identity, 'blog repair')}\n\n${buildAntiGenericRules(_identity)}\n\n`
    : '';

  const normalizedTemplateName = normalizeTemplateName(effectiveTemplateName);
  const templateDepthGuidance = deriveTemplateDepthGuidance(
    contentType as any, effectiveTemplateName, formatType as any, targetWc ?? 0,
  );
  const isBlogTemplate = contentType === 'blog';
  const isClassicBlogTemplate = isBlogTemplate && normalizedTemplateName === 'classic';
  const isVisualFeatureBlogTemplate = isBlogTemplate && normalizedTemplateName === 'visual feature';
  const isComparisonBlogTemplate = isBlogTemplate && normalizedTemplateName === 'comparison';
  const isTutorialBlogTemplate = isBlogTemplate && normalizedTemplateName === 'tutorial';
  const isMagazineBlogTemplate = isBlogTemplate && normalizedTemplateName === 'magazine';
  const isNewsletterTemplate = contentType === 'newsletter';
  const isManagedLongformTemplate =
    contentType === 'article' ||
    contentType === 'guide' ||
    contentType === 'story' ||
    contentType === 'whitepaper';
  const isWhitepaperTemplate = contentType === 'whitepaper';
  const isGuideTemplate = contentType === 'guide';
  const isArticleTemplate = contentType === 'article';
  const isStoryTemplate = contentType === 'story';
  const isMinimalThesisTemplate = isNewsletterTemplate && normalizedTemplateName === 'minimal thesis';
  const isSplitScreenInsightTemplate = isNewsletterTemplate && normalizedTemplateName === 'split-screen insight';
  const isInsightLetterTemplate =
    isNewsletterTemplate &&
    (formatType === 'insight-letter' || normalizedTemplateName === 'minimal thesis' || normalizedTemplateName === 'split-screen insight');
  const isWeeklyBriefTemplate =
    isNewsletterTemplate &&
    (formatType === 'weekly-brief' || normalizedTemplateName === 'signal radar' || normalizedTemplateName === 'analyst board');
  const isStrategicLetterTemplate =
    isNewsletterTemplate &&
    (formatType === 'strategic-letter' || normalizedTemplateName === 'strategy memo' || normalizedTemplateName === 'market map');
  const isActionLetterTemplate =
    isNewsletterTemplate &&
    (formatType === 'action-letter' || normalizedTemplateName === 'operator playbook' || normalizedTemplateName === 'sprint sheet');

  if (isClassicBlogTemplate && targetWc) {
    try {
      const classicDraft = await runClassicBlogGeneration({
        companyId: company_id,
        cacheVersion: cache_version,
        topic: topic.trim(),
        templateBlocks: effectiveTemplateBlocks,
        generationInput,
        targetWords: targetWc,
        angleLabel: selected_angle?.label,
        governance,
      });

      if (classicDraft) {
        const content_blocks = await injectInternalLinks(
          classicDraft.content_blocks,
          topic.trim(),
          company_id,
          blogTable as 'blogs' | 'public_blogs',
          [classicDraft.title],
        );

        const result: BlogGenerationOutput & { content_blocks: unknown[] } = {
          title: classicDraft.title,
          excerpt: classicDraft.excerpt || buildExcerptFromBlocks(content_blocks),
          content_html: '',
          tags: classicDraft.tags,
          category: classicDraft.category,
          seo_meta_title: classicDraft.seo_meta_title,
          seo_meta_description: classicDraft.seo_meta_description || buildExcerptFromBlocks(content_blocks),
          key_insights: classicDraft.key_insights,
          content_blocks,
        };

        let hook_assessment: HookAssessment = { strength: 'moderate', note: '' };
        try {
          const firstPara = content_blocks.find((b: any) => b.type === 'paragraph');
          if (firstPara && 'html' in firstPara) {
            hook_assessment = await checkHookStrength(firstPara.html as string, company_id);
          }
        } catch {}

        return {
          needs_clarification: false,
          mode: 'full',
          confidence,
          result,
          hook_assessment,
          template_used: true,
          seo_intelligence: ctx.seo ?? undefined,
          trend_intelligence: ctx.trends ?? undefined,
          governance: governanceMetadata,
        };
      }
    } catch {
      // Fall back to shared template path if dedicated Classic generation fails.
    }
  }

  if (isTutorialBlogTemplate && targetWc) {
    try {
      const tutorialDraft = await runTutorialBlogGeneration({
        companyId: company_id,
        cacheVersion: cache_version,
        topic: topic.trim(),
        templateBlocks: effectiveTemplateBlocks,
        generationInput,
        targetWords: targetWc,
        angleLabel: selected_angle?.label,
        governance,
      });

      if (tutorialDraft) {
        const content_blocks = await injectInternalLinks(
          tutorialDraft.content_blocks,
          topic.trim(),
          company_id,
          blogTable as 'blogs' | 'public_blogs',
          [tutorialDraft.title],
        );

        const result: BlogGenerationOutput & { content_blocks: unknown[] } = {
          title: tutorialDraft.title,
          excerpt: tutorialDraft.excerpt || buildExcerptFromBlocks(content_blocks),
          content_html: '',
          tags: tutorialDraft.tags,
          category: tutorialDraft.category,
          seo_meta_title: tutorialDraft.seo_meta_title,
          seo_meta_description: tutorialDraft.seo_meta_description || buildExcerptFromBlocks(content_blocks),
          key_insights: tutorialDraft.key_insights,
          content_blocks,
        };

        let hook_assessment: HookAssessment = { strength: 'moderate', note: '' };
        try {
          const firstPara = content_blocks.find((b: any) => b.type === 'paragraph');
          if (firstPara && 'html' in firstPara) {
            hook_assessment = await checkHookStrength(firstPara.html as string, company_id);
          }
        } catch {}

        return {
          needs_clarification: false,
          mode: 'full',
          confidence,
          result,
          hook_assessment,
          template_used: true,
          seo_intelligence: ctx.seo ?? undefined,
          trend_intelligence: ctx.trends ?? undefined,
          governance: governanceMetadata,
        };
      }
    } catch {
      // Fall back to shared template path if dedicated Tutorial generation fails.
    }
  }

  if (isComparisonBlogTemplate && targetWc) {
    try {
      const comparisonDraft = await runComparisonBlogGeneration({
        companyId: company_id,
        cacheVersion: cache_version,
        topic: topic.trim(),
        templateBlocks: effectiveTemplateBlocks,
        generationInput,
        targetWords: targetWc,
        angleLabel: selected_angle?.label,
        governance,
      });

      if (comparisonDraft) {
        const content_blocks = await injectInternalLinks(
          comparisonDraft.content_blocks,
          topic.trim(),
          company_id,
          blogTable as 'blogs' | 'public_blogs',
          [comparisonDraft.title],
        );

        const result: BlogGenerationOutput & { content_blocks: unknown[] } = {
          title: comparisonDraft.title,
          excerpt: comparisonDraft.excerpt || buildExcerptFromBlocks(content_blocks),
          content_html: '',
          tags: comparisonDraft.tags,
          category: comparisonDraft.category,
          seo_meta_title: comparisonDraft.seo_meta_title,
          seo_meta_description: comparisonDraft.seo_meta_description || buildExcerptFromBlocks(content_blocks),
          key_insights: comparisonDraft.key_insights,
          content_blocks,
        };

        let hook_assessment: HookAssessment = { strength: 'moderate', note: '' };
        try {
          const firstPara = content_blocks.find((b: any) => b.type === 'paragraph');
          if (firstPara && 'html' in firstPara) {
            hook_assessment = await checkHookStrength(firstPara.html as string, company_id);
          }
        } catch {}

        return {
          needs_clarification: false,
          mode: 'full',
          confidence,
          result,
          hook_assessment,
          template_used: true,
          seo_intelligence: ctx.seo ?? undefined,
          trend_intelligence: ctx.trends ?? undefined,
          governance: governanceMetadata,
        };
      }
    } catch {
      // Fall back to shared template path if dedicated Comparison generation fails.
    }
  }

  if ((isVisualFeatureBlogTemplate || isMagazineBlogTemplate) && targetWc) {
    try {
      const editorialDraft = await runEditorialBlogGeneration({
        companyId: company_id,
        cacheVersion: cache_version,
        topic: topic.trim(),
        templateBlocks: effectiveTemplateBlocks,
        generationInput,
        targetWords: targetWc,
        angleLabel: selected_angle?.label,
        templateLabel: isVisualFeatureBlogTemplate ? 'Visual Feature' : 'Magazine',
        governance,
      });

      if (editorialDraft) {
        const content_blocks = await injectInternalLinks(
          editorialDraft.content_blocks,
          topic.trim(),
          company_id,
          blogTable as 'blogs' | 'public_blogs',
          [editorialDraft.title],
        );

        const result: BlogGenerationOutput & { content_blocks: unknown[] } = {
          title: editorialDraft.title,
          excerpt: editorialDraft.excerpt || buildExcerptFromBlocks(content_blocks),
          content_html: '',
          tags: editorialDraft.tags,
          category: editorialDraft.category,
          seo_meta_title: editorialDraft.seo_meta_title,
          seo_meta_description: editorialDraft.seo_meta_description || buildExcerptFromBlocks(content_blocks),
          key_insights: editorialDraft.key_insights,
          content_blocks,
        };

        let hook_assessment: HookAssessment = { strength: 'moderate', note: '' };
        try {
          const firstPara = content_blocks.find((b: any) => b.type === 'paragraph');
          if (firstPara && 'html' in firstPara) {
            hook_assessment = await checkHookStrength(firstPara.html as string, company_id);
          }
        } catch {}

        return {
          needs_clarification: false,
          mode: 'full',
          confidence,
          result,
          hook_assessment,
          template_used: true,
          seo_intelligence: ctx.seo ?? undefined,
          trend_intelligence: ctx.trends ?? undefined,
          governance: governanceMetadata,
        };
      }
    } catch {
      // Fall back to shared template path if dedicated editorial generation fails.
    }
  }

  // Prefer identity passed from runBlogGeneration (derived from companyContext);
  // fall back to identity reconstructed from profile + answers for standalone callers.
  const effectiveIdentity = callerCompanyIdentity ?? _identity;
  const baseTemplateSystemPrompt = buildTemplateAwareSystemPromptV2(
    targetWc ?? 1200,
    contentType,
    effectiveTemplateBlocks,
    effectiveTemplateName,
    effectiveIdentity,
  );
  // Blog Governance Parity — prepend the compliance preamble to every
  // template-aware system prompt invocation. No-op when no governance
  // applies (legacy callers see byte-identical prompts).
  const { applyGovernancePreambleToSystemPrompt } =
    await import('../../backend/services/creator/strategyGovernancePromptContext');
  const templateSystemPrompt = applyGovernancePreambleToSystemPrompt(
    baseTemplateSystemPrompt,
    governance ?? null,
  );
  const templateUserPrompt = buildTemplateAwareUserPrompt(generationInput, effectiveTemplateBlocks);

  const parseTemplateResult = (rawOutput: string | null | undefined) => {
    let parsedRaw: any = null;
    try {
      let rawText = rawOutput || '';
      rawText = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      parsedRaw = JSON.parse(rawText);
    } catch (jsonErr) {
      console.error('[template-gen] JSON parse failed:', jsonErr, 'raw output (first 500 chars):', rawOutput?.substring(0, 500));
    }

    return {
      raw: parsedRaw,
      parsed: parsedRaw ? parseTemplateOutput(parsedRaw, effectiveTemplateBlocks) : null,
      blockCount: Array.isArray(parsedRaw?.blocks)
        ? parsedRaw.blocks.length
        : Array.isArray(parsedRaw?.template_blocks)
        ? parsedRaw.template_blocks.length
        : Array.isArray(parsedRaw?.filled_blocks)
        ? parsedRaw.filled_blocks.length
        : Array.isArray(parsedRaw?.content_blocks)
        ? parsedRaw.content_blocks.length
        : Array.isArray(parsedRaw?.content)
        ? parsedRaw.content.length
        : null,
    };
  };

  const tplResult = await runCompletionWithOperation({
    operation:       'blogGeneration',
    companyId:       company_id,
    cache_version:   cache_version,
    model:           'gpt-4o',
    temperature:     0.5,
    response_format: { type: 'json_object' },
    max_tokens:      maxTokens,
    messages: [
      { role: 'system', content: templateSystemPrompt },
      { role: 'user',   content: templateUserPrompt },
    ],
  });

  let { raw: tplRaw, parsed: tplParsed, blockCount: tplBlockCount } = parseTemplateResult(tplResult.output);

  if (!tplParsed) {
    console.error('[template-gen] parseTemplateOutput returned null. AI keys:', tplRaw ? Object.keys(tplRaw) : 'null',
      'blocks type:', tplRaw?.blocks ? typeof tplRaw.blocks : 'missing',
      'blocks length:', Array.isArray(tplRaw?.blocks) ? tplRaw.blocks.length : 'N/A',
      'template length:', effectiveTemplateBlocks.length);
  }

  if (targetWc && targetWc >= 300) {
    const minAcceptable = Math.round(targetWc * 0.85);
    const templateLength = effectiveTemplateBlocks.length;
    const retryMaxTokens = Math.min(16384, Math.max(maxTokens, Math.round(targetWc * 6)));
    let bestRaw = tplRaw;
    let bestParsed = tplParsed;
    let bestBlockCount = tplBlockCount;
    let bestAnalysis = tplParsed ? analyzeTemplateContentBlocks(tplParsed.content_blocks) : null;
    const getTemplateQualityScore = (parsed: typeof bestParsed | null) => {
      if (!parsed || contentType !== 'blog') return null;
      return assessBlogQualityScore(parsed.content_blocks, {
        title: parsed.title,
        excerpt: parsed.excerpt || buildExcerptFromBlocks(parsed.content_blocks),
        seo_meta_title: parsed.seo_meta_title || parsed.title,
        seo_meta_description: parsed.seo_meta_description || buildExcerptFromBlocks(parsed.content_blocks),
        tags: parsed.tags,
        target_word_count: targetWc,
        format_type: typeof formatType === 'string' ? formatType as BlogFormatType : undefined,
      });
    };

    const getVariationValidation = (parsed: typeof bestParsed | null) => {
      if (!parsed) return null;
      const contentText = flattenBlocks(parsed.content_blocks)
        .filter((block): block is Extract<typeof block, { type: 'paragraph' }> => block.type === 'paragraph')
        .map((block) => ('html' in block ? String(block.html || '') : ''))
        .join('\n\n');
      return contentText.trim().length > 0 ? validateContentVariation(contentText, { contentType }) : null;
    };

    const candidateScore = (
      analysis: typeof bestAnalysis,
      blockCount: number | null,
    ): number => {
      if (!analysis) return -100000;
      return (
        analysis.wordCount
        + analysis.averageParagraphWords * 3
        - analysis.substantiveEmptyBlocks * 350
        - analysis.thinParagraphs * 120
        - analysis.thinSummaries * 100
        - analysis.weakKeyInsights * 80
        - analysis.weakLists * 90
        - analysis.thinListItems * 12
        - analysis.thinCallouts * 70
        - analysis.thinQuotes * 50
        - analysis.weakReferences * 40
        - (blockCount !== templateLength ? Math.abs((blockCount ?? 0) - templateLength) * 250 : 0)
      );
    };

    const needsRetry = (
      parsed: typeof bestParsed,
      analysis: typeof bestAnalysis,
      blockCount: number | null,
    ): boolean => {
      const depthAudit = parsed
        ? auditDepthCoverage(parsed.content_blocks, {
            targetWords: targetWc ?? 1200,
            mustIncludePoints: mustInclude,
          })
        : null;

      if (
        !analysis ||
        analysis.wordCount < minAcceptable ||
        analysis.substantiveEmptyBlocks > 0 ||
        analysis.thinParagraphs > 0 ||
        analysis.thinSummaries > 0 ||
        analysis.weakKeyInsights > 0 ||
        analysis.weakLists > 0 ||
        analysis.thinCallouts > 0 ||
        blockCount !== templateLength
      ) {
        return true;
      }

      const qualityScore = getTemplateQualityScore(parsed);
      if (qualityScore && qualityScore.total < 75) return true;

      const variationValidation = getVariationValidation(parsed);
      const duplicateContentDetected = Boolean(variationValidation?.duplicateContentDetected);
      const lowVariationDetected = Boolean(variationValidation?.lowVariationDetected);
      if (duplicateContentDetected || lowVariationDetected) return true;
      if (depthAudit?.missingDepth) return true;

      if (isNewsletterTemplate) {
        if (analysis.emptyKeyInsights > 0 || analysis.emptySummaries > 0) return true;
        if (analysis.averageParagraphWords < (targetWc >= 1600 ? 80 : 68)) return true;
      }

      if (isManagedLongformTemplate) {
        if (analysis.wordCount < Math.round(targetWc * 0.88)) return true;
        if (analysis.substantiveEmptyBlocks > 0) return true;
        if (analysis.emptySummaries > 0 || analysis.thinSummaries > 0) return true;
        if (analysis.emptyKeyInsights > 0 || analysis.weakKeyInsights > 0) return true;
      }

      if (isArticleTemplate) {
        if (analysis.h2Count < (targetWc >= 1600 ? 4 : 3)) return true;
        if (analysis.averageParagraphWords < (targetWc >= 1600 ? 82 : 68)) return true;
        if (analysis.paragraphCount < (targetWc >= 1600 ? 7 : 5)) return true;
        if (analysis.refsCount < 3 || analysis.weakReferences > 0) return true;
      }

      if (isGuideTemplate) {
        if (analysis.h2Count < (targetWc >= 1800 ? 4 : 3)) return true;
        if (analysis.averageParagraphWords < (targetWc >= 1800 ? 85 : 72)) return true;
        if (analysis.paragraphCount < (targetWc >= 1800 ? 8 : 6)) return true;
        if (analysis.weakLists > 0 || analysis.thinListItems > 1) return true;
        if (analysis.refsCount < 2 || analysis.weakReferences > 0) return true;
      }

      if (isStoryTemplate) {
        if (analysis.h2Count < 3) return true;
        if (analysis.averageParagraphWords < (targetWc >= 1600 ? 78 : 62)) return true;
        if (analysis.paragraphCount < (targetWc >= 1600 ? 6 : 4)) return true;
      }

      if (isWhitepaperTemplate) {
        if (analysis.h2Count < 4) return true;
        if (analysis.averageParagraphWords < (targetWc >= 2500 ? 90 : 78)) return true;
        if (analysis.paragraphCount < (targetWc >= 2500 ? 8 : 6)) return true;
        if (analysis.refsCount < 3 || analysis.weakReferences > 0) return true;
        if (analysis.weakLists > 0 || analysis.thinListItems > 1) return true;
      }

      if (isClassicBlogTemplate) {
        if (analysis.wordCount < Math.round(targetWc * 0.9)) return true;
        if (analysis.h2Count < (targetWc >= 1200 ? 4 : 3)) return true;
        if (analysis.averageParagraphWords < (targetWc >= 1200 ? 75 : 70)) return true;
        if (analysis.thinParagraphs > (targetWc >= 1200 ? 2 : 1)) return true;
        if (analysis.emptySummaries > 0 || analysis.thinSummaries > 0) return true;
        if (analysis.refsCount < 3 || analysis.weakReferences > 0) return true;
      }

      if (isVisualFeatureBlogTemplate) {
        if (analysis.h2Count < 3) return true;
        if (analysis.averageParagraphWords < (targetWc >= 1600 ? 90 : 76)) return true;
        if (analysis.paragraphCount < (targetWc >= 1600 ? 7 : 6)) return true;
        if (analysis.imagesMissingAlt > 0) return true;
        if (analysis.refsCount < 3) return true;
        if (analysis.weakReferences > 0) return true;
      }

      if (isComparisonBlogTemplate) {
        if (analysis.h2Count < 3) return true;
        if (analysis.averageParagraphWords < (targetWc >= 1600 ? 88 : 74)) return true;
        if (analysis.paragraphCount < (targetWc >= 1600 ? 7 : 6)) return true;
        if (analysis.refsCount < 3) return true;
        if (analysis.weakLists > 0 || analysis.thinListItems > 1) return true;
        if (analysis.thinCallouts > 0 || analysis.emptyCallouts > 0) return true;
        if (analysis.weakReferences > 0) return true;
      }

      if (isTutorialBlogTemplate) {
        if (analysis.h2Count < 4) return true;
        if (analysis.averageParagraphWords < (targetWc >= 1600 ? 92 : 78)) return true;
        if (analysis.paragraphCount < (targetWc >= 1600 ? 8 : 7)) return true;
        if (analysis.refsCount < 3) return true;
        if (analysis.thinCallouts > 0 || analysis.emptyCallouts > 0) return true;
        if (analysis.weakReferences > 0) return true;
      }

      if (isMagazineBlogTemplate) {
        if (analysis.h2Count < 2) return true;
        if (analysis.averageParagraphWords < (targetWc >= 1600 ? 88 : 74)) return true;
        if (analysis.paragraphCount < (targetWc >= 1600 ? 6 : 5)) return true;
        if (analysis.refsCount < 3) return true;
        if (analysis.imagesMissingAlt > 0) return true;
        if (analysis.thinQuotes > 0 || analysis.emptyQuotes > 0) return true;
        if (analysis.thinCallouts > 0 || analysis.emptyCallouts > 0) return true;
        if (analysis.weakReferences > 0) return true;
      }

      if (isInsightLetterTemplate) {
        if (analysis.averageParagraphWords < (targetWc >= 1600 ? 95 : 80)) return true;
        if (analysis.thinQuotes > 0 || analysis.emptyQuotes > 0) return true;
        if (analysis.paragraphCount < 6) return true;
        if (analysis.thinSummaries > 0 || analysis.emptySummaries > 0) return true;
      }

      if (isMinimalThesisTemplate) {
        if (analysis.wordCount < Math.round(targetWc * 0.9)) return true;
        if (analysis.averageParagraphWords < (targetWc >= 1600 ? 105 : 92)) return true;
        if (analysis.thinParagraphs > (targetWc >= 1600 ? 0 : 1)) return true;
        if (analysis.emptyCallouts > 0 || analysis.thinCallouts > 0) return true;
        if (analysis.thinQuotes > 0 || analysis.emptyQuotes > 0) return true;
        if (analysis.weakKeyInsights > 0 || analysis.emptyKeyInsights > 0) return true;
        if (analysis.paragraphCount < (targetWc >= 1600 ? 9 : 8)) return true;
      }

      if (isSplitScreenInsightTemplate) {
        if (analysis.emptyCallouts > 0 || analysis.thinCallouts > 0) return true;
        if (analysis.thinQuotes > 0 || analysis.emptyQuotes > 0) return true;
        if (analysis.averageParagraphWords < (targetWc >= 1600 ? 92 : 78)) return true;
        if (analysis.paragraphCount < 7) return true;
      }

      if (isWeeklyBriefTemplate) {
        if (analysis.weakReferences > 0) return true;
        if (analysis.thinListItems > 0) return true;
        if (analysis.paragraphCount < 5) return true;
      }

      if (isStrategicLetterTemplate) {
        if (analysis.weakReferences > 0) return true;
        if (analysis.averageParagraphWords < (targetWc >= 1600 ? 90 : 75)) return true;
        if (analysis.paragraphCount < 6) return true;
      }

      if (isActionLetterTemplate) {
        if (analysis.weakReferences > 0) return true;
        if (analysis.weakLists > 0 || analysis.thinListItems > 0) return true;
        if (analysis.paragraphCount < 5) return true;
      }

      // Company context enforcement: reject structurally valid but generic content
      if (_identity.companyName && parsed) {
        const contentText = flattenBlocks(parsed.content_blocks)
          .filter((b): b is Extract<typeof b, { type: 'paragraph' }> => b.type === 'paragraph')
          .map(b => ('html' in b ? String(b.html || '') : ''))
          .join(' ');
        if (contentText.length > 100) {
          const ctxScore = scoreCompanyContext(contentText, _identity, { contentType });
          const duplicateContentDetected = ctxScore.duplicateContentDetected;
          const lowVariationDetected = ctxScore.lowVariationDetected;
          if (isNewsletterTemplate) {
            if (duplicateContentDetected || ctxScore.perspectiveMismatch || !ctxScore.scenarioPresent || ctxScore.score < 50) return true;
          } else if (duplicateContentDetected || lowVariationDetected || ctxScore.perspectiveMismatch || !ctxScore.scenarioPresent || ctxScore.score < 55) {
            return true;
          }
        }
      }

      return false;
    };

    if (needsRetry(bestParsed, bestAnalysis, bestBlockCount)) {
      try {
        for (const retryInstruction of [
          'Regenerate the COMPLETE template from scratch with full body depth in every substantive block.',
          'This is a second rejection. Return a fully written article, not a skeleton. Every paragraph block must contain real multi-paragraph content.',
        ]) {
          const retryIssues: string[] = [];
          if (!bestAnalysis) {
            retryIssues.push('template JSON could not be parsed into valid filled blocks');
          } else {
            const qualityScore = getTemplateQualityScore(bestParsed);
            const variationValidation = getVariationValidation(bestParsed);
            const depthAudit = bestParsed
              ? auditDepthCoverage(bestParsed.content_blocks, {
                  targetWords: targetWc ?? 1200,
                  mustIncludePoints: mustInclude,
                })
              : null;
            if (bestAnalysis.wordCount < minAcceptable) retryIssues.push(`word count too low (${bestAnalysis.wordCount} words, minimum ${minAcceptable})`);
            if (bestAnalysis.emptyParagraphs > 0) retryIssues.push(`${bestAnalysis.emptyParagraphs} empty paragraph block(s)`);
            if (bestAnalysis.thinParagraphs > 0) retryIssues.push(`${bestAnalysis.thinParagraphs} thin paragraph block(s) under 70 words`);
            if (bestAnalysis.emptyHeadings > 0) retryIssues.push(`${bestAnalysis.emptyHeadings} empty heading block(s)`);
            if (bestAnalysis.emptySummaries > 0) retryIssues.push(`${bestAnalysis.emptySummaries} empty summary block(s)`);
            if (bestAnalysis.thinSummaries > 0) retryIssues.push(`${bestAnalysis.thinSummaries} thin summary block(s)`);
            if (bestAnalysis.emptyKeyInsights > 0) retryIssues.push(`${bestAnalysis.emptyKeyInsights} empty key-insight block(s)`);
            if (bestAnalysis.weakKeyInsights > 0) retryIssues.push(`${bestAnalysis.weakKeyInsights} weak key-insight block(s)`);
            if (bestAnalysis.emptyLists > 0) retryIssues.push(`${bestAnalysis.emptyLists} empty list block(s)`);
            if (bestAnalysis.weakLists > 0) retryIssues.push(`${bestAnalysis.weakLists} weak list block(s)`);
            if (bestAnalysis.thinListItems > 0) retryIssues.push(`${bestAnalysis.thinListItems} thin list item(s)`);
            if (bestAnalysis.emptyCallouts > 0) retryIssues.push(`${bestAnalysis.emptyCallouts} empty callout block(s)`);
            if (bestAnalysis.thinCallouts > 0) retryIssues.push(`${bestAnalysis.thinCallouts} thin callout block(s)`);
            if (bestAnalysis.emptyQuotes > 0) retryIssues.push(`${bestAnalysis.emptyQuotes} empty quote block(s)`);
            if (bestAnalysis.thinQuotes > 0) retryIssues.push(`${bestAnalysis.thinQuotes} thin quote block(s)`);
            if (bestAnalysis.weakReferences > 0) retryIssues.push(`${bestAnalysis.weakReferences} weak reference block(s)`);
            if (isClassicBlogTemplate && bestAnalysis.wordCount < Math.round(targetWc * 0.9)) {
              retryIssues.push(`classic template is still too short (${bestAnalysis.wordCount} words for a ${targetWc}-word brief)`);
            }
            if (isClassicBlogTemplate && bestAnalysis.h2Count < (targetWc >= 1200 ? 4 : 3)) {
              retryIssues.push(`classic template still has too few filled H2 sections (${bestAnalysis.h2Count} found)`);
            }
            if (isClassicBlogTemplate && bestAnalysis.averageParagraphWords < (targetWc >= 1200 ? 75 : 70)) {
              retryIssues.push(`classic template body is still too thin on average (${bestAnalysis.averageParagraphWords} words per paragraph block)`);
            }
            if (isClassicBlogTemplate && (bestAnalysis.emptySummaries > 0 || bestAnalysis.thinSummaries > 0)) {
              retryIssues.push('classic template still lacks a complete summary block');
            }
            if (isClassicBlogTemplate && bestAnalysis.refsCount < 3) {
              retryIssues.push(`classic template still lacks enough references for GEO authority (${bestAnalysis.refsCount} found)`);
            }
            if (isVisualFeatureBlogTemplate && bestAnalysis.averageParagraphWords < (targetWc >= 1600 ? 90 : 76)) {
              retryIssues.push(`visual feature body is still too light on average (${bestAnalysis.averageParagraphWords} words per paragraph block)`);
            }
            if (isVisualFeatureBlogTemplate && bestAnalysis.h2Count < 3) {
              retryIssues.push(`visual feature still has too few filled H2 sections (${bestAnalysis.h2Count} found)`);
            }
            if (isVisualFeatureBlogTemplate && bestAnalysis.paragraphCount < (targetWc >= 1600 ? 7 : 6)) {
              retryIssues.push('visual feature still lacks enough written narrative around its image-led sections');
            }
            if (isVisualFeatureBlogTemplate && bestAnalysis.imagesMissingAlt > 0) {
              retryIssues.push(`${bestAnalysis.imagesMissingAlt} visual feature image block(s) still missing descriptive alt text`);
            }
            if (isVisualFeatureBlogTemplate && bestAnalysis.refsCount < 3) {
              retryIssues.push(`visual feature still lacks enough references for GEO authority (${bestAnalysis.refsCount} found)`);
            }
            if (isComparisonBlogTemplate && bestAnalysis.averageParagraphWords < (targetWc >= 1600 ? 88 : 74)) {
              retryIssues.push(`comparison analysis is still too thin on average (${bestAnalysis.averageParagraphWords} words per paragraph block)`);
            }
            if (isComparisonBlogTemplate && bestAnalysis.h2Count < 3) {
              retryIssues.push(`comparison still has too few filled H2 sections (${bestAnalysis.h2Count} found)`);
            }
            if (isComparisonBlogTemplate && bestAnalysis.refsCount < 3) {
              retryIssues.push(`comparison still lacks enough references for GEO authority (${bestAnalysis.refsCount} found)`);
            }
            if (isComparisonBlogTemplate && (bestAnalysis.weakLists > 0 || bestAnalysis.thinListItems > 1)) {
              retryIssues.push('comparison still has weak pros/cons or side-by-side criteria bullets');
            }
            if (isComparisonBlogTemplate && (bestAnalysis.emptyCallouts > 0 || bestAnalysis.thinCallouts > 0)) {
              retryIssues.push('comparison still lacks a strong decision-grade verdict callout');
            }
            if (isTutorialBlogTemplate && bestAnalysis.averageParagraphWords < (targetWc >= 1600 ? 92 : 78)) {
              retryIssues.push(`tutorial steps are still too thin on average (${bestAnalysis.averageParagraphWords} words per paragraph block)`);
            }
            if (isTutorialBlogTemplate && bestAnalysis.h2Count < 4) {
              retryIssues.push(`tutorial still has too few filled H2 sections (${bestAnalysis.h2Count} found)`);
            }
            if (isTutorialBlogTemplate && (bestAnalysis.emptyCallouts > 0 || bestAnalysis.thinCallouts > 0)) {
              retryIssues.push('tutorial still lacks usable prerequisites or troubleshooting callouts');
            }
            if (isTutorialBlogTemplate && bestAnalysis.paragraphCount < (targetWc >= 1600 ? 8 : 7)) {
              retryIssues.push('tutorial still lacks enough step-by-step body depth across the walkthrough');
            }
            if (isMagazineBlogTemplate && bestAnalysis.averageParagraphWords < (targetWc >= 1600 ? 88 : 74)) {
              retryIssues.push(`magazine feature is still too light on average (${bestAnalysis.averageParagraphWords} words per paragraph block)`);
            }
            if (isMagazineBlogTemplate && bestAnalysis.imagesMissingAlt > 0) {
              retryIssues.push(`${bestAnalysis.imagesMissingAlt} magazine image block(s) still missing descriptive alt text`);
            }
            if (isMagazineBlogTemplate && bestAnalysis.refsCount < 3) {
              retryIssues.push(`magazine feature still lacks enough references for GEO authority (${bestAnalysis.refsCount} found)`);
            }
            if (isMagazineBlogTemplate && (bestAnalysis.emptyQuotes > 0 || bestAnalysis.thinQuotes > 0)) {
              retryIssues.push('magazine feature still lacks a strong pull quote or quote-support moment');
            }
            if (isMagazineBlogTemplate && (bestAnalysis.emptyCallouts > 0 || bestAnalysis.thinCallouts > 0)) {
              retryIssues.push('magazine feature still lacks a strong editorial takeaway callout');
            }
            if (isNewsletterTemplate && bestAnalysis.emptyKeyInsights > 0) {
              retryIssues.push('newsletter key insights block is still missing or empty');
            }
            if (isNewsletterTemplate && bestAnalysis.emptySummaries > 0) {
              retryIssues.push('newsletter summary block is still missing or empty');
            }
            if (isInsightLetterTemplate && bestAnalysis.averageParagraphWords < (targetWc >= 1600 ? 95 : 80)) {
              retryIssues.push(`newsletter reasoning is too thin on average (${bestAnalysis.averageParagraphWords} words per paragraph block)`);
            }
            if (isMinimalThesisTemplate && bestAnalysis.averageParagraphWords < (targetWc >= 1600 ? 105 : 92)) {
              retryIssues.push('minimal thesis still reads too thin for a true idea-led letter');
            }
            if (isMinimalThesisTemplate && bestAnalysis.wordCount < Math.round(targetWc * 0.9)) {
              retryIssues.push(`minimal thesis is still too short for its target (${bestAnalysis.wordCount} words for a ${targetWc}-word brief)`);
            }
            if (isMinimalThesisTemplate && (bestAnalysis.emptyCallouts > 0 || bestAnalysis.thinCallouts > 0)) {
              retryIssues.push('minimal thesis still lacks a strong thesis or practical-shift callout');
            }
            if (isMinimalThesisTemplate && (bestAnalysis.emptyQuotes > 0 || bestAnalysis.thinQuotes > 0)) {
              retryIssues.push('minimal thesis still lacks a strong extractable quote line');
            }
            if (isMinimalThesisTemplate && (bestAnalysis.weakKeyInsights > 0 || bestAnalysis.emptyKeyInsights > 0)) {
              retryIssues.push('minimal thesis still lacks a dense key insights block with enough standalone takeaways');
            }
            if (isMinimalThesisTemplate && bestAnalysis.paragraphCount < (targetWc >= 1600 ? 9 : 8)) {
              retryIssues.push('minimal thesis still lacks enough body paragraphs to feel like a complete insight letter');
            }
            if (isSplitScreenInsightTemplate && (bestAnalysis.emptyCallouts > 0 || bestAnalysis.thinCallouts > 0)) {
              retryIssues.push('split-screen insight still lacks a strong framing callout');
            }
            if (isSplitScreenInsightTemplate && (bestAnalysis.emptyQuotes > 0 || bestAnalysis.thinQuotes > 0)) {
              retryIssues.push('split-screen insight still lacks a strong extractable quote line');
            }
            if (isSplitScreenInsightTemplate && bestAnalysis.paragraphCount < 7) {
              retryIssues.push('split-screen insight still lacks enough body depth across its sections');
            }
            if (isWeeklyBriefTemplate && bestAnalysis.weakReferences > 0) {
              retryIssues.push('weekly brief still lacks grounded references or cited signals');
            }
            if (isStrategicLetterTemplate && bestAnalysis.weakReferences > 0) {
              retryIssues.push('strategic letter still lacks enough evidence, signals, or references');
            }
            if (isActionLetterTemplate && bestAnalysis.weakReferences > 0) {
              retryIssues.push('action letter still lacks enough supporting references, tools, or resources');
            }
            if (qualityScore && qualityScore.total < 75) {
              retryIssues.push(`quality panel score is still below threshold (${qualityScore.total}/100)`);
              retryIssues.push(...qualityScore.issues.slice(0, 6).map((issue) => issue.message));
            }
            if (variationValidation?.duplicateContentDetected) {
              retryIssues.push(
                `duplicate sections detected above 70% similarity (${variationValidation.duplicateSectionPairs.length} pair(s))`,
              );
            }
            if (variationValidation?.lowVariationDetected) {
              retryIssues.push(
                `${variationValidation.lowVariationSections.length} section(s) fail the variation check and do not introduce a new concept`,
              );
            }
            if (depthAudit?.missingMustIncludePoints.length) {
              retryIssues.push(
                `missing must_include_points: ${depthAudit.missingMustIncludePoints.slice(0, 5).join('; ')}`,
              );
            }
            if (depthAudit?.missingDepthElements.length) {
              retryIssues.push(
                `missing required depth elements: ${depthAudit.missingDepthElements.join(', ')}`,
              );
            }
            if (depthAudit?.shallowDepthElements.length) {
              retryIssues.push(
                `shallow depth elements detected: ${depthAudit.shallowDepthElements.join(', ')}`,
              );
            }
            if (depthAudit?.sectionCount && depthAudit.thinSectionRatio > 0.3) {
              retryIssues.push(
                `${depthAudit.thinSectionCount}/${depthAudit.sectionCount} sections are still thin and lack explanation or example depth`,
              );
            }
          }
          if (bestBlockCount !== templateLength) {
            retryIssues.push(`blocks array length mismatch (${bestBlockCount ?? 0} returned, expected ${templateLength})`);
          }

          const depthAudit = bestParsed
            ? auditDepthCoverage(bestParsed.content_blocks, {
                targetWords: targetWc ?? 1200,
                mustIncludePoints: mustInclude,
              })
            : null;
          const missingDepthLines = [
            ...((depthAudit?.missingMustIncludePoints ?? []).slice(0, 6).map((point) => `- ${point}`)),
            ...((depthAudit?.missingDepthElements ?? []).map((item) => `- ${item}`)),
            ...((depthAudit?.shallowDepthElements ?? []).map((item) => `- ${item} is present but still generic or placeholder-like`)),
            ...(depthAudit?.sectionCount && depthAudit.thinSectionRatio > 0.3
              ? [`- Too many thin sections (${depthAudit.thinSectionCount}/${depthAudit.sectionCount}) that lack explanation or example depth`]
              : []),
          ];

          const retryResult = await runCompletionWithOperation({
            operation:       'blogGeneration',
            companyId:       company_id,
            cache_version:   cache_version,
            model:           'gpt-4o',
            temperature:     0.45,
            response_format: { type: 'json_object' },
            max_tokens:      retryMaxTokens,
            messages: [
              { role: 'system', content: templateSystemPrompt },
              { role: 'user',   content: templateUserPrompt },
              ...(bestRaw ? [{ role: 'assistant' as const, content: JSON.stringify(bestRaw) }] : []),
              {
                role: 'user',
                content:
                  `REJECTED TEMPLATE FILL: ${retryIssues.join('; ')}.\n\n` +
                  (missingDepthLines.length > 0
                    ? `The previous draft is invalid because it failed to cover:\n${missingDepthLines.join('\n')}\n\nYou must explicitly include these in the revised draft.\n\n`
                    : '') +
                  `${retryInstruction}\n` +
                  repairAnchor + '\n' +
                  `Requirements:\n` +
                  `- Reach at least ${minAcceptable} words for this ${targetWc}-word target\n` +
                  `- Return exactly ${templateLength} top-level block entries in the blocks array\n` +
                  `- Keep the exact same block order and structure\n` +
                  `- Fill every substantive block with real content, not placeholders or notes\n` +
                  `- Use multiple <p> tags inside paragraph blocks whenever needed to create real section depth\n` +
                  `- For columns blocks, fill each nested block inside every column\n` +
                  `- Add concrete examples, reasoning, practical implications, and action-ready detail instead of filler\n` +
                  (isClassicBlogTemplate
                    ? `- For Classic, fill the full editorial structure with at least ${targetWc >= 1200 ? 4 : 3} strong H2 sections, a real summary, and at least 3 credible references\n- Do not return token metadata: provide a real excerpt and a real meta description, both grounded in the actual draft\n`
                    : '') +
                  (isVisualFeatureBlogTemplate
                    ? `- For Visual Feature, keep the visual rhythm, but make every written section carry real editorial analysis and practical interpretation\n`
                    : '') +
                  (isComparisonBlogTemplate
                    ? `- For Comparison, make the verdict decisional and scenario-based. Strengthen tradeoffs, criteria, and use-case guidance across both options\n`
                    : '') +
                  (isTutorialBlogTemplate
                    ? `- For Tutorial, deepen each step with rationale, execution detail, validation checks, and common failure modes so it reads like a true walkthrough\n`
                    : '') +
                  (isMagazineBlogTemplate
                    ? `- For Magazine, preserve the editorial pacing, but make the quote, narrative, analysis, and takeaway blocks all add standalone value\n`
                    : '') +
                  (isNewsletterTemplate
                    ? `- Keep the newsletter fully extractable with filled Key Insights and Summary blocks, plus references wherever the format benefits from authority grounding\n`
                    : '') +
                  (isInsightLetterTemplate
                    ? `- For this insight letter, sharpen the thesis with first-principles reasoning, one reusable mental model, one grounded example or pattern, and a quotable synthesis\n`
                    : '') +
                  (isMinimalThesisTemplate
                    ? `- For Minimal Thesis, make every major paragraph denser and more idea-led. The Hook, Insight, Expansion, and Implication sections should each feel complete on their own\n- Keep the insight-letter structure visibly intact and fill both the thesis callout and the practical-shift callout with extractable standalone value\n`
                    : '') +
                  (isSplitScreenInsightTemplate
                    ? `- For Split-Screen Insight, make the surface story and deeper reality contrast unmistakably clear, and make the framing callout, quote, and summary highly extractable for GEO and AI answers\n- Add one grounded example or observed pattern that proves the deeper reality, so the body reads as a full argument rather than a thin contrast\n`
                    : '') +
                  (isInsightLetterTemplate
                    ? `- Ensure the finished draft clearly fulfills Hook, Context, Insight, Expansion, Implication, and Closing with real substance in each section\n`
                    : '') +
                  (templateDepthGuidance
                    ? `- ${templateDepthGuidance.retryFocus.join('\n- ')}\n`
                    : '') +
                  `Return the same JSON format only.`,
              },
            ],
          });

          const retryState = parseTemplateResult(retryResult.output);
          const retryAnalysis = retryState.parsed ? analyzeTemplateContentBlocks(retryState.parsed.content_blocks) : null;
          if (candidateScore(retryAnalysis, retryState.blockCount) > candidateScore(bestAnalysis, bestBlockCount)) {
            bestRaw = retryState.raw;
            bestParsed = retryState.parsed;
            bestBlockCount = retryState.blockCount;
            bestAnalysis = retryAnalysis;
          }

          if (!needsRetry(bestParsed, bestAnalysis, bestBlockCount)) break;
        }
      } catch {
        // Best-effort retry only.
      }
    }

    if (isClassicBlogTemplate && needsRetry(bestParsed, bestAnalysis, bestBlockCount)) {
      try {
        for (let repairAttempt = 0; repairAttempt < 2; repairAttempt++) {
          const currentAnalysis = bestParsed ? analyzeTemplateContentBlocks(bestParsed.content_blocks) : null;
          const currentWordCount = currentAnalysis?.wordCount ?? 0;
          const currentH2Count = currentAnalysis?.h2Count ?? 0;
          const currentSummaryState = currentAnalysis
            ? `${currentAnalysis.emptySummaries} empty / ${currentAnalysis.thinSummaries} thin summary blocks`
            : 'unknown summary state';
          const currentKeyInsightsState = currentAnalysis
            ? `${currentAnalysis.emptyKeyInsights} empty / ${currentAnalysis.weakKeyInsights} weak key-insight blocks`
            : 'unknown key-insight state';
          const currentRefsCount = currentAnalysis?.refsCount ?? 0;
          const currentAvgParagraphWords = currentAnalysis?.averageParagraphWords ?? 0;

          const repairResult = await runCompletionWithOperation({
            operation:       'blogGeneration',
            companyId:       company_id,
            cache_version:   cache_version,
            model:           'gpt-4o',
            temperature:     0.35,
            response_format: { type: 'json_object' },
            max_tokens:      retryMaxTokens,
            messages: [
              { role: 'system', content: templateSystemPrompt },
              { role: 'user',   content: templateUserPrompt },
              ...(bestRaw ? [{ role: 'assistant' as const, content: JSON.stringify(bestRaw) }] : []),
              {
                role: 'user',
                content:
                  `CLASSIC TEMPLATE REPAIR PASS ${repairAttempt + 1}.\n\n` +
                  repairAnchor + '\n\n' +
                  `The current Classic article is still underfilled for a ${targetWc}-word brief.\n` +
                  `Current state: ${currentWordCount} words; ${currentH2Count} filled H2 sections; ${currentSummaryState}; ${currentKeyInsightsState}; ${currentRefsCount} references; average paragraph depth ${currentAvgParagraphWords} words.\n\n` +
                  `Rewrite the SAME Classic template blocks from scratch while keeping the exact same block order and total block count.\n\n` +
                  `Hard requirements:\n` +
                  `- Reach at least ${minAcceptable} words, and aim to land close to ${targetWc} words\n` +
                  `- Keep at least ${targetWc >= 1200 ? 4 : 3} strong H2 sections fully filled\n` +
                  `- Fill the Key Insights block with at least 3 concrete, standalone insights\n` +
                  `- Fill the Summary block with a real synthesis, not a label or placeholder\n` +
                  `- Include at least 3 credible reference entries with real titles and URLs when possible\n` +
                  `- Make every major paragraph block use multiple <p> tags when needed so sections feel substantial\n` +
                  `- Expand reasoning, examples, evidence, and practical implications inside each section\n` +
                  `- Do not compress the article into short notes or thin paragraphs\n` +
                  `- Provide a real excerpt and a real meta description grounded in the finished article\n` +
                  `- Return only the same JSON format with the same blocks array length\n\n` +
                  `Priority for this repair: body depth first, then summary completeness, then key insights, then references.`,
              },
            ],
          });

          const repairState = parseTemplateResult(repairResult.output);
          const repairAnalysis = repairState.parsed ? analyzeTemplateContentBlocks(repairState.parsed.content_blocks) : null;
          if (candidateScore(repairAnalysis, repairState.blockCount) > candidateScore(bestAnalysis, bestBlockCount)) {
            bestRaw = repairState.raw;
            bestParsed = repairState.parsed;
            bestBlockCount = repairState.blockCount;
            bestAnalysis = repairAnalysis;
          }

          if (!needsRetry(bestParsed, bestAnalysis, bestBlockCount)) break;
        }
      } catch {
        // Best-effort repair only.
      }
    }

    if (isClassicBlogTemplate && bestParsed && needsRetry(bestParsed, bestAnalysis, bestBlockCount)) {
      try {
        const currentAnalysis = analyzeTemplateContentBlocks(bestParsed.content_blocks);
        const paragraphBlueprint = flattenBlocks(bestParsed.content_blocks)
          .filter((block): block is Extract<ContentBlock, { type: 'paragraph' }> => block.type === 'paragraph')
          .map((block, index) => ({
            index: index + 1,
            currentWords: stripHtmlForWordCount(block.html).split(/\s+/).filter(Boolean).length,
          }));
        const paragraphTarget = Math.max(
          targetWc >= 1600 ? 150 : 120,
          Math.round((minAcceptable * 0.82) / Math.max(1, paragraphBlueprint.length)),
        );
        const summaryTarget = Math.max(90, Math.round(targetWc * 0.1));

        const structuredRepair = await runCompletionWithOperation({
          operation:       'blogGeneration',
          companyId:       company_id,
          cache_version:   cache_version,
          model:           'gpt-4o',
          temperature:     0.3,
          response_format: { type: 'json_object' },
          max_tokens:      retryMaxTokens,
          messages: [
            {
              role: 'system',
              content:
                repairEnforcementPrefix +
                `You are repairing a Classic blog article that must satisfy a fixed editorial structure.\n` +
                `Return JSON only with these fields:\n` +
                `{\n` +
                `  "excerpt": "string",\n` +
                `  "seo_meta_description": "string",\n` +
                `  "key_insights": ["...", "...", "..."],\n` +
                `  "paragraphs": [{ "html": "<p>...</p><p>...</p>" }],\n` +
                `  "summary_body": "string",\n` +
                `  "references": [{ "title": "...", "url": "..." }]\n` +
                `}\n` +
                `Rules:\n` +
                `- Return exactly ${paragraphBlueprint.length} paragraph entries in order.\n` +
                `- Each paragraph entry must use valid <p> HTML and contain at least ${paragraphTarget} words of real editorial content.\n` +
                `- The complete repaired article must reach at least ${minAcceptable} words and aim for ${targetWc} words.\n` +
                `- Summary must be at least ${summaryTarget} words and feel like a real conclusion.\n` +
                `- Key insights must be standalone, specific, and usable in SEO/GEO snippets.\n` +
                `- Summary must synthesize the whole argument and provide a clear takeaway.\n` +
                `- References must be credible and specific, with real titles and URLs whenever possible.\n`,
            },
            {
              role: 'user',
              content:
                `Repair this Classic blog draft for topic "${topic.trim()}".\n\n` +
                repairAnchor + '\n\n' +
                `Current weak state:\n` +
                `- words: ${currentAnalysis.wordCount}\n` +
                `- H2 sections: ${currentAnalysis.h2Count}\n` +
                `- average paragraph words: ${currentAnalysis.averageParagraphWords}\n` +
                `- empty summaries: ${currentAnalysis.emptySummaries}\n` +
                `- weak key insights: ${currentAnalysis.weakKeyInsights}\n` +
                `- references: ${currentAnalysis.refsCount}\n\n` +
                `Paragraph slots to expand in order:\n` +
                `${paragraphBlueprint.map((item) => `- Paragraph ${item.index}: currently ${item.currentWords} words`).join('\n')}\n\n` +
                `Priorities:\n` +
                `- Expand body depth first so the article stops being thin\n` +
                `- Make each paragraph slot meaningfully longer than it is now; do not leave any slot below ${paragraphTarget} words if it carries substantive body content\n` +
                `- Fill at least 3 strong key insights\n` +
                `- Fill the summary completely\n` +
                `- Provide at least 3 references\n` +
                `- Write excerpt and meta description grounded in the repaired article\n`,
            },
          ],
        });

        const structuredRaw = structuredRepair.output ? JSON.parse(structuredRepair.output) : null;
        const structuredApplied = applyClassicStructuredRepair(bestParsed.content_blocks, structuredRaw);
        const structuredAnalysis = analyzeTemplateContentBlocks(structuredApplied.blocks);

        if (candidateScore(structuredAnalysis, bestBlockCount) > candidateScore(bestAnalysis, bestBlockCount)) {
          bestParsed = {
            ...bestParsed,
            excerpt: structuredApplied.excerpt || bestParsed.excerpt,
            seo_meta_description: structuredApplied.seoMetaDescription || bestParsed.seo_meta_description,
            key_insights: structuredApplied.keyInsights.length > 0 ? structuredApplied.keyInsights : bestParsed.key_insights,
            content_blocks: structuredApplied.blocks,
          };
          bestAnalysis = structuredAnalysis;
        }
      } catch {
        // Best-effort structured repair only.
      }
    }

    if ((isComparisonBlogTemplate || isTutorialBlogTemplate) && bestParsed && needsRetry(bestParsed, bestAnalysis, bestBlockCount)) {
      try {
        const currentAnalysis = analyzeTemplateContentBlocks(bestParsed.content_blocks);
        const repairLabel = isComparisonBlogTemplate ? 'Comparison' : 'Tutorial';
        const repairFocus = isComparisonBlogTemplate
          ? 'Expand the comparison logic, add decision-grade tradeoffs, fill the references block, and make each H2 section substantively complete.'
          : 'Expand each tutorial step with execution detail, rationale, troubleshooting, and validation guidance, and fill the references block with useful supporting resources.';

        const focusedRepair = await runCompletionWithOperation({
          operation:       'blogGeneration',
          companyId:       company_id,
          cache_version:   cache_version,
          model:           'gpt-4o',
          temperature:     0.35,
          response_format: { type: 'json_object' },
          max_tokens:      retryMaxTokens,
          messages: [
            { role: 'system', content: templateSystemPrompt },
            { role: 'user',   content: templateUserPrompt },
            ...(bestRaw ? [{ role: 'assistant' as const, content: JSON.stringify(bestRaw) }] : []),
            {
              role: 'user',
              content:
                `${repairLabel.toUpperCase()} TEMPLATE REPAIR PASS.\n\n` +
                repairAnchor + '\n\n' +
                `Current draft quality is still too weak for the visible quality panel.\n` +
                `Current state: ${currentAnalysis.wordCount} words, ${currentAnalysis.h2Count} filled H2 sections, ${currentAnalysis.refsCount} references, average paragraph depth ${currentAnalysis.averageParagraphWords} words.\n\n` +
                `${repairFocus}\n\n` +
                `Requirements:\n` +
                `- Reach at least ${minAcceptable} words and aim to land close to ${targetWc}\n` +
                `- Keep the same template block order and structure\n` +
                `- Fill all major paragraph blocks with real multi-paragraph content\n` +
                `- Fill the references block with at least 3 credible entries\n` +
                `- Make the summary fully written and decision-useful\n` +
                `- Provide a real excerpt and a real meta description\n` +
                `- Return only the same JSON format`,
            },
          ],
        });

        const focusedState = parseTemplateResult(focusedRepair.output);
        const focusedAnalysis = focusedState.parsed ? analyzeTemplateContentBlocks(focusedState.parsed.content_blocks) : null;
        if (candidateScore(focusedAnalysis, focusedState.blockCount) > candidateScore(bestAnalysis, bestBlockCount)) {
          bestRaw = focusedState.raw;
          bestParsed = focusedState.parsed;
          bestBlockCount = focusedState.blockCount;
          bestAnalysis = focusedAnalysis;
        }
      } catch {
        // Best-effort focused repair only.
      }
    }

    if (isTutorialBlogTemplate && bestParsed && needsRetry(bestParsed, bestAnalysis, bestBlockCount)) {
      try {
        const currentAnalysis = analyzeTemplateContentBlocks(bestParsed.content_blocks);
        const paragraphBlueprint = flattenBlocks(bestParsed.content_blocks)
          .filter((block): block is Extract<ContentBlock, { type: 'paragraph' }> => block.type === 'paragraph')
          .map((block, index) => ({
            index: index + 1,
            currentWords: stripHtmlForWordCount(block.html).split(/\s+/).filter(Boolean).length,
          }));
        const listBlueprint = flattenBlocks(bestParsed.content_blocks)
          .filter((block): block is Extract<ContentBlock, { type: 'list' }> => block.type === 'list')
          .map((block, index) => ({
            index: index + 1,
            currentItems: block.items.filter((item) => item.text.trim().length > 0).length,
          }));
        const paragraphTarget = Math.max(
          targetWc >= 1600 ? 170 : targetWc >= 1200 ? 145 : 125,
          Math.round((minAcceptable * 0.84) / Math.max(1, paragraphBlueprint.length)),
        );
        const summaryTarget = Math.max(90, Math.round(targetWc * 0.1));
        const listItemTarget = targetWc >= 1600 ? 5 : 4;

        const structuredRepair = await runCompletionWithOperation({
          operation:       'blogGeneration',
          companyId:       company_id,
          cache_version:   cache_version,
          model:           'gpt-4o',
          temperature:     0.3,
          response_format: { type: 'json_object' },
          max_tokens:      retryMaxTokens,
          messages: [
            {
              role: 'system',
              content:
                repairEnforcementPrefix +
                `You are repairing a Tutorial blog article that must satisfy a fixed step-by-step structure.\n` +
                `Return JSON only with these fields:\n` +
                `{\n` +
                `  "excerpt": "string",\n` +
                `  "seo_meta_description": "string",\n` +
                `  "paragraphs": [{ "html": "<p>...</p><p>...</p>" }],\n` +
                `  "lists": [["...", "..."]],\n` +
                `  "summary_body": "string",\n` +
                `  "references": [{ "title": "...", "url": "..." }]\n` +
                `}\n` +
                `Rules:\n` +
                `- Return exactly ${paragraphBlueprint.length} paragraph entries in order.\n` +
                `- Return exactly ${listBlueprint.length} list entries in order.\n` +
                `- Each paragraph entry must use valid <p> HTML and contain at least ${paragraphTarget} words of real tutorial guidance.\n` +
                `- Each list must contain at least ${listItemTarget} filled items unless the source block has fewer slots.\n` +
                `- Each tutorial step should feel like a real walkthrough: what to do, why it matters, what can go wrong, and how to verify success.\n` +
                `- The repaired article must reach at least ${minAcceptable} words and aim for ${targetWc} words.\n` +
                `- Summary must be at least ${summaryTarget} words and explain what was built, what to verify, and what to do next.\n` +
                `- References must be credible and useful supporting resources with real titles and URLs whenever possible.\n`,
            },
            {
              role: 'user',
              content:
                `Repair this Tutorial blog draft for topic "${topic.trim()}".\n\n` +
                repairAnchor + '\n\n' +
                `Current weak state:\n` +
                `- words: ${currentAnalysis.wordCount}\n` +
                `- average paragraph words: ${currentAnalysis.averageParagraphWords}\n` +
                `- thin paragraphs: ${currentAnalysis.thinParagraphs}\n` +
                `- references: ${currentAnalysis.refsCount}\n\n` +
                `Paragraph slots to expand in order:\n` +
                `${paragraphBlueprint.map((item) => `- Paragraph ${item.index}: currently ${item.currentWords} words`).join('\n')}\n\n` +
                `List slots to expand in order:\n` +
                `${listBlueprint.map((item) => `- List ${item.index}: currently ${item.currentItems} filled items`).join('\n')}\n\n` +
                `Priorities:\n` +
                `- Increase tutorial depth substantially\n` +
                `- Make each paragraph slot meaningfully longer than it is now; do not leave any core step below ${paragraphTarget} words\n` +
                `- Make every step teach execution, rationale, troubleshooting, and validation\n` +
                `- Fill the references block with at least 3 useful sources/resources\n` +
                `- Write excerpt and meta description grounded in the repaired tutorial\n`,
            },
          ],
        });

        const structuredRaw = structuredRepair.output ? JSON.parse(structuredRepair.output) : null;
        const structuredApplied = applyTemplateStructuredRepair(bestParsed.content_blocks, structuredRaw);
        const structuredAnalysis = analyzeTemplateContentBlocks(structuredApplied.blocks);

        if (candidateScore(structuredAnalysis, bestBlockCount) > candidateScore(bestAnalysis, bestBlockCount)) {
          bestParsed = {
            ...bestParsed,
            excerpt: structuredApplied.excerpt || bestParsed.excerpt,
            seo_meta_description: structuredApplied.seoMetaDescription || bestParsed.seo_meta_description,
            content_blocks: structuredApplied.blocks,
          };
          bestAnalysis = structuredAnalysis;
        }
      } catch {
        // Best-effort structured tutorial repair only.
      }
    }

    if ((isClassicBlogTemplate || isComparisonBlogTemplate || isTutorialBlogTemplate) && bestParsed && bestAnalysis) {
      const severeDepthFailure =
        bestAnalysis.wordCount < Math.round(minAcceptable * 0.45) ||
        (isClassicBlogTemplate && targetWc >= 1600 && bestAnalysis.wordCount < Math.round(targetWc * 0.2));

      if (severeDepthFailure) {
        try {
          const minParagraphWords = isClassicBlogTemplate
            ? (targetWc >= 2000 ? 180 : 155)
            : isTutorialBlogTemplate
            ? (targetWc >= 1200 ? 160 : 145)
            : (targetWc >= 1200 ? 150 : 135);

          const deepened = await deepenTemplateParagraphsIndividually({
            blocks: bestParsed.content_blocks,
            companyId: company_id,
            cacheVersion: cache_version,
            topic: topic.trim(),
            templateLabel: effectiveTemplateName || normalizedTemplateName || 'blog template',
            targetWords: targetWc,
            minAcceptable,
            minParagraphWords,
            useClassicRepair: isClassicBlogTemplate,
          });

          if (candidateScore(deepened.analysis, bestBlockCount) > candidateScore(bestAnalysis, bestBlockCount)) {
            bestParsed = {
              ...bestParsed,
              content_blocks: deepened.blocks,
              excerpt: bestParsed.excerpt || buildExcerptFromBlocks(deepened.blocks),
              seo_meta_description: bestParsed.seo_meta_description || buildExcerptFromBlocks(deepened.blocks),
            };
            bestAnalysis = deepened.analysis;
          }
        } catch {
          // Best-effort paragraph deepening only.
        }
      }
    }

    tplRaw = bestRaw;
    tplParsed = bestParsed;
    tplBlockCount = bestBlockCount;
  }

  if (tplParsed) {
    const finalTemplateAnalysis = analyzeTemplateContentBlocks(tplParsed.content_blocks);
    const shouldRejectManagedLongformTemplate =
      Boolean(targetWc) &&
      isManagedLongformTemplate &&
      (
        finalTemplateAnalysis.wordCount < Math.round((targetWc ?? 0) * 0.88) ||
        finalTemplateAnalysis.substantiveEmptyBlocks > 0 ||
        finalTemplateAnalysis.emptySummaries > 0 ||
        finalTemplateAnalysis.thinSummaries > 0 ||
        finalTemplateAnalysis.emptyKeyInsights > 0 ||
        finalTemplateAnalysis.weakKeyInsights > 0
      );

    if (shouldRejectManagedLongformTemplate) {
      console.warn('[template-gen] Managed long-form template output rejected; falling through to standard HTML generation', {
        contentType,
        templateName: effectiveTemplateName || normalizedTemplateName || 'unknown',
        wordCount: finalTemplateAnalysis.wordCount,
        targetWc,
        substantiveEmptyBlocks: finalTemplateAnalysis.substantiveEmptyBlocks,
        emptySummaries: finalTemplateAnalysis.emptySummaries,
        thinSummaries: finalTemplateAnalysis.thinSummaries,
        emptyKeyInsights: finalTemplateAnalysis.emptyKeyInsights,
        weakKeyInsights: finalTemplateAnalysis.weakKeyInsights,
      });
    } else {
    // Inject internal links
    let content_blocks = await injectInternalLinks(
      tplParsed.content_blocks,
      topic.trim(),
      company_id,
      blogTable as 'blogs' | 'public_blogs',
      [tplParsed.title],
    );

    // C1 + C3 + C5 + C6: final enforcement for the template path. Applies the
    // same company-context gate used by runStandardBlogGeneration so template
    // outputs cannot ship weak content either.
    if (callerCompanyIdentity || _identity.companyName) {
      const enforcementIdentity = callerCompanyIdentity ?? _identity;
      // Feed the paragraph text stream to the shared section splitter so the
      // template path shares one segmentation algorithm with the HTML path.
      const paragraphTexts = flattenBlocks(content_blocks as any)
        .filter((b: any) => b.type === 'paragraph')
        .map((b: any) => String(b.html || ''));
      const paragraphText = paragraphTexts
        .map((s: string) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
        .filter((s: string) => s.length > 0)
        .join('\n\n');

      if (paragraphText.length > 200) {
        const contextScore = scoreCompanyContext(paragraphText, enforcementIdentity, { contentType });
        const contextThreshold = getDynamicContextThreshold(contentType, targetWc);
        assertCompanyContextAcceptable(contextScore, contextThreshold);

        // Section-level check (C5/C6) — uses splitIntoSections for consistency.
        // The template path feeds paragraph blocks as an array so the helper
        // takes the array-input code path (no HTML re-parse).
        const sectionChunks = splitIntoSections(paragraphTexts, contentType);
        if (sectionChunks.length > 0) {
          const secCtx = validateSectionCompanyContext(sectionChunks, enforcementIdentity);
          const secStrategy = validateStrategyPresence(sectionChunks);
          if (secCtx.shouldRetry || secStrategy.shouldRetry) {
            const issues: string[] = [];
            if (secCtx.shouldRetry) issues.push(`${secCtx.failingSections}/${secCtx.totalSections} sections lack company-specific context`);
            if (secStrategy.shouldRetry) issues.push(`${secStrategy.failingSections}/${secStrategy.totalSections} sections missing strategy markers`);
            throw new CompanyContextEnforcementError(contextScore.score, contextThreshold, issues);
          }
        }

        // Observability log — single entry per template generation.
        console.info('[content-enforcement]', {
          contentType,
          path: 'template',
          target_words: targetWc,
          threshold: contextThreshold,
          final_score: contextScore.score,
          retry_count: 0, // template path does not use the context-retry loop
        });
      }
    }

    const result: BlogGenerationOutput & { content_blocks: unknown[] } = {
      title:                tplParsed.title,
      excerpt:              tplParsed.excerpt || buildExcerptFromBlocks(content_blocks),
      content_html:         '', // not used for template path
      tags:                 tplParsed.tags,
      category:             tplParsed.category,
      seo_meta_title:       tplParsed.seo_meta_title,
      seo_meta_description: tplParsed.seo_meta_description || buildExcerptFromBlocks(content_blocks),
      key_insights:         tplParsed.key_insights,
      content_blocks,
    };

    let hook_assessment: HookAssessment = { strength: 'moderate', note: '' };
    try {
      const firstPara = content_blocks.find((b: any) => b.type === 'paragraph');
      if (firstPara && 'html' in firstPara) {
        hook_assessment = await checkHookStrength(firstPara.html as string, company_id);
      }
    } catch {}

    return {
      needs_clarification: false,
      mode:                'full',
      confidence,
      result,
      hook_assessment,
      template_used:       true,
      seo_intelligence:    ctx.seo ?? undefined,
      trend_intelligence:  ctx.trends ?? undefined,
      governance:          governanceMetadata,
    };
    }
  }
  // If template parsing failed, fall through to standard generation
  console.warn('[template-gen] Template path failed — falling through to standard HTML generation');
  return null;
}
