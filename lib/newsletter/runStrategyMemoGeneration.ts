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
  CalloutBlock,
  SummaryBlock,
  ReferencesBlock,
  ColumnsBlock,
  ListBlock,
} from '../content/blockTypes';
import { flattenBlocks } from '../content/blockUtils';


// Agent-B split: private helpers live in ./runStrategyMemoGenerationHelpers (behavior-preserving).
import { stripHtml, getTargetWords, getStrategyMemoTemplate, normalizeParagraphHtml, buildStrategyMemoPrompt, parseStrategyMemoOutput, ensureStrategyMemoSeo, analyzeStrategyMemoDraft, buildStrategyMemoDepthRepairPrompt, buildStrategyMemoFocusedBodyPrompt, applyStrategyMemoDepthRepair } from './runStrategyMemoGenerationHelpers';

export async function runStrategyMemoGeneration(
  input: NewsletterGenerationRequest,
): Promise<NewsletterGenerationResult> {
  const template = getStrategyMemoTemplate(input);
  const targetWords = getTargetWords(input);
  let retryReason: string | undefined;
  let best: ReturnType<typeof parseStrategyMemoOutput> | null = null;
  let bestScore = -1;

  const enhancedMemoSystemPrompt = await enhanceSystemPromptForNewsletter(
    'You are a strategy consultant writing a strategy memo newsletter. Return only valid JSON. Focus on deep strategic logic, leverage, and clear market positioning.',
    input.company_id, input.companyContext,
  );

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const completion = await runCompletionWithOperation({
      operation: 'newsletterGeneration',
      companyId: input.company_id,
      cache_version: `${input.cache_version ?? 'newsletter'}:strategy-memo:v2:attempt:${attempt}`,
      model: 'gpt-4o',
      temperature: 0.25,
      response_format: { type: 'json_object' },
      max_tokens: targetWords >= 2000 ? 5400 : 4400,
      messages: [
        {
          role: 'system',
          content: enhancedMemoSystemPrompt,
        },
        {
          role: 'user',
          content: buildStrategyMemoPrompt(input, targetWords, retryReason),
        },
      ],
    });

    const raw = completion.output ? JSON.parse(completion.output) : null;
    const parsed = raw ? ensureStrategyMemoSeo(parseStrategyMemoOutput(raw, template)) : null;
    if (!parsed) {
      retryReason = 'output was not valid structured strategy memo JSON';
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
      format_type: 'strategic-letter',
    });

    const analysis = analyzeStrategyMemoDraft(parsed.content_blocks);
    const weakDepth = score.breakdown.depth < 16
      || score.issues.some((issue) => issue.category === 'depth')
      || analysis.avgParagraphWords < 90
      || analysis.paragraphCount < 7
      || analysis.calloutWords < 14
      || analysis.moveCount < 3
      || analysis.avgStrategicMoveWords < 11
      || analysis.analysisWords < 150
      || analysis.positioningWords < 100
      || analysis.thesisWords < 68;

    if (weakDepth) {
      try {
        const repair = await runCompletionWithOperation({
          operation: 'newsletterGeneration',
          companyId: input.company_id,
          model: 'gpt-4o',
          temperature: 0.2,
          response_format: { type: 'json_object' },
          max_tokens: 2600,
          messages: [
            {
              role: 'system',
              content: 'You are a strategy consultant improving memo depth only. Return only valid JSON. Keep the same thesis and structure while deepening reasoning.',
            },
            {
              role: 'user',
              content: buildStrategyMemoDepthRepairPrompt(
                input,
                [
                  `depth too weak (${score.breakdown.depth}/20)`,
                  analysis.avgParagraphWords < 90 ? `average paragraph depth too light (${analysis.avgParagraphWords} words)` : '',
                  analysis.paragraphCount < 7 ? `not enough substantive body paragraphs (${analysis.paragraphCount})` : '',
                  analysis.calloutWords < 14 ? `lead callout too light (${analysis.calloutWords} words)` : '',
                  analysis.moveCount < 3 ? `not enough substantive strategic moves (${analysis.moveCount})` : '',
                  analysis.avgStrategicMoveWords < 11 ? `strategic moves too generic on average (${analysis.avgStrategicMoveWords} words)` : '',
                  analysis.analysisWords < 150 ? `analysis section too thin (${analysis.analysisWords} words)` : '',
                  analysis.positioningWords < 100 ? `positioning section too thin (${analysis.positioningWords} words)` : '',
                  analysis.thesisWords < 68 ? `thesis section too thin (${analysis.thesisWords} words)` : '',
                ].filter(Boolean).join('; '),
                parsed,
              ),
            },
          ],
        });

        const repairRaw = repair.output ? JSON.parse(repair.output) : null;
        if (repairRaw && typeof repairRaw === 'object') {
          const repairedBlocks = applyStrategyMemoDepthRepair(parsed.content_blocks, repairRaw);
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
          const repairedAnalysis = analyzeStrategyMemoDraft(repairedBlocks);
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
    const repairedAnalysis = analyzeStrategyMemoDraft(parsed.content_blocks);
    const stillWeakAfterRepair = interimScore.breakdown.depth < 17
      || repairedAnalysis.avgParagraphWords < 95
      || repairedAnalysis.calloutWords < 18
      || repairedAnalysis.moveCount < 3
      || repairedAnalysis.avgStrategicMoveWords < 14
      || repairedAnalysis.analysisWords < 180
      || repairedAnalysis.positioningWords < 120
      || repairedAnalysis.thesisWords < 85;

    if (stillWeakAfterRepair) {
      try {
        const secondRepair = await runCompletionWithOperation({
          operation: 'newsletterGeneration',
          companyId: input.company_id,
          model: 'gpt-4o',
          temperature: 0.15,
          response_format: { type: 'json_object' },
          max_tokens: 3000,
          messages: [
            {
              role: 'system',
              content: 'You are a top-tier strategy consultant improving only depth. Return only valid JSON. Do not change the thesis, but make the reasoning more rigorous, concrete, and decision-grade.',
            },
            {
              role: 'user',
              content: buildStrategyMemoDepthRepairPrompt(
                input,
                [
                  `depth still below target after first repair`,
                  repairedAnalysis.avgParagraphWords < 95 ? `average paragraph depth still too light (${repairedAnalysis.avgParagraphWords} words)` : '',
                  repairedAnalysis.calloutWords < 18 ? `lead callout still too light (${repairedAnalysis.calloutWords} words)` : '',
                  repairedAnalysis.moveCount < 3 ? `strategic moves still too few (${repairedAnalysis.moveCount})` : '',
                  repairedAnalysis.avgStrategicMoveWords < 14 ? `strategic moves still too generic on average (${repairedAnalysis.avgStrategicMoveWords} words)` : '',
                  repairedAnalysis.analysisWords < 180 ? `analysis still too thin (${repairedAnalysis.analysisWords} words)` : '',
                  repairedAnalysis.positioningWords < 120 ? `positioning still too thin (${repairedAnalysis.positioningWords} words)` : '',
                  repairedAnalysis.thesisWords < 85 ? `thesis still too thin (${repairedAnalysis.thesisWords} words)` : '',
                ].filter(Boolean).join('; '),
                parsed,
              ),
            },
          ],
        });

        const secondRepairRaw = secondRepair.output ? JSON.parse(secondRepair.output) : null;
        if (secondRepairRaw && typeof secondRepairRaw === 'object') {
          const secondRepairedBlocks = applyStrategyMemoDepthRepair(parsed.content_blocks, secondRepairRaw);
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
          const secondAnalysis = analyzeStrategyMemoDraft(secondRepairedBlocks);
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
    const preFinalAnalysis = analyzeStrategyMemoDraft(parsed.content_blocks);
    const stillMateriallyWeak = preFinalScore.breakdown.depth < 18
      || preFinalAnalysis.analysisWords < 190
      || preFinalAnalysis.positioningWords < 125
      || preFinalAnalysis.thesisWords < 90
      || preFinalAnalysis.avgStrategicMoveWords < 15;

    if (stillMateriallyWeak) {
      try {
        const focusedRepair = await runCompletionWithOperation({
          operation: 'newsletterGeneration',
          companyId: input.company_id,
          model: 'gpt-4o',
          temperature: 0.1,
          response_format: { type: 'json_object' },
          max_tokens: 2600,
          messages: [
            {
              role: 'system',
              content: 'You are a senior strategy consultant rewriting only the strategic core of a memo. Return only valid JSON. Make the logic deeper, sharper, and more decision-grade.',
            },
            {
              role: 'user',
              content: buildStrategyMemoFocusedBodyPrompt(
                input,
                [
                  `depth still materially weak (${preFinalScore.breakdown.depth}/20)`,
                  preFinalAnalysis.analysisWords < 190 ? `analysis still too thin (${preFinalAnalysis.analysisWords} words)` : '',
                  preFinalAnalysis.positioningWords < 125 ? `positioning still too thin (${preFinalAnalysis.positioningWords} words)` : '',
                  preFinalAnalysis.thesisWords < 90 ? `thesis still too thin (${preFinalAnalysis.thesisWords} words)` : '',
                  preFinalAnalysis.avgStrategicMoveWords < 15 ? `strategic moves still too generic on average (${preFinalAnalysis.avgStrategicMoveWords} words)` : '',
                ].filter(Boolean).join('; '),
                parsed,
              ),
            },
          ],
        });

        const focusedRaw = focusedRepair.output ? JSON.parse(focusedRepair.output) : null;
        if (focusedRaw && typeof focusedRaw === 'object') {
          const focusedBlocks = applyStrategyMemoDepthRepair(parsed.content_blocks, focusedRaw);
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
          const focusedAnalysis = analyzeStrategyMemoDraft(focusedBlocks);
          const focusedComposite = focusedScore.breakdown.depth * 4
            + focusedAnalysis.analysisWords
            + focusedAnalysis.positioningWords
            + focusedAnalysis.thesisWords
            + focusedAnalysis.avgStrategicMoveWords * 4;
          const currentComposite = preFinalScore.breakdown.depth * 4
            + preFinalAnalysis.analysisWords
            + preFinalAnalysis.positioningWords
            + preFinalAnalysis.thesisWords
            + preFinalAnalysis.avgStrategicMoveWords * 4;
          if (focusedComposite > currentComposite) {
            parsed.content_blocks = focusedBlocks;
          }
        }
      } catch {
        // Best-effort focused repair only
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
    const finalAnalysis = analyzeStrategyMemoDraft(parsed.content_blocks);
    const finalWeakDepth = finalScore.breakdown.depth < 18
      || finalScore.issues.some((issue) => issue.category === 'depth')
      || finalAnalysis.avgParagraphWords < 98
      || finalAnalysis.paragraphCount < 7
      || finalAnalysis.calloutWords < 18
      || finalAnalysis.moveCount < 3
      || finalAnalysis.avgStrategicMoveWords < 14
      || finalAnalysis.analysisWords < 180
      || finalAnalysis.positioningWords < 120
      || finalAnalysis.thesisWords < 85;

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
        hook_assessment: { strength: 'moderate', note: 'Newsletter-owned strategy memo generation path used.' },
        result: parsed,
        governance: buildGovernanceExplainabilityMetadata(null),
      };
    }

    retryReason = [
      `depth too weak (${finalScore.breakdown.depth}/20)`,
      finalAnalysis.avgParagraphWords < 98 ? `average paragraph depth too light (${finalAnalysis.avgParagraphWords} words)` : '',
      finalAnalysis.paragraphCount < 7 ? `not enough substantive body paragraphs (${finalAnalysis.paragraphCount})` : '',
      finalAnalysis.calloutWords < 18 ? `lead callout too light (${finalAnalysis.calloutWords} words)` : '',
      finalAnalysis.moveCount < 3 ? `not enough substantive strategic moves (${finalAnalysis.moveCount})` : '',
      finalAnalysis.avgStrategicMoveWords < 14 ? `strategic moves too generic on average (${finalAnalysis.avgStrategicMoveWords} words)` : '',
      finalAnalysis.analysisWords < 180 ? `analysis section too thin (${finalAnalysis.analysisWords} words)` : '',
      finalAnalysis.positioningWords < 120 ? `positioning section too thin (${finalAnalysis.positioningWords} words)` : '',
      finalAnalysis.thesisWords < 85 ? `thesis section too thin (${finalAnalysis.thesisWords} words)` : '',
    ].filter(Boolean).join('; ');
  }

  if (best) {
    return {
      needs_clarification: false,
      mode: 'full',
      confidence: 'medium',
      template_used: true,
      hook_assessment: { strength: 'moderate', note: 'Newsletter-owned strategy memo generation path used.' },
      result: best,
      governance: buildGovernanceExplainabilityMetadata(null),
    };
  }

  throw new Error('Failed to generate Strategy Memo newsletter');
}
