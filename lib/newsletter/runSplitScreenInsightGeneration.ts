import { runCompletionWithOperation } from '../../backend/services/aiGateway';
import { buildGovernanceExplainabilityMetadata } from '../../backend/services/creator/strategyGovernancePromptContext';
import { enhanceSystemPromptForNewsletter } from './shared/pipeline';
import { instantiateNewsletterTemplate, getDefaultNewsletterTemplates } from './defaultNewsletterTemplates';
import { calculateNewsletterQualityScore } from './newsletterValidation';
import type { NewsletterGenerationRequest, NewsletterGenerationResult } from './runNewsletterGeneration';
import type {
  CalloutBlock,
  ContentBlock,
  KeyInsightsBlock,
  ParagraphBlock,
  QuoteBlock,
  SummaryBlock,
} from '../content/blockTypes';
import { flattenBlocks } from '../content/blockUtils';


// Agent-B split: private helpers live in ./runSplitScreenInsightGenerationHelpers (behavior-preserving).
import { getTargetWords, getSplitScreenTemplate, normalizeParagraphHtml, buildSplitScreenPrompt, parseSplitScreenOutput, ensureSplitScreenSeo, countWords, stripHtml, analyzeSplitScreenDraft, buildSplitScreenDepthRepairPrompt, buildSplitScreenFocusedBodyPrompt, applySplitScreenDepthRepair } from './runSplitScreenInsightGenerationHelpers';

export async function runSplitScreenInsightGeneration(
  input: NewsletterGenerationRequest,
): Promise<NewsletterGenerationResult> {
  const template = getSplitScreenTemplate(input);
  const targetWords = getTargetWords(input);

  let retryReason: string | undefined;
  let best: ReturnType<typeof parseSplitScreenOutput> | null = null;
  let bestScore = -1;

  const enhancedSplitScreenSystemPrompt = await enhanceSystemPromptForNewsletter(
    'You are a senior insight-letter editor. Return only valid JSON. Make the contrast between the surface story and the deeper reality feel sharp, grounded, and reusable.',
    input.company_id, input.companyContext,
  );

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const completion = await runCompletionWithOperation({
      operation: 'newsletterGeneration',
      companyId: input.company_id,
      cache_version: `${input.cache_version ?? 'newsletter'}:split-screen:v2:attempt:${attempt}`,
      model: 'gpt-4o',
      temperature: 0.25,
      response_format: { type: 'json_object' },
      max_tokens: targetWords >= 1600 ? 5200 : 4200,
      messages: [
        {
          role: 'system',
          content: enhancedSplitScreenSystemPrompt,
        },
        {
          role: 'user',
          content: buildSplitScreenPrompt(input, targetWords, retryReason),
        },
      ],
    });

    const raw = completion.output ? JSON.parse(completion.output) : null;
    const parsed = raw ? ensureSplitScreenSeo(parseSplitScreenOutput(raw, template)) : null;
    if (!parsed) {
      retryReason = 'output was not valid split-screen insight JSON';
      continue;
    }

    const score = calculateNewsletterQualityScore(parsed.content_blocks, {
      title: parsed.title,
      excerpt: parsed.excerpt,
      seo_meta_title: parsed.seo_meta_title,
      seo_meta_description: parsed.seo_meta_description,
      tags: parsed.tags,
      target_word_count: targetWords,
      content_type: 'newsletter',
      format_type: 'insight-letter',
    });
    const analysis = analyzeSplitScreenDraft(parsed.content_blocks);
    const composite = score.breakdown.structure * 3 + score.breakdown.depth * 3 + score.breakdown.geo * 3 + score.breakdown.seo;
    if (composite > bestScore) {
      bestScore = composite;
      best = parsed;
    }

    const weakStructure = score.breakdown.structure < 22 || !analysis.filledInsights || analysis.filledCallouts < 2;
    const weakDepth = score.breakdown.depth < 16
      || analysis.avgParagraphWords < 88
      || analysis.wordCounts.surface < 80
      || analysis.wordCounts.deeper < 90
      || analysis.wordCounts.insight < 100
      || analysis.wordCounts.expansion < 80
      || analysis.wordCounts.implication < 80;
    const weakGeo = score.breakdown.geo < 16 || analysis.filledSummaries < 1 || analysis.filledQuotes < 1 || analysis.filledCallouts < 2;

    if (weakDepth || weakStructure || weakGeo) {
      try {
        const repair = await runCompletionWithOperation({
          operation: 'newsletterGeneration',
          companyId: input.company_id,
          cache_version: `${input.cache_version ?? 'newsletter'}:split-screen-repair:v2:attempt:${attempt}`,
          model: 'gpt-4o',
          temperature: 0.2,
          response_format: { type: 'json_object' },
          max_tokens: targetWords >= 1600 ? 3600 : 2800,
          messages: [
            {
              role: 'system',
              content: 'You are a senior insight-letter editor deepening an existing split-screen insight. Return only valid JSON.',
            },
            {
              role: 'user',
              content: buildSplitScreenDepthRepairPrompt(
                input,
                targetWords,
                [
                  weakStructure ? `structure too weak (${score.breakdown.structure}/25)` : '',
                  weakDepth ? `depth too weak (${score.breakdown.depth}/20)` : '',
                  weakGeo ? `geo too weak (${score.breakdown.geo}/20)` : '',
                  analysis.avgParagraphWords < 88 ? `paragraph depth too light (${analysis.avgParagraphWords} words)` : '',
                  analysis.wordCounts.surface < 80 ? `surface-story section too thin (${analysis.wordCounts.surface} words)` : '',
                  analysis.wordCounts.deeper < 90 ? `deeper-reality section too thin (${analysis.wordCounts.deeper} words)` : '',
                  analysis.wordCounts.insight < 100 ? `insight section too thin (${analysis.wordCounts.insight} words)` : '',
                  analysis.wordCounts.expansion < 80 ? `expansion section too thin (${analysis.wordCounts.expansion} words)` : '',
                  analysis.wordCounts.implication < 80 ? `implication section too thin (${analysis.wordCounts.implication} words)` : '',
                ].filter(Boolean).join('; '),
              ),
            },
          ],
        });

        const repairRaw = repair.output ? JSON.parse(repair.output) : null;
        if (repairRaw && typeof repairRaw === 'object') {
          const repairedBlocks = applySplitScreenDepthRepair(parsed.content_blocks, repairRaw);
          const repairedScore = calculateNewsletterQualityScore(repairedBlocks, {
            title: parsed.title,
            excerpt: parsed.excerpt,
            seo_meta_title: parsed.seo_meta_title,
            seo_meta_description: parsed.seo_meta_description,
            tags: parsed.tags,
            target_word_count: targetWords,
            content_type: 'newsletter',
            format_type: 'insight-letter',
          });
          if (repairedScore.total > score.total) {
            parsed.content_blocks = repairedBlocks;
          }
        }
      } catch {
        // Best-effort only
      }
    }

    const repairedScore = calculateNewsletterQualityScore(parsed.content_blocks, {
      title: parsed.title,
      excerpt: parsed.excerpt,
      seo_meta_title: parsed.seo_meta_title,
      seo_meta_description: parsed.seo_meta_description,
      tags: parsed.tags,
      target_word_count: targetWords,
      content_type: 'newsletter',
      format_type: 'insight-letter',
    });
    const repairedAnalysis = analyzeSplitScreenDraft(parsed.content_blocks);
    const stillMateriallyWeak = repairedScore.breakdown.depth < 17
      || repairedAnalysis.avgParagraphWords < (targetWords >= 1600 ? 95 : 82)
      || repairedAnalysis.wordCounts.deeper < (targetWords >= 1600 ? 145 : 120)
      || repairedAnalysis.wordCounts.insight < (targetWords >= 1600 ? 165 : 135)
      || repairedAnalysis.wordCounts.expansion < (targetWords >= 1600 ? 115 : 95)
      || repairedAnalysis.wordCounts.implication < (targetWords >= 1600 ? 115 : 95);

    if (stillMateriallyWeak) {
      try {
        const focusedRepair = await runCompletionWithOperation({
          operation: 'newsletterGeneration',
          companyId: input.company_id,
          cache_version: `${input.cache_version ?? 'newsletter'}:split-screen-focused:v4:attempt:${attempt}`,
          model: 'gpt-4o',
          temperature: 0.15,
          response_format: { type: 'json_object' },
          max_tokens: targetWords >= 1600 ? 5200 : 3800,
          messages: [
            {
              role: 'system',
              content: 'You are a senior insight-letter editor rewriting only the body for depth. Return only valid JSON. Make it fuller, more argued, and more concrete without changing the thesis.',
            },
            {
              role: 'user',
              content: buildSplitScreenFocusedBodyPrompt(
                input,
                targetWords,
                [
                  `depth still weak (${repairedScore.breakdown.depth}/20)`,
                  repairedAnalysis.avgParagraphWords < (targetWords >= 1600 ? 95 : 82) ? `average paragraph depth still too light (${repairedAnalysis.avgParagraphWords} words)` : '',
                  repairedAnalysis.wordCounts.deeper < (targetWords >= 1600 ? 145 : 120) ? `deeper-reality section still too thin (${repairedAnalysis.wordCounts.deeper} words)` : '',
                  repairedAnalysis.wordCounts.insight < (targetWords >= 1600 ? 165 : 135) ? `insight section still too thin (${repairedAnalysis.wordCounts.insight} words)` : '',
                  repairedAnalysis.wordCounts.expansion < (targetWords >= 1600 ? 115 : 95) ? `expansion section still too thin (${repairedAnalysis.wordCounts.expansion} words)` : '',
                  repairedAnalysis.wordCounts.implication < (targetWords >= 1600 ? 115 : 95) ? `implication section still too thin (${repairedAnalysis.wordCounts.implication} words)` : '',
                ].filter(Boolean).join('; '),
              ),
            },
          ],
        });

        const focusedRaw = focusedRepair.output ? JSON.parse(focusedRepair.output) : null;
        if (focusedRaw && typeof focusedRaw === 'object') {
          const focusedBlocks = applySplitScreenDepthRepair(parsed.content_blocks, focusedRaw);
          const focusedScore = calculateNewsletterQualityScore(focusedBlocks, {
            title: parsed.title,
            excerpt: parsed.excerpt,
            seo_meta_title: parsed.seo_meta_title,
            seo_meta_description: parsed.seo_meta_description,
            tags: parsed.tags,
            target_word_count: targetWords,
            content_type: 'newsletter',
            format_type: 'insight-letter',
          });
          if (focusedScore.total > repairedScore.total) {
            parsed.content_blocks = focusedBlocks;
          }
        }
      } catch {
        // Best-effort only
      }
    }

    const finalScore = calculateNewsletterQualityScore(parsed.content_blocks, {
      title: parsed.title,
      excerpt: parsed.excerpt,
      seo_meta_title: parsed.seo_meta_title,
      seo_meta_description: parsed.seo_meta_description,
      tags: parsed.tags,
      target_word_count: targetWords,
      content_type: 'newsletter',
      format_type: 'insight-letter',
    });
    const finalAnalysis = analyzeSplitScreenDraft(parsed.content_blocks);
    const needsLongFormExpansion = targetWords >= 1200 && finalScore.meta.wordCount < Math.round(targetWords * 0.9);

    if (needsLongFormExpansion) {
      try {
        const expansionRepair = await runCompletionWithOperation({
          operation: 'newsletterGeneration',
          companyId: input.company_id,
          cache_version: `${input.cache_version ?? 'newsletter'}:split-screen-expansion:v1:attempt:${attempt}`,
          model: 'gpt-4o',
          temperature: 0.1,
          response_format: { type: 'json_object' },
          max_tokens: targetWords >= 1600 ? 5200 : 4000,
          messages: [
            {
              role: 'system',
              content: 'You are expanding only the long-form body of a split-screen insight letter. Return only valid JSON. Make it materially longer, more reasoned, and more concrete without changing the thesis.',
            },
            {
              role: 'user',
              content: buildSplitScreenFocusedBodyPrompt(
                input,
                targetWords,
                `draft is still far below target length (${finalScore.meta.wordCount}/${targetWords} words); every major section needs fuller reasoning, stronger example depth, and clearer operating implications`,
              ),
            },
          ],
        });

        const expansionRaw = expansionRepair.output ? JSON.parse(expansionRepair.output) : null;
        if (expansionRaw && typeof expansionRaw === 'object') {
          const expandedBlocks = applySplitScreenDepthRepair(parsed.content_blocks, expansionRaw);
          const expandedScore = calculateNewsletterQualityScore(expandedBlocks, {
            title: parsed.title,
            excerpt: parsed.excerpt,
            seo_meta_title: parsed.seo_meta_title,
            seo_meta_description: parsed.seo_meta_description,
            tags: parsed.tags,
            target_word_count: targetWords,
            content_type: 'newsletter',
            format_type: 'insight-letter',
          });
          if (expandedScore.total > finalScore.total) {
            parsed.content_blocks = expandedBlocks;
          }
        }
      } catch {
        // Best-effort only
      }
    }

    const settledScore = calculateNewsletterQualityScore(parsed.content_blocks, {
      title: parsed.title,
      excerpt: parsed.excerpt,
      seo_meta_title: parsed.seo_meta_title,
      seo_meta_description: parsed.seo_meta_description,
      tags: parsed.tags,
      target_word_count: targetWords,
      content_type: 'newsletter',
      format_type: 'insight-letter',
    });
    const settledAnalysis = analyzeSplitScreenDraft(parsed.content_blocks);
    const finalComposite = settledScore.breakdown.structure * 3 + settledScore.breakdown.depth * 3 + settledScore.breakdown.geo * 3 + settledScore.breakdown.seo;
    if (finalComposite > bestScore) {
      bestScore = finalComposite;
      best = parsed;
    }

    const finalWeakStructure = settledScore.breakdown.structure < 22 || !settledAnalysis.filledInsights || settledAnalysis.filledCallouts < 2;
    const finalWeakDepth = settledScore.breakdown.depth < 16
      || settledAnalysis.avgParagraphWords < (targetWords >= 1600 ? 105 : targetWords >= 1200 ? 92 : 88)
      || settledAnalysis.wordCounts.surface < (targetWords >= 1600 ? 110 : targetWords >= 1200 ? 90 : 80)
      || settledAnalysis.wordCounts.deeper < (targetWords >= 1600 ? 150 : targetWords >= 1200 ? 120 : 90)
      || settledAnalysis.wordCounts.insight < (targetWords >= 1600 ? 170 : targetWords >= 1200 ? 140 : 100)
      || settledAnalysis.wordCounts.expansion < (targetWords >= 1600 ? 115 : targetWords >= 1200 ? 95 : 80)
      || settledAnalysis.wordCounts.implication < (targetWords >= 1600 ? 115 : targetWords >= 1200 ? 95 : 80);
    const finalWeakGeo = settledScore.breakdown.geo < 16 || settledAnalysis.filledSummaries < 1 || settledAnalysis.filledQuotes < 1 || settledAnalysis.filledCallouts < 2;

    if (!finalWeakStructure && !finalWeakDepth && !finalWeakGeo) {
      return {
        needs_clarification: false,
        mode: 'full',
        confidence: 'high',
        template_used: true,
        hook_assessment: { strength: 'moderate', note: 'Newsletter-owned split-screen insight generation path used.' },
        result: parsed,
        governance: buildGovernanceExplainabilityMetadata(null),
      };
    }

    retryReason = [
      weakStructure ? `structure too weak (${score.breakdown.structure}/25)` : '',
      weakDepth ? `depth too weak (${score.breakdown.depth}/20)` : '',
      weakGeo ? `GEO too weak (${score.breakdown.geo}/20)` : '',
      !analysis.filledInsights ? 'key insights are too weak' : '',
      analysis.filledCallouts < 2 ? `need both extractable callouts filled (${analysis.filledCallouts}/2)` : '',
      analysis.avgParagraphWords < 88 ? `paragraph depth too light (${analysis.avgParagraphWords} words)` : '',
      analysis.wordCounts.surface < 80 ? `surface-story section too thin (${analysis.wordCounts.surface} words)` : '',
      analysis.wordCounts.deeper < 90 ? `deeper-reality section too thin (${analysis.wordCounts.deeper} words)` : '',
      analysis.wordCounts.insight < 100 ? `insight section too thin (${analysis.wordCounts.insight} words)` : '',
      analysis.wordCounts.expansion < 80 ? `expansion section too thin (${analysis.wordCounts.expansion} words)` : '',
      analysis.wordCounts.implication < 80 ? `implication section too thin (${analysis.wordCounts.implication} words)` : '',
    ].filter(Boolean).join('; ');
  }

  if (best) {
    return {
      needs_clarification: false,
      mode: 'full',
      confidence: 'medium',
      template_used: true,
      hook_assessment: { strength: 'moderate', note: 'Newsletter-owned split-screen insight generation path used.' },
      result: best,
      governance: buildGovernanceExplainabilityMetadata(null),
    };
  }

  throw new Error('Failed to generate Split-Screen Insight newsletter');
}
