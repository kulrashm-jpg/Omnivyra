/**
 * runStandardBlogGeneration
 *
 * Standard HTML-based blog generation path (non-template).
 * Called when the template path is not applicable or falls through.
 * Extracted from runBlogGeneration.ts to keep the main orchestrator under 500 lines.
 */

import { runCompletionWithOperation } from '../../backend/services/aiGateway';
import { flattenBlocks } from './blockUtils';
import { htmlToBlocks } from './htmlToBlocks';
import {
  buildGenerationSystemPrompt,
  buildGenerationUserPrompt,
  validateGenerationOutput,
  buildGenerationFallback,
  type BlogGenerationInput,
  type BlogGenerationOutput,
} from './blogGenerationEngine';
import type { BlogFormatType } from './blogStructureTemplates';
import {
  checkHookStrength,
  extractFirstParagraph,
  type HookAssessment,
} from './hookAssessment';
import {
  stripHtmlForWordCount,
  mergeClassicShortParagraphBlocks,
  ensureClassicSummaryBlock,
  ensureGeneratedMetadata,
  assessBlogQualityScore,
} from './runBlogGenerationPureHelpers';
import { injectInternalLinks } from './runBlogGenerationDataAccess';
import type { OrchestratorResult } from '../content/contentGenerationOrchestrator';
import type { BlogGenerationResult } from './blogRunnerTypes';

export interface StandardBlogGenerationParams {
  company_id: string;
  topic: string;
  blogTable: string;
  targetWc: number | undefined;
  contentType: string;
  formatType: string;
  cache_version: string | undefined;
  maxTokens: number;
  generationInput: BlogGenerationInput;
  effectiveTemplateName: string | undefined;
  confidence: 'high' | 'medium';
  ctx: OrchestratorResult | null;
}

export async function runStandardHtmlBlogGeneration(
  params: StandardBlogGenerationParams,
): Promise<BlogGenerationResult> {
  const {
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
  } = params;

  const aiResult = await runCompletionWithOperation({
    operation:       'blogGeneration',
    companyId:       company_id,
    cache_version:   cache_version,
    model:           'gpt-4o',
    temperature:     0.5,
    response_format: { type: 'json_object' },
    max_tokens:      maxTokens,
    messages: [
      { role: 'system', content: buildGenerationSystemPrompt(targetWc, contentType as any, formatType as any) },
      { role: 'user',   content: buildGenerationUserPrompt(generationInput) },
    ],
  });

  const raw = aiResult.output ? JSON.parse(aiResult.output) : null;
  const validatedGenerated = validateGenerationOutput(raw);
  const usedDeterministicFallback = !validatedGenerated;
  let generated = ensureGeneratedMetadata(validatedGenerated ?? buildGenerationFallback(generationInput));

  const isClassicTemplate = typeof effectiveTemplateName === 'string' && effectiveTemplateName.trim().toLowerCase() === 'classic';
  const isManagedLongformStandard =
    contentType === 'article' ||
    contentType === 'guide' ||
    contentType === 'story' ||
    contentType === 'whitepaper';

  if (targetWc && targetWc >= 300) {
    const htmlText = generated.content_html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const actualWords = htmlText.split(/\s+/).filter(Boolean).length;
    const minAcceptable = Math.round(targetWc * 0.85);
    const initialBlocks = htmlToBlocks(generated.content_html);
    const flatBlocks = flattenBlocks(initialBlocks);
    const paragraphWordCounts = flatBlocks
      .filter((block): block is Extract<typeof block, { type: 'paragraph' }> => block.type === 'paragraph')
      .map((block) => stripHtmlForWordCount(block.html).split(/\s+/).filter(Boolean).length)
      .filter((count) => count > 0);
    const shortParagraphs = paragraphWordCounts.filter((count) => count < 55).length;
    const avgParagraphWords = paragraphWordCounts.length
      ? Math.round(paragraphWordCounts.reduce((sum, count) => sum + count, 0) / paragraphWordCounts.length)
      : 0;
    const h2Count = flatBlocks.filter((block) => block.type === 'heading' && block.level === 2 && block.text.trim().length > 0).length;
    const summaryCount = flatBlocks.filter((block) => block.type === 'summary' && block.body.trim().length > 0).length;
    const refsCount = flatBlocks.reduce((count, block) => {
      if (block.type !== 'references') return count;
      return count + block.items.filter((ref) => String(ref.title ?? '').trim() || String(ref.url ?? '').trim()).length;
    }, 0);
    const classicDepthWeak =
      isClassicTemplate && (
        summaryCount === 0 ||
        refsCount < 3 ||
        (targetWc >= 2000 && (avgParagraphWords < 95 || shortParagraphs >= 3 || h2Count < 5)) ||
        (targetWc >= 1600 && targetWc < 2000 && (avgParagraphWords < 85 || shortParagraphs >= 3 || h2Count < 4)) ||
        (targetWc >= 1200 && targetWc < 1600 && (avgParagraphWords < 75 || shortParagraphs >= 2 || h2Count < 4)) ||
        (targetWc < 1200 && (avgParagraphWords < 65 || shortParagraphs >= 2 || h2Count < 3))
      );
    const managedLongformWeak =
      isManagedLongformStandard && (
        usedDeterministicFallback ||
        summaryCount === 0 ||
        (contentType !== 'story' && refsCount < (contentType === 'whitepaper' ? 5 : 3)) ||
        (contentType === 'whitepaper' && (avgParagraphWords < 85 || h2Count < 4 || shortParagraphs >= 2)) ||
        (contentType === 'guide' && (avgParagraphWords < 75 || h2Count < 3 || shortParagraphs >= 2)) ||
        (contentType === 'article' && (avgParagraphWords < 72 || h2Count < 3 || shortParagraphs >= 2)) ||
        (contentType === 'story' && (avgParagraphWords < 60 || h2Count < 3 || shortParagraphs >= 3))
      );

    if (actualWords < minAcceptable || classicDepthWeak || managedLongformWeak) {
      try {
        const contentLabel =
          contentType === 'whitepaper' ? 'whitepaper'
          : contentType === 'guide' ? 'guide'
          : contentType === 'story' ? 'story'
          : contentType === 'article' ? 'article'
          : 'article';
        const minimumRefs =
          contentType === 'whitepaper' ? 5
          : contentType === 'story' ? 1
          : 3;
        const retryReason = actualWords < minAcceptable
          ? `Your article is only ${actualWords} words but the target is ${targetWc} words (minimum ${minAcceptable}). This is ${Math.round((actualWords / targetWc) * 100)}% of the required length.`
          : managedLongformWeak
            ? `Your ${contentLabel} is still incomplete for the requested depth. It currently has ${actualWords} words, ${h2Count} H2 section(s), ${summaryCount} summary block(s), ${refsCount} reference entries, and ${shortParagraphs} thin paragraph(s).`
          : `Your article reaches ${actualWords} words, but the Classic draft is still incomplete or too thin. Average paragraph length is ${avgParagraphWords} words, there are ${shortParagraphs} thin paragraph(s), ${h2Count} H2 section(s), ${summaryCount} filled summary block(s), and ${refsCount} reference entries.`;
        let bestGenerated = generated;
        let bestWords = actualWords;
        let bestAvgParagraphWords = avgParagraphWords;
        let bestShortParagraphs = shortParagraphs;
        let bestH2Count = h2Count;
        let bestSummaryCount = summaryCount;
        let bestRefsCount = refsCount;
        let previousAssistantOutput = aiResult.output ?? '';

        const retryAttempts = isManagedLongformStandard ? 3 : (targetWc < 1200 ? 3 : 2);
        for (let attempt = 0; attempt < retryAttempts; attempt++) {
          const currentWeak =
            isManagedLongformStandard
              ? (
                  bestWords < minAcceptable ||
                  bestSummaryCount === 0 ||
                  bestRefsCount < minimumRefs ||
                  (contentType === 'whitepaper' && (bestAvgParagraphWords < 85 || bestShortParagraphs >= 2 || bestH2Count < 4)) ||
                  (contentType === 'guide' && (bestAvgParagraphWords < 75 || bestShortParagraphs >= 2 || bestH2Count < 3)) ||
                  (contentType === 'article' && (bestAvgParagraphWords < 72 || bestShortParagraphs >= 2 || bestH2Count < 3)) ||
                  (contentType === 'story' && (bestAvgParagraphWords < 60 || bestShortParagraphs >= 3 || bestH2Count < 3))
                )
              : (
                  bestSummaryCount === 0 ||
                  bestRefsCount < 3 ||
                  (targetWc >= 2000 && (bestAvgParagraphWords < 95 || bestShortParagraphs >= 3 || bestH2Count < 5)) ||
                  (targetWc >= 1600 && targetWc < 2000 && (bestAvgParagraphWords < 85 || bestShortParagraphs >= 3 || bestH2Count < 4)) ||
                  (targetWc >= 1200 && targetWc < 1600 && (bestAvgParagraphWords < 75 || bestShortParagraphs >= 2 || bestH2Count < 4)) ||
                  (targetWc < 1200 && (bestAvgParagraphWords < 70 || bestShortParagraphs >= 1 || bestH2Count < 3))
                );

          if (bestWords >= minAcceptable && !currentWeak) break;

          const retryResult = await runCompletionWithOperation({
            operation:       'blogGeneration',
            companyId:       company_id,
            cache_version:   cache_version,
            model:           'gpt-4o',
            temperature:     0.6,
            response_format: { type: 'json_object' },
            max_tokens:      maxTokens,
            messages: [
              { role: 'system', content: buildGenerationSystemPrompt(targetWc, contentType as any, formatType as any) },
              { role: 'user',   content: buildGenerationUserPrompt(generationInput) },
              ...(previousAssistantOutput ? [{ role: 'assistant' as const, content: previousAssistantOutput }] : []),
              { role: 'user', content: `REJECTED: ${retryReason}\n\nRegenerate the COMPLETE ${contentLabel} from scratch with:\n- ${targetWc} words minimum\n- At least ${targetWc >= 1200 ? 4 : 3} strong H2 sections${contentType === 'story' ? '' : ', each with 3–5 full paragraphs (60–120 words per paragraph)'}\n- A fully written Summary that synthesizes the argument instead of repeating section labels\n- At least ${minimumRefs} credible reference entries for GEO authority${contentType === 'story' ? ' where appropriate' : ''}\n- Provide a real excerpt suitable for listings and a real meta description suitable for search engines\n- Use concrete examples, data, practitioner implications, and actionable analysis to fill each section\n- Make every major section feel complete, not merely adequate\n- Do NOT pad with filler — add genuine depth and detail\n- Do NOT create more than 6 H2 sections — make each section deeper instead of adding more thin sections\n- End each H2 section with a clear takeaway sentence\n\nReturn the same JSON format. The full ${contentLabel} must be ${targetWc}+ words and substantively deeper.` },
            ],
          });
          previousAssistantOutput = retryResult.output ?? previousAssistantOutput;
          const retryRaw = retryResult.output ? JSON.parse(retryResult.output) : null;
          const retryGen = retryRaw ? validateGenerationOutput(retryRaw) : null;
          if (!retryGen) continue;

          const retryText = retryGen.content_html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          const retryWords = retryText.split(/\s+/).filter(Boolean).length;
          const retryBlocks = htmlToBlocks(retryGen.content_html);
          const retryFlatBlocks = flattenBlocks(retryBlocks);
          const retryParagraphWordCounts = retryFlatBlocks
            .filter((block): block is Extract<typeof block, { type: 'paragraph' }> => block.type === 'paragraph')
            .map((block) => stripHtmlForWordCount(block.html).split(/\s+/).filter(Boolean).length)
            .filter((count) => count > 0);
          const retryShortParagraphs = retryParagraphWordCounts.filter((count) => count < 55).length;
          const retryAvgParagraphWords = retryParagraphWordCounts.length
            ? Math.round(retryParagraphWordCounts.reduce((sum, count) => sum + count, 0) / retryParagraphWordCounts.length)
            : 0;
          const retryH2Count = retryFlatBlocks.filter((block) => block.type === 'heading' && block.level === 2 && block.text.trim().length > 0).length;
          const retrySummaryCount = retryFlatBlocks.filter((block) => block.type === 'summary' && block.body.trim().length > 0).length;
          const retryRefsCount = retryFlatBlocks.reduce((count, block) => {
            if (block.type !== 'references') return count;
            return count + block.items.filter((ref) => String(ref.title ?? '').trim() || String(ref.url ?? '').trim()).length;
          }, 0);
          const currentDepthScore =
            bestWords + bestAvgParagraphWords * 4 + bestH2Count * 40 + bestSummaryCount * 90 + bestRefsCount * 30 - bestShortParagraphs * 80;
          const retryDepthScore =
            retryWords + retryAvgParagraphWords * 4 + retryH2Count * 40 + retrySummaryCount * 90 + retryRefsCount * 30 - retryShortParagraphs * 80;

          if (retryDepthScore > currentDepthScore) {
            bestGenerated = retryGen;
            bestWords = retryWords;
            bestAvgParagraphWords = retryAvgParagraphWords;
            bestShortParagraphs = retryShortParagraphs;
            bestH2Count = retryH2Count;
            bestSummaryCount = retrySummaryCount;
            bestRefsCount = retryRefsCount;
          }
        }

        generated = ensureGeneratedMetadata(bestGenerated);
      } catch { /* retry is best-effort — use original if it fails */ }
    }

    if (isManagedLongformStandard) {
      const finalHtmlText = generated.content_html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const finalWords = finalHtmlText.split(/\s+/).filter(Boolean).length;
      if (finalWords < Math.round(targetWc * 0.4)) {
        throw new Error(`Generated ${contentType} draft was incomplete (${finalWords} words for a ${targetWc}-word target).`);
      }
    }
  }

  generated = ensureGeneratedMetadata(generated);

  let content_blocks = htmlToBlocks(generated.content_html);
  if (isClassicTemplate) {
    content_blocks = mergeClassicShortParagraphBlocks(content_blocks, targetWc ?? 800);
    content_blocks = ensureClassicSummaryBlock(content_blocks, generated.excerpt);
  }

  content_blocks = await injectInternalLinks(
    content_blocks,
    topic.trim(),
    company_id,
    blogTable as 'blogs' | 'public_blogs',
    [generated.title],
  );

  if (contentType === 'blog') {
    const qualityScore = assessBlogQualityScore(content_blocks, {
      title: generated.title,
      excerpt: generated.excerpt,
      seo_meta_title: generated.seo_meta_title,
      seo_meta_description: generated.seo_meta_description,
      tags: generated.tags,
      target_word_count: targetWc,
      format_type: typeof formatType === 'string' ? formatType as BlogFormatType : undefined,
    });

    if (qualityScore.total < 75 && qualityScore.issues.length > 0) {
      try {
        const qualityRetry = await runCompletionWithOperation({
          operation:       'blogGeneration',
          companyId:       company_id,
          cache_version:   cache_version,
          model:           'gpt-4o',
          temperature:     0.45,
          response_format: { type: 'json_object' },
          max_tokens:      maxTokens,
          messages: [
            { role: 'system', content: buildGenerationSystemPrompt(targetWc, contentType as any, formatType as any) },
            { role: 'user',   content: buildGenerationUserPrompt(generationInput) },
            ...(aiResult.output ? [{ role: 'assistant' as const, content: aiResult.output }] : []),
            {
              role: 'user',
              content:
                `REJECTED FOR QUALITY PANEL SCORE ${qualityScore.total}/100. Fix the exact issues below and regenerate the COMPLETE article from scratch.\n\n` +
                qualityScore.issues.slice(0, 8).map((issue) => `- ${issue.message}`).join('\n') +
                `\n\nRequirements:\n` +
                `- The revised draft must reach at least 75/100 in the blog quality panel\n` +
                `- Keep the article close to the ${targetWc}-word target\n` +
                `- Fill every required structural block so the visible quality suggestions are actually resolved\n` +
                `- Provide a real excerpt, meta title, and meta description\n` +
                `- Include enough references for GEO authority and internal links where possible\n` +
                `- Return the same JSON format only.`,
            },
          ],
        });

        const qualityRaw = qualityRetry.output ? JSON.parse(qualityRetry.output) : null;
        const qualityGenerated = qualityRaw ? validateGenerationOutput(qualityRaw) : null;
        if (qualityGenerated) {
          let retryBlocks = htmlToBlocks(qualityGenerated.content_html);
          if (isClassicTemplate) {
            retryBlocks = mergeClassicShortParagraphBlocks(retryBlocks, targetWc ?? 800);
            retryBlocks = ensureClassicSummaryBlock(retryBlocks, qualityGenerated.excerpt);
          }
          retryBlocks = await injectInternalLinks(
            retryBlocks,
            topic.trim(),
            company_id,
            blogTable as 'blogs' | 'public_blogs',
            [qualityGenerated.title],
          );

          const retryScore = assessBlogQualityScore(retryBlocks, {
            title: qualityGenerated.title,
            excerpt: qualityGenerated.excerpt,
            seo_meta_title: qualityGenerated.seo_meta_title,
            seo_meta_description: qualityGenerated.seo_meta_description,
            tags: qualityGenerated.tags,
            target_word_count: targetWc,
            format_type: typeof formatType === 'string' ? formatType as BlogFormatType : undefined,
          });

          if (retryScore.total > qualityScore.total) {
            generated = ensureGeneratedMetadata(qualityGenerated);
            content_blocks = retryBlocks;
          }
        }
      } catch {
        // Best-effort quality-aligned retry only.
      }
    }
  }

  const result: BlogGenerationOutput & { content_blocks: unknown[] } = {
    ...generated,
    content_blocks,
  };

  let hook_assessment: HookAssessment = { strength: 'moderate', note: '' };
  try {
    const firstPara = extractFirstParagraph(generated.content_html);
    hook_assessment = await checkHookStrength(firstPara, company_id);
  } catch { /* keep default */ }

  return {
    needs_clarification: false,
    mode:                'full',
    confidence,
    result,
    hook_assessment,
    seo_intelligence:    ctx?.seo ?? undefined,
    trend_intelligence:  ctx?.trends ?? undefined,
  };
}
