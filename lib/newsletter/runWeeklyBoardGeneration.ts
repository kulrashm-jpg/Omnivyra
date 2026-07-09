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
  ListBlock,
  ParagraphBlock,
  QuoteBlock,
  ReferencesBlock,
  SummaryBlock,
} from '../content/blockTypes';
import { flattenBlocks } from '../content/blockUtils';


// Module layout (Agent-B large-file modularization — behavior-preserving):
//   runWeeklyBoardGenerationPrompts.ts — template + prompt builders + output parsing
//   runWeeklyBoardGenerationRepair.ts  — draft analysis + depth repair/expansion
import {
  getTargetWords, getAnalystBoardTemplate, buildAnalystBoardPrompt,
  normalizeSignals, parseAnalystBoardOutput,
} from './runWeeklyBoardGenerationPrompts';
import {
  ensureAnalystBoardExtractables, analyzeAnalystBoardDraft, getAnalystBoardComposite,
  buildAnalystBoardDepthRepairPrompt, buildAnalystBoardFocusedBodyPrompt,
  buildAnalystBoardExpansionPrompt, applyAnalystBoardDepthRepair,
} from './runWeeklyBoardGenerationRepair';
export async function runWeeklyBoardGeneration(
  input: NewsletterGenerationRequest,
): Promise<NewsletterGenerationResult> {
  const template = getAnalystBoardTemplate(input);
  const targetWords = getTargetWords(input);
  const signalCount = targetWords >= 1600 ? 5 : targetWords >= 1200 ? 4 : 3;

  let retryReason: string | undefined;
  let best: ReturnType<typeof parseAnalystBoardOutput> | null = null;
  let bestScore = -1;

  const enhancedBoardSystemPrompt = await enhanceSystemPromptForNewsletter(
    'You are a senior analyst editor writing an intelligent weekly brief. Return only valid JSON. Be specific, interpretive, and decision-useful.',
    input.company_id, input.companyContext,
  );

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const completion = await runCompletionWithOperation({
      operation: 'newsletterGeneration',
      companyId: input.company_id,
      cache_version: `${input.cache_version ?? 'newsletter'}:analyst-board:v2:attempt:${attempt}`,
      model: 'gpt-4o',
      temperature: 0.25,
      response_format: { type: 'json_object' },
      max_tokens: targetWords >= 1600 ? 5200 : 4200,
      messages: [
        {
          role: 'system',
          content: enhancedBoardSystemPrompt,
        },
        {
          role: 'user',
          content: buildAnalystBoardPrompt(input, targetWords, signalCount, retryReason),
        },
      ],
    });

    const raw = completion.output ? JSON.parse(completion.output) : null;
    const parsed = raw ? ensureAnalystBoardExtractables(parseAnalystBoardOutput(raw, template, signalCount)) : null;
    if (!parsed) {
      retryReason = 'output was not valid structured analyst board JSON';
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
      format_type: 'weekly-brief',
    });
    const analysis = analyzeAnalystBoardDraft(parsed.content_blocks);
    const composite = score.breakdown.structure * 3 + score.breakdown.depth * 3 + score.breakdown.geo * 3 + score.breakdown.seo;
    if (composite > bestScore) {
      bestScore = composite;
      best = parsed;
    }

    const weakStructure = score.breakdown.structure < 22 || !analysis.insightsOk || analysis.filledCallouts < 2 || analysis.filledQuotes < 1;
    const weakDepth = score.breakdown.depth < 15 || analysis.avgParagraphWords < 75 || analysis.strongSignals < signalCount || !analysis.quickTakesOk;
    const weakGeo = score.breakdown.geo < 14 || analysis.filledReferences < (targetWords >= 1600 ? 3 : 2) || !analysis.summaryOk;

    if (weakDepth || weakStructure || weakGeo) {
      try {
        const repair = await runCompletionWithOperation({
          operation: 'newsletterGeneration',
          companyId: input.company_id,
          cache_version: `${input.cache_version ?? 'newsletter'}:analyst-board-repair:v3:attempt:${attempt}`,
          model: 'gpt-4o',
          temperature: 0.2,
          response_format: { type: 'json_object' },
          max_tokens: targetWords >= 1600 ? 3600 : 2800,
          messages: [
            {
              role: 'system',
              content: 'You are a senior analyst editor deepening an existing weekly brief. Return only valid JSON.',
            },
            {
              role: 'user',
              content: buildAnalystBoardDepthRepairPrompt(
                input,
                targetWords,
                signalCount,
                [
                  weakStructure ? `structure too weak (${score.breakdown.structure}/25)` : '',
                  weakDepth ? `depth too weak (${score.breakdown.depth}/20)` : '',
                  weakGeo ? `geo too weak (${score.breakdown.geo}/20)` : '',
                  analysis.avgParagraphWords < 75 ? `paragraph depth too light (${analysis.avgParagraphWords} words)` : '',
                  analysis.strongSignals < signalCount ? `not enough fully developed signals (${analysis.strongSignals}/${signalCount})` : '',
                  analysis.filledCallouts < 2 ? `need stronger callouts (${analysis.filledCallouts}/2)` : '',
                  analysis.filledQuotes < 1 ? 'need one quotable analyst line' : '',
                  !analysis.summaryOk ? 'summary is too thin' : '',
                ].filter(Boolean).join('; '),
              ),
            },
          ],
        });

        const repairRaw = repair.output ? JSON.parse(repair.output) : null;
        if (repairRaw && typeof repairRaw === 'object') {
          const repairedBlocks = applyAnalystBoardDepthRepair(parsed.content_blocks, repairRaw, signalCount);
          const repairedEvaluation = getAnalystBoardComposite(repairedBlocks, parsed, targetWords, signalCount);
          const currentEvaluation = getAnalystBoardComposite(parsed.content_blocks, parsed, targetWords, signalCount);
          if (repairedEvaluation.composite > currentEvaluation.composite) {
            parsed.content_blocks = repairedBlocks;
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
      format_type: 'weekly-brief',
    });
    const finalAnalysis = analyzeAnalystBoardDraft(parsed.content_blocks);
    const stillMateriallyWeak = finalScore.breakdown.depth < 16
      || finalAnalysis.avgParagraphWords < (targetWords >= 1600 ? 102 : targetWords >= 1200 ? 90 : 75)
      || finalAnalysis.strongSignals < signalCount
      || !finalAnalysis.quickTakesOk;

    if (stillMateriallyWeak) {
      try {
        const focusedRepair = await runCompletionWithOperation({
          operation: 'newsletterGeneration',
          companyId: input.company_id,
          cache_version: `${input.cache_version ?? 'newsletter'}:analyst-board-focused:v1:attempt:${attempt}`,
          model: 'gpt-4o',
          temperature: 0.15,
          response_format: { type: 'json_object' },
          max_tokens: targetWords >= 1600 ? 4400 : 3400,
          messages: [
            {
              role: 'system',
              content: 'You are a senior analyst editor rewriting only the body of a weekly board. Return only valid JSON. Make it more interpretive, more substantial, and more decision-useful.',
            },
            {
              role: 'user',
              content: buildAnalystBoardFocusedBodyPrompt(
                input,
                targetWords,
                signalCount,
                [
                  `depth still weak (${finalScore.breakdown.depth}/20)`,
                  finalAnalysis.avgParagraphWords < (targetWords >= 1600 ? 102 : targetWords >= 1200 ? 90 : 75) ? `average paragraph depth still too light (${finalAnalysis.avgParagraphWords} words)` : '',
                  finalAnalysis.strongSignals < signalCount ? `not enough fully developed signals (${finalAnalysis.strongSignals}/${signalCount})` : '',
                  !finalAnalysis.quickTakesOk ? 'quick takes still too thin' : '',
                ].filter(Boolean).join('; '),
              ),
            },
          ],
        });

        const focusedRaw = focusedRepair.output ? JSON.parse(focusedRepair.output) : null;
        if (focusedRaw && typeof focusedRaw === 'object') {
          const focusedBlocks = applyAnalystBoardDepthRepair(parsed.content_blocks, focusedRaw, signalCount);
          const focusedEvaluation = getAnalystBoardComposite(focusedBlocks, parsed, targetWords, signalCount);
          const currentEvaluation = getAnalystBoardComposite(parsed.content_blocks, parsed, targetWords, signalCount);
          if (focusedEvaluation.composite > currentEvaluation.composite) {
            parsed.content_blocks = focusedBlocks;
          }
        }
      } catch {
        // Best-effort only
      }
    }

    const needsLongFormExpansion = targetWords >= 1200 && finalScore.meta.wordCount < Math.round(targetWords * 0.9);
    if (needsLongFormExpansion) {
      try {
        const expansionRepair = await runCompletionWithOperation({
          operation: 'newsletterGeneration',
          companyId: input.company_id,
          cache_version: `${input.cache_version ?? 'newsletter'}:analyst-board-expansion:v2:attempt:${attempt}`,
          model: 'gpt-4o',
          temperature: 0.15,
          response_format: { type: 'json_object' },
          max_tokens: targetWords >= 1600 ? 5200 : 4200,
          messages: [
            {
              role: 'system',
              content: 'You are a senior analyst editor expanding only the body of a weekly board. Return only valid JSON. Make it materially longer, more interpretive, and more decision-useful without changing the core thesis.',
            },
            {
              role: 'user',
              content: buildAnalystBoardExpansionPrompt(
                input,
                targetWords,
                signalCount,
                `draft is still far below target length (${finalScore.meta.wordCount}/${targetWords} words); the weekly summary, signal bodies, pattern, and closing all need materially more reasoning`,
              ),
            },
          ],
        });

        const expansionRaw = expansionRepair.output ? JSON.parse(expansionRepair.output) : null;
        if (expansionRaw && typeof expansionRaw === 'object') {
          const expandedBlocks = applyAnalystBoardDepthRepair(parsed.content_blocks, expansionRaw, signalCount);
          const expandedEvaluation = getAnalystBoardComposite(expandedBlocks, parsed, targetWords, signalCount);
          const currentEvaluation = getAnalystBoardComposite(parsed.content_blocks, parsed, targetWords, signalCount);
          if (expandedEvaluation.composite > currentEvaluation.composite) {
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
      format_type: 'weekly-brief',
    });
    const settledAnalysis = analyzeAnalystBoardDraft(parsed.content_blocks);
    const finalComposite = settledScore.breakdown.structure * 3 + settledScore.breakdown.depth * 3 + settledScore.breakdown.geo * 3 + settledScore.breakdown.seo;
    if (finalComposite > bestScore) {
      bestScore = finalComposite;
      best = parsed;
    }

    const finalWeakStructure = settledScore.breakdown.structure < 21 || !settledAnalysis.insightsOk || settledAnalysis.filledCallouts < 2;
    const finalWeakDepth = settledScore.breakdown.depth < 15 || settledAnalysis.avgParagraphWords < 75 || settledAnalysis.strongSignals < signalCount || !settledAnalysis.quickTakesOk;
    const finalWeakGeo = settledScore.breakdown.geo < 14 || settledAnalysis.filledReferences < (targetWords >= 1600 ? 3 : 2) || !settledAnalysis.summaryOk;

    if (!finalWeakStructure && !finalWeakDepth && !finalWeakGeo) {
      return {
        needs_clarification: false,
        mode: 'full',
        confidence: 'high',
        template_used: true,
        hook_assessment: { strength: 'moderate', note: 'Newsletter-owned analyst board generation path used.' },
        result: parsed,
        governance: buildGovernanceExplainabilityMetadata(null),
      };
    }

    retryReason = [
      finalWeakStructure ? `structure too weak (${settledScore.breakdown.structure}/25)` : '',
      finalWeakDepth ? `depth too weak (${settledScore.breakdown.depth}/20)` : '',
      finalWeakGeo ? `GEO too weak (${settledScore.breakdown.geo}/20)` : '',
      settledAnalysis.avgParagraphWords < 75 ? `paragraph depth too light (${settledAnalysis.avgParagraphWords} words)` : '',
      settledAnalysis.strongSignals < signalCount ? `not enough fully developed signals (${settledAnalysis.strongSignals}/${signalCount})` : '',
      settledAnalysis.filledReferences < (targetWords >= 1600 ? 3 : 2) ? 'references are too weak' : '',
      !settledAnalysis.summaryOk ? 'summary is too thin' : '',
      !settledAnalysis.insightsOk ? 'key insights are too weak' : '',
    ].filter(Boolean).join('; ');
  }

  if (best) {
    return {
      needs_clarification: false,
      mode: 'full',
      confidence: 'medium',
      template_used: true,
      hook_assessment: { strength: 'moderate', note: 'Newsletter-owned analyst board generation path used.' },
      result: best,
      governance: buildGovernanceExplainabilityMetadata(null),
    };
  }

  throw new Error('Failed to generate Analyst Board newsletter');
}
