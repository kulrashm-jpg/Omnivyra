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
  QuoteBlock,
  SummaryBlock,
  ListBlock,
  ReferencesBlock,
  ColumnsBlock,
} from '../content/blockTypes';
import { flattenBlocks } from '../content/blockUtils';


// Agent-B split: private helpers live in ./runWeeklyRadarGenerationHelpers (behavior-preserving).
import { getTargetWords, getSignalRadarTemplate, buildWeeklyRadarPrompt, normalizeParagraphHtml, stripHtml, countWords, normalizeSignals, parseWeeklyRadarOutput } from './runWeeklyRadarGenerationHelpers';
import { ensureWeeklyRadarExtractables, analyzeWeeklyRadarDraft, buildWeeklyRadarDepthRepairPrompt, buildWeeklyRadarFocusedBodyPrompt, applyWeeklyRadarDepthRepair } from './runWeeklyRadarGenerationRepair';

export async function runWeeklyRadarGeneration(
  input: NewsletterGenerationRequest,
): Promise<NewsletterGenerationResult> {
  const template = getSignalRadarTemplate(input);
  const targetWords = getTargetWords(input);
  const signalCount = targetWords >= 1600 ? 5 : targetWords >= 1200 ? 4 : 3;

  let retryReason: string | undefined;
  let best: ReturnType<typeof parseWeeklyRadarOutput> | null = null;
  let bestScore = -1;

  // Enhance system prompt with identity lock + anti-generic rules
  const enhancedRadarSystemPrompt = await enhanceSystemPromptForNewsletter(
    'You are a senior newsletter editor writing a weekly brief. Return only valid JSON. Prioritize signal over noise and always interpret what matters.',
    input.company_id, input.companyContext,
  );

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const completion = await runCompletionWithOperation({
      operation: 'newsletterGeneration',
      companyId: input.company_id,
      cache_version: `${input.cache_version ?? 'newsletter'}:signal-radar:v2:attempt:${attempt}`,
      model: 'gpt-4o',
      temperature: 0.25,
      response_format: { type: 'json_object' },
      max_tokens: targetWords >= 1600 ? 5200 : 4200,
      messages: [
        {
          role: 'system',
          content: enhancedRadarSystemPrompt,
        },
        {
          role: 'user',
          content: buildWeeklyRadarPrompt(input, targetWords, signalCount, retryReason),
        },
      ],
    });

    const raw = completion.output ? JSON.parse(completion.output) : null;
    const parsed = raw ? ensureWeeklyRadarExtractables(parseWeeklyRadarOutput(raw, template, signalCount)) : null;
    if (!parsed) {
      retryReason = 'output was not valid structured weekly brief JSON';
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

    const analysis = analyzeWeeklyRadarDraft(parsed.content_blocks);
    const weakStructure = score.breakdown.structure < 22 || score.issues.some((issue) => issue.category === 'structure') || !analysis.insightsOk || analysis.strongSignals < signalCount || analysis.filledCallouts < 1 || analysis.filledQuotes < 1;
    const weakDepth = score.breakdown.depth < 14 || score.issues.some((issue) => issue.category === 'depth') || analysis.avgParagraphWords < 70;
    const weakGeo = score.breakdown.geo < 16 || score.issues.some((issue) => issue.category === 'geo') || analysis.filledReferences < (targetWords >= 1600 ? 3 : 2) || !analysis.summaryOk || analysis.filledCallouts < 1 || analysis.filledQuotes < 1;

    const composite = score.breakdown.structure * 3 + score.breakdown.depth * 3 + score.breakdown.geo * 3 + score.breakdown.seo;
    if (composite > bestScore) {
      bestScore = composite;
      best = parsed;
    }

    if (weakDepth) {
      try {
        const repair = await runCompletionWithOperation({
          operation: 'newsletterGeneration',
          companyId: input.company_id,
          cache_version: `${input.cache_version ?? 'newsletter'}:signal-radar-repair:v3:attempt:${attempt}`,
          model: 'gpt-4o',
          temperature: 0.2,
          response_format: { type: 'json_object' },
          max_tokens: targetWords >= 1600 ? 3600 : 2800,
          messages: [
            {
              role: 'system',
              content: 'You are a senior newsletter editor deepening a weekly brief. Return only valid JSON.',
            },
            {
              role: 'user',
              content: buildWeeklyRadarDepthRepairPrompt(
                input,
                targetWords,
                signalCount,
                [
                  `depth score: ${score.breakdown.depth}/20`,
                  analysis.avgParagraphWords < 70 ? `paragraph depth too light (${analysis.avgParagraphWords} words)` : '',
                  analysis.strongSignals < signalCount ? `not all signals are fully developed (${analysis.strongSignals}/${signalCount})` : '',
                ].filter(Boolean).join('; '),
              ),
            },
          ],
        });

        const repairRaw = repair.output ? JSON.parse(repair.output) : null;
        if (repairRaw && typeof repairRaw === 'object') {
          const repairedBlocks = applyWeeklyRadarDepthRepair(parsed.content_blocks, repairRaw, signalCount);
          const repairedScore = calculateNewsletterQualityScore(repairedBlocks, {
            title: parsed.title,
            excerpt: parsed.excerpt,
            seo_meta_title: parsed.seo_meta_title,
            seo_meta_description: parsed.seo_meta_description,
            tags: parsed.tags,
            target_word_count: targetWords,
            content_type: 'newsletter',
            format_type: 'weekly-brief',
          });
          if (repairedScore.total > score.total) {
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
    const finalAnalysis = analyzeWeeklyRadarDraft(parsed.content_blocks);
    const stillMateriallyWeak = finalScore.breakdown.depth < 15
      || finalAnalysis.avgParagraphWords < (targetWords >= 1600 ? 82 : 70)
      || finalAnalysis.strongSignals < signalCount;

    if (stillMateriallyWeak) {
      try {
        const focusedRepair = await runCompletionWithOperation({
          operation: 'newsletterGeneration',
          companyId: input.company_id,
          cache_version: `${input.cache_version ?? 'newsletter'}:signal-radar-focused:v1:attempt:${attempt}`,
          model: 'gpt-4o',
          temperature: 0.15,
          response_format: { type: 'json_object' },
          max_tokens: targetWords >= 1600 ? 4200 : 3200,
          messages: [
            {
              role: 'system',
              content: 'You are a senior newsletter editor rewriting only the body of a signal radar. Return only valid JSON. Make it deeper, clearer, and more interpretive.',
            },
            {
              role: 'user',
              content: buildWeeklyRadarFocusedBodyPrompt(
                input,
                targetWords,
                signalCount,
                [
                  `depth still weak (${finalScore.breakdown.depth}/20)`,
                  finalAnalysis.avgParagraphWords < (targetWords >= 1600 ? 82 : 70) ? `average paragraph depth still too light (${finalAnalysis.avgParagraphWords} words)` : '',
                  finalAnalysis.strongSignals < signalCount ? `not all signals are fully developed (${finalAnalysis.strongSignals}/${signalCount})` : '',
                ].filter(Boolean).join('; '),
              ),
            },
          ],
        });

        const focusedRaw = focusedRepair.output ? JSON.parse(focusedRepair.output) : null;
        if (focusedRaw && typeof focusedRaw === 'object') {
          const focusedBlocks = applyWeeklyRadarDepthRepair(parsed.content_blocks, focusedRaw, signalCount);
          const focusedScore = calculateNewsletterQualityScore(focusedBlocks, {
            title: parsed.title,
            excerpt: parsed.excerpt,
            seo_meta_title: parsed.seo_meta_title,
            seo_meta_description: parsed.seo_meta_description,
            tags: parsed.tags,
            target_word_count: targetWords,
            content_type: 'newsletter',
            format_type: 'weekly-brief',
          });
          if (focusedScore.total > finalScore.total) {
            parsed.content_blocks = focusedBlocks;
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
    const settledAnalysis = analyzeWeeklyRadarDraft(parsed.content_blocks);
    const finalComposite = settledScore.breakdown.structure * 3 + settledScore.breakdown.depth * 3 + settledScore.breakdown.geo * 3 + settledScore.breakdown.seo;
    if (finalComposite > bestScore) {
      bestScore = finalComposite;
      best = parsed;
    }

    const finalWeakStructure = settledScore.breakdown.structure < 20 || settledScore.issues.some((issue) => issue.category === 'structure') || !settledAnalysis.insightsOk || settledAnalysis.strongSignals < signalCount;
    const finalWeakDepth = settledScore.breakdown.depth < 14 || settledScore.issues.some((issue) => issue.category === 'depth') || settledAnalysis.avgParagraphWords < 70;
    const finalWeakGeo = settledScore.breakdown.geo < 14 || settledScore.issues.some((issue) => issue.category === 'geo') || settledAnalysis.filledReferences < (targetWords >= 1600 ? 3 : 2) || !settledAnalysis.summaryOk;

    if (!finalWeakStructure && !finalWeakDepth && !finalWeakGeo) {
      return {
        needs_clarification: false,
        mode: 'full',
        confidence: 'high',
        template_used: true,
        hook_assessment: { strength: 'moderate', note: 'Newsletter-owned weekly radar generation path used.' },
        result: parsed,
        governance: buildGovernanceExplainabilityMetadata(null),
      };
    }

    retryReason = [
      finalWeakStructure ? `structure too weak (${settledScore.breakdown.structure}/25)` : '',
      finalWeakDepth ? `depth too weak (${settledScore.breakdown.depth}/20)` : '',
      finalWeakGeo ? `GEO too weak (${settledScore.breakdown.geo}/20)` : '',
      settledAnalysis.strongSignals < signalCount ? `not all signals are fully developed (${settledAnalysis.strongSignals}/${signalCount})` : '',
      settledAnalysis.avgParagraphWords < 70 ? `paragraph depth too light (${settledAnalysis.avgParagraphWords} words)` : '',
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
      hook_assessment: { strength: 'moderate', note: 'Newsletter-owned weekly radar generation path used.' },
      result: best,
      governance: buildGovernanceExplainabilityMetadata(null),
    };
  }

  throw new Error('Failed to generate Signal Radar newsletter');
}
