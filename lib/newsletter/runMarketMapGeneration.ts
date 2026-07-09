import { runCompletionWithOperation } from '../../backend/services/aiGateway';
import { buildGovernanceExplainabilityMetadata } from '../../backend/services/creator/strategyGovernancePromptContext';
import { enhanceSystemPromptForNewsletter } from './shared/pipeline';
import { instantiateNewsletterTemplate, getDefaultNewsletterTemplates } from './defaultNewsletterTemplates';
import { calculateNewsletterQualityScore } from './newsletterValidation';
import type { NewsletterGenerationRequest, NewsletterGenerationResult } from './runNewsletterGeneration';
import type {
  ContentBlock,
  ParagraphBlock,
  KeyInsightsBlock,
  QuoteBlock,
  SummaryBlock,
  ReferencesBlock,
  ColumnsBlock,
  ListBlock,
} from '../content/blockTypes';
import { flattenBlocks } from '../content/blockUtils';


// Agent-B split: private helpers live in ./runMarketMapGenerationHelpers (behavior-preserving).
import { getTargetWords, getMarketMapTemplate, buildMarketMapPrompt, normalizeParagraphHtml, countWords, parseMarketMapOutput, analyzeMarketMapDraft, buildMarketMapDepthRepairPrompt, buildMarketMapFocusedBodyPrompt, applyMarketMapDepthRepair, getMarketMapCompositeScore } from './runMarketMapGenerationHelpers';

export async function runMarketMapGeneration(
  input: NewsletterGenerationRequest,
): Promise<NewsletterGenerationResult> {
  const template = getMarketMapTemplate(input);
  const targetWords = getTargetWords(input);
  let retryReason: string | undefined;
  let best: ReturnType<typeof parseMarketMapOutput> | null = null;
  let bestScore = -1;

  const enhancedMapSystemPrompt = await enhanceSystemPromptForNewsletter(
    'You are a strategy consultant writing a strategic newsletter. Return only valid JSON. Focus on deep strategic logic, not generic commentary.',
    input.company_id, input.companyContext,
  );

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const completion = await runCompletionWithOperation({
      operation: 'newsletterGeneration',
      companyId: input.company_id,
      cache_version: `${input.cache_version ?? 'newsletter'}:market-map:v3:attempt:${attempt}`,
      model: 'gpt-4o',
      temperature: 0.25,
      response_format: { type: 'json_object' },
      max_tokens: targetWords >= 2000 ? 5600 : 4600,
      messages: [
        {
          role: 'system',
          content: enhancedMapSystemPrompt,
        },
        {
          role: 'user',
          content: buildMarketMapPrompt(input, targetWords, retryReason),
        },
      ],
    });

    const raw = completion.output ? JSON.parse(completion.output) : null;
    const parsed = raw ? parseMarketMapOutput(raw, template) : null;
    if (!parsed) {
      retryReason = 'output was not valid structured strategic-letter JSON';
      continue;
    }
    if (parsed.title.trim().length > 0 && parsed.title.trim().length < 20) {
      parsed.title = `${parsed.title.trim()}: Market Map`;
      if (!parsed.seo_meta_title?.trim()) {
        parsed.seo_meta_title = parsed.title.trim();
      }
    }
    if (!parsed.excerpt?.trim() || parsed.excerpt.trim().length < 70) {
      const fallbackExcerpt = [
        raw.summary_body,
        raw.positioning_html,
        raw.analysis_html,
        parsed.title,
      ].find((value) => typeof value === 'string' && value.trim().length > 0);
      if (typeof fallbackExcerpt === 'string' && fallbackExcerpt.trim()) {
        parsed.excerpt = fallbackExcerpt.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 155);
      }
    }
    if (!parsed.seo_meta_description?.trim() || parsed.seo_meta_description.trim().length < 70) {
      parsed.seo_meta_description = (parsed.excerpt || parsed.title).slice(0, 155).trim();
    }

    const score = calculateNewsletterQualityScore(parsed.content_blocks, {
      title: parsed.title,
      excerpt: parsed.excerpt,
      seo_meta_title: parsed.seo_meta_title,
      seo_meta_description: parsed.seo_meta_description,
      tags: parsed.tags,
      target_word_count: targetWords,
      content_type: 'newsletter',
      format_type: 'strategic-letter',
    });

    const analysis = analyzeMarketMapDraft(parsed.content_blocks);
    const weakDepth = score.breakdown.depth < 16
      || score.issues.some((issue) => issue.category === 'depth')
      || analysis.avgParagraphWords < 90
      || analysis.noticeWords < 55
      || analysis.shiftWords < 70
      || analysis.analysisWords < 145
      || analysis.positioningWords < 100
      || analysis.thesisWords < 68
      || analysis.moveCount < 4
      || analysis.avgMoveWords < 14;

    if (weakDepth) {
      try {
        const repair = await runCompletionWithOperation({
          operation: 'newsletterGeneration',
          companyId: input.company_id,
          cache_version: `${input.cache_version ?? 'newsletter'}:market-map-repair:v3:attempt:${attempt}`,
          model: 'gpt-4o',
          temperature: 0.2,
          response_format: { type: 'json_object' },
          max_tokens: 2400,
          messages: [
            {
              role: 'system',
              content: 'You are a strategy consultant improving depth only. Return only valid JSON. Keep the same thesis and structure while deepening reasoning.',
            },
            {
              role: 'user',
              content: buildMarketMapDepthRepairPrompt(
                input,
                [
                  `depth too weak (${score.breakdown.depth}/20)`,
                  analysis.avgParagraphWords < 90 ? `average paragraph depth too light (${analysis.avgParagraphWords} words)` : '',
                  analysis.noticeWords < 55 ? `strong-teams-notice section too thin (${analysis.noticeWords} words)` : '',
                  analysis.shiftWords < 70 ? `shift section too thin (${analysis.shiftWords} words)` : '',
                  analysis.analysisWords < 145 ? `analysis section too thin (${analysis.analysisWords} words)` : '',
                  analysis.positioningWords < 100 ? `positioning section too thin (${analysis.positioningWords} words)` : '',
                  analysis.moveCount < 4 ? `not enough strategic moves (${analysis.moveCount})` : '',
                  analysis.avgMoveWords < 14 ? `strategic moves too generic on average (${analysis.avgMoveWords} words)` : '',
                  analysis.thesisWords < 68 ? `thesis section too thin (${analysis.thesisWords} words)` : '',
                ].filter(Boolean).join('; '),
                parsed,
              ),
            },
          ],
        });

        const repairRaw = repair.output ? JSON.parse(repair.output) : null;
        if (repairRaw && typeof repairRaw === 'object') {
          const repairedBlocks = applyMarketMapDepthRepair(parsed.content_blocks, repairRaw);
          const repairedScore = calculateNewsletterQualityScore(repairedBlocks, {
            title: parsed.title,
            excerpt: parsed.excerpt,
            seo_meta_title: parsed.seo_meta_title,
            seo_meta_description: parsed.seo_meta_description,
            tags: parsed.tags,
            target_word_count: targetWords,
            content_type: 'newsletter',
            format_type: 'strategic-letter',
          });
          const repairedAnalysis = analyzeMarketMapDraft(repairedBlocks);
          const repairedComposite = repairedScore.breakdown.depth * 3 + repairedAnalysis.analysisWords + repairedAnalysis.positioningWords + repairedAnalysis.thesisWords;
          const originalComposite = score.breakdown.depth * 3 + analysis.analysisWords + analysis.positioningWords + analysis.thesisWords;
          if (repairedComposite > originalComposite) {
            parsed.content_blocks = repairedBlocks;
          }
        }
      } catch {
        // Best-effort repair only
      }
    }

    const interimScore = calculateNewsletterQualityScore(parsed.content_blocks, {
      title: parsed.title,
      excerpt: parsed.excerpt,
      seo_meta_title: parsed.seo_meta_title,
      seo_meta_description: parsed.seo_meta_description,
      tags: parsed.tags,
      target_word_count: targetWords,
      content_type: 'newsletter',
      format_type: 'strategic-letter',
    });
    const repairedAnalysis = analyzeMarketMapDraft(parsed.content_blocks);
    const stillWeakAfterRepair = interimScore.breakdown.depth < 17
      || repairedAnalysis.avgParagraphWords < 95
      || repairedAnalysis.noticeWords < 65
      || repairedAnalysis.shiftWords < 80
      || repairedAnalysis.analysisWords < 175
      || repairedAnalysis.positioningWords < 115
      || repairedAnalysis.thesisWords < 80
      || repairedAnalysis.moveCount < 4
      || repairedAnalysis.avgMoveWords < 15;

    if (stillWeakAfterRepair) {
      try {
        const secondRepair = await runCompletionWithOperation({
          operation: 'newsletterGeneration',
          companyId: input.company_id,
          cache_version: `${input.cache_version ?? 'newsletter'}:market-map-second-repair:v3:attempt:${attempt}`,
          model: 'gpt-4o',
          temperature: 0.15,
          response_format: { type: 'json_object' },
          max_tokens: 3000,
          messages: [
            {
              role: 'system',
              content: 'You are a top-tier strategy consultant improving only depth. Return only valid JSON. Keep the thesis and structure fixed, but make the strategic reasoning more rigorous, more differentiated, and more decision-grade.',
            },
            {
              role: 'user',
              content: buildMarketMapDepthRepairPrompt(
                input,
                [
                  'depth still below target after first repair',
                  repairedAnalysis.avgParagraphWords < 95 ? `average paragraph depth still too light (${repairedAnalysis.avgParagraphWords} words)` : '',
                  repairedAnalysis.noticeWords < 65 ? `strong-teams-notice section still too thin (${repairedAnalysis.noticeWords} words)` : '',
                  repairedAnalysis.shiftWords < 80 ? `shift section still too thin (${repairedAnalysis.shiftWords} words)` : '',
                  repairedAnalysis.analysisWords < 175 ? `analysis still too thin (${repairedAnalysis.analysisWords} words)` : '',
                  repairedAnalysis.positioningWords < 115 ? `positioning still too thin (${repairedAnalysis.positioningWords} words)` : '',
                  repairedAnalysis.moveCount < 4 ? `strategic moves still too few (${repairedAnalysis.moveCount})` : '',
                  repairedAnalysis.avgMoveWords < 15 ? `strategic moves still too generic on average (${repairedAnalysis.avgMoveWords} words)` : '',
                  repairedAnalysis.thesisWords < 80 ? `thesis still too thin (${repairedAnalysis.thesisWords} words)` : '',
                ].filter(Boolean).join('; '),
                parsed,
              ),
            },
          ],
        });

        const secondRepairRaw = secondRepair.output ? JSON.parse(secondRepair.output) : null;
        if (secondRepairRaw && typeof secondRepairRaw === 'object') {
          const secondRepairedBlocks = applyMarketMapDepthRepair(parsed.content_blocks, secondRepairRaw);
          const secondScore = calculateNewsletterQualityScore(secondRepairedBlocks, {
            title: parsed.title,
            excerpt: parsed.excerpt,
            seo_meta_title: parsed.seo_meta_title,
            seo_meta_description: parsed.seo_meta_description,
            tags: parsed.tags,
            target_word_count: targetWords,
            content_type: 'newsletter',
            format_type: 'strategic-letter',
          });
          const secondAnalysis = analyzeMarketMapDraft(secondRepairedBlocks);
          const secondComposite = secondScore.breakdown.depth * 3 + secondAnalysis.analysisWords + secondAnalysis.positioningWords + secondAnalysis.thesisWords;
          const currentComposite = interimScore.breakdown.depth * 3 + repairedAnalysis.analysisWords + repairedAnalysis.positioningWords + repairedAnalysis.thesisWords;
          if (secondComposite > currentComposite) {
            parsed.content_blocks = secondRepairedBlocks;
          }
        }
      } catch {
        // Best-effort second repair only
      }
    }

    const preFinalScore = calculateNewsletterQualityScore(parsed.content_blocks, {
      title: parsed.title,
      excerpt: parsed.excerpt,
      seo_meta_title: parsed.seo_meta_title,
      seo_meta_description: parsed.seo_meta_description,
      tags: parsed.tags,
      target_word_count: targetWords,
      content_type: 'newsletter',
      format_type: 'strategic-letter',
    });
    const preFinalAnalysis = analyzeMarketMapDraft(parsed.content_blocks);
    const stillMateriallyWeak = preFinalScore.breakdown.depth < 17
      || preFinalAnalysis.noticeWords < 75
      || preFinalAnalysis.shiftWords < 90
      || preFinalAnalysis.analysisWords < 185
      || preFinalAnalysis.positioningWords < 120
      || preFinalAnalysis.thesisWords < 85
      || preFinalAnalysis.moveCount < 4
      || preFinalAnalysis.avgMoveWords < 16;

    if (stillMateriallyWeak) {
      try {
        const focusedRepair = await runCompletionWithOperation({
          operation: 'newsletterGeneration',
          companyId: input.company_id,
          cache_version: `${input.cache_version ?? 'newsletter'}:market-map-focused:v4:attempt:${attempt}`,
          model: 'gpt-4o',
          temperature: 0.1,
          response_format: { type: 'json_object' },
          max_tokens: 3200,
          messages: [
            {
              role: 'system',
              content: 'You are a senior strategy consultant rewriting only the strategic core of a market map. Return only valid JSON. Make it sharper, more insightful, and more decision-grade.',
            },
            {
              role: 'user',
              content: buildMarketMapFocusedBodyPrompt(
                input,
                targetWords,
                [
                  `depth still materially weak (${preFinalScore.breakdown.depth}/20)`,
                  preFinalAnalysis.noticeWords < 75 ? `strong-teams-notice still too thin (${preFinalAnalysis.noticeWords} words)` : '',
                  preFinalAnalysis.shiftWords < 90 ? `shift still too thin (${preFinalAnalysis.shiftWords} words)` : '',
                  preFinalAnalysis.analysisWords < 185 ? `analysis still too thin (${preFinalAnalysis.analysisWords} words)` : '',
                  preFinalAnalysis.positioningWords < 120 ? `positioning still too thin (${preFinalAnalysis.positioningWords} words)` : '',
                  preFinalAnalysis.moveCount < 4 ? `strategic moves still too few (${preFinalAnalysis.moveCount})` : '',
                  preFinalAnalysis.avgMoveWords < 16 ? `strategic moves still too generic on average (${preFinalAnalysis.avgMoveWords} words)` : '',
                  preFinalAnalysis.thesisWords < 85 ? `thesis still too thin (${preFinalAnalysis.thesisWords} words)` : '',
                ].filter(Boolean).join('; '),
                parsed,
              ),
            },
          ],
        });

        const focusedRaw = focusedRepair.output ? JSON.parse(focusedRepair.output) : null;
        if (focusedRaw && typeof focusedRaw === 'object') {
          const focusedBlocks = applyMarketMapDepthRepair(parsed.content_blocks, focusedRaw);
          const focusedScore = calculateNewsletterQualityScore(focusedBlocks, {
            title: parsed.title,
            excerpt: parsed.excerpt,
            seo_meta_title: parsed.seo_meta_title,
            seo_meta_description: parsed.seo_meta_description,
            tags: parsed.tags,
            target_word_count: targetWords,
            content_type: 'newsletter',
            format_type: 'strategic-letter',
          });
          const focusedAnalysis = analyzeMarketMapDraft(focusedBlocks);
          const focusedComposite = focusedScore.breakdown.depth * 4
            + focusedAnalysis.noticeWords
            + focusedAnalysis.analysisWords
            + focusedAnalysis.positioningWords
            + focusedAnalysis.avgMoveWords * 4
            + focusedAnalysis.thesisWords;
          const currentComposite = preFinalScore.breakdown.depth * 4
            + preFinalAnalysis.noticeWords
            + preFinalAnalysis.analysisWords
            + preFinalAnalysis.positioningWords
            + preFinalAnalysis.avgMoveWords * 4
            + preFinalAnalysis.thesisWords;
          if (focusedComposite > currentComposite) {
            parsed.content_blocks = focusedBlocks;
          }
        }
      } catch {
        // Best-effort focused repair only
      }
    }

    const needsLongFormExpansion = targetWords >= 1200 && preFinalScore.meta.wordCount < Math.round(targetWords * 0.9);
    if (needsLongFormExpansion) {
      try {
        const expansionRepair = await runCompletionWithOperation({
          operation: 'newsletterGeneration',
          companyId: input.company_id,
          cache_version: `${input.cache_version ?? 'newsletter'}:market-map-expansion:v1:attempt:${attempt}`,
          model: 'gpt-4o',
          temperature: 0.1,
          response_format: { type: 'json_object' },
          max_tokens: targetWords >= 1600 ? 4200 : 3200,
          messages: [
            {
              role: 'system',
              content: 'You are a senior strategy consultant expanding only the strategic core of a market map. Return only valid JSON. Make it materially longer, more reasoned, and more decision-grade without changing the thesis.',
            },
            {
              role: 'user',
              content: buildMarketMapFocusedBodyPrompt(
                input,
                targetWords,
                `draft is still far below target length (${preFinalScore.meta.wordCount}/${targetWords} words); deepen the notice, shift, analysis, positioning, strategic moves, and thesis so the piece reaches the expected strategic depth`,
                parsed,
              ),
            },
          ],
        });

        const expansionRaw = expansionRepair.output ? JSON.parse(expansionRepair.output) : null;
        if (expansionRaw && typeof expansionRaw === 'object') {
          const expandedParsed = { ...parsed, content_blocks: applyMarketMapDepthRepair(parsed.content_blocks, expansionRaw) };
          const expandedEvaluation = getMarketMapCompositeScore(expandedParsed, targetWords);
          const currentEvaluation = getMarketMapCompositeScore(parsed, targetWords);
          if (expandedEvaluation.composite > currentEvaluation.composite) {
            parsed.content_blocks = expandedParsed.content_blocks;
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
      format_type: 'strategic-letter',
    });
    const finalAnalysis = analyzeMarketMapDraft(parsed.content_blocks);
    const finalWeakDepth = finalScore.breakdown.depth < 17
      || finalScore.issues.some((issue) => issue.category === 'depth')
      || finalAnalysis.avgParagraphWords < (targetWords >= 1600 ? 105 : 95)
      || finalAnalysis.paragraphCount < 7
      || finalAnalysis.noticeWords < (targetWords >= 1600 ? 80 : 65)
      || finalAnalysis.shiftWords < (targetWords >= 1600 ? 100 : 90)
      || finalAnalysis.analysisWords < (targetWords >= 1600 ? 195 : 175)
      || finalAnalysis.positioningWords < (targetWords >= 1600 ? 130 : 115)
      || finalAnalysis.thesisWords < (targetWords >= 1600 ? 90 : 80)
      || finalAnalysis.moveCount < 4
      || finalAnalysis.avgMoveWords < (targetWords >= 1600 ? 16 : 15);

    const composite = finalScore.breakdown.structure * 3 + finalScore.breakdown.depth * 3 + finalScore.breakdown.geo * 3 + finalScore.breakdown.seo;
    if (composite > bestScore) {
      bestScore = composite;
      best = parsed;
    }

    if (!finalWeakDepth) {
      return {
        needs_clarification: false,
        mode: 'full',
        confidence: 'high',
        template_used: true,
        hook_assessment: { strength: 'moderate', note: 'Newsletter-owned market map generation path used.' },
        result: parsed,
        governance: buildGovernanceExplainabilityMetadata(null),
      };
    }

    retryReason = [
      `depth too weak (${finalScore.breakdown.depth}/20)`,
      finalAnalysis.avgParagraphWords < (targetWords >= 1600 ? 105 : 95) ? `average paragraph depth too light (${finalAnalysis.avgParagraphWords} words)` : '',
      finalAnalysis.paragraphCount < 7 ? `not enough substantive body paragraphs (${finalAnalysis.paragraphCount})` : '',
      finalAnalysis.noticeWords < (targetWords >= 1600 ? 80 : 65) ? `strong-teams-notice section too thin (${finalAnalysis.noticeWords} words)` : '',
      finalAnalysis.shiftWords < (targetWords >= 1600 ? 100 : 90) ? `shift section too thin (${finalAnalysis.shiftWords} words)` : '',
      finalAnalysis.analysisWords < (targetWords >= 1600 ? 195 : 175) ? `analysis section too thin (${finalAnalysis.analysisWords} words)` : '',
      finalAnalysis.positioningWords < (targetWords >= 1600 ? 130 : 115) ? `positioning section too thin (${finalAnalysis.positioningWords} words)` : '',
      finalAnalysis.moveCount < 4 ? `not enough strategic moves (${finalAnalysis.moveCount})` : '',
      finalAnalysis.avgMoveWords < (targetWords >= 1600 ? 16 : 15) ? `strategic moves too generic on average (${finalAnalysis.avgMoveWords} words)` : '',
      finalAnalysis.thesisWords < 80 ? `thesis section too thin (${finalAnalysis.thesisWords} words)` : '',
    ].filter(Boolean).join('; ');
  }

  if (best) {
    return {
      needs_clarification: false,
      mode: 'full',
      confidence: 'medium',
      template_used: true,
      hook_assessment: { strength: 'moderate', note: 'Newsletter-owned market map generation path used.' },
      result: best,
      governance: buildGovernanceExplainabilityMetadata(null),
    };
  }

  throw new Error('Failed to generate Market Map newsletter');
}
