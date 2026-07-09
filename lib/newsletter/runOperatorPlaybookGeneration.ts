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
  ListBlock,
} from '../content/blockTypes';
import { flattenBlocks } from '../content/blockUtils';


// Agent-B split: private helpers live in ./runOperatorPlaybookGenerationHelpers (behavior-preserving).
import { getTargetWords, getOperatorPlaybookTemplate, normalizeParagraphHtml, buildOperatorPlaybookPrompt, buildOperatorPlaybookRepairPrompt, buildOperatorPlaybookDepthRepairPrompt, buildOperatorPlaybookExpansionPrompt, buildOperatorPlaybookFocusedBodyPrompt, parseOperatorPlaybookOutput, analyzeOperatorPlaybookDraft, getOperatorPlaybookComposite, mergeOperatorPlaybookRepair, mergeOperatorPlaybookExpansion } from './runOperatorPlaybookGenerationHelpers';

export async function runOperatorPlaybookGeneration(input: NewsletterGenerationRequest): Promise<NewsletterGenerationResult> {
  const template = getOperatorPlaybookTemplate(input);
  const targetWords = getTargetWords(input);
  let retryReason: string | undefined;
  let best: ReturnType<typeof parseOperatorPlaybookOutput> | null = null;
  let bestScore = -1;

  const enhancedPlaybookSystemPrompt = await enhanceSystemPromptForNewsletter(
    'You are an operator writing an action-letter newsletter. Return only valid JSON. Focus on executable steps, realistic mistakes, and immediate action clarity.',
    input.company_id, input.companyContext,
  );

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const completion = await runCompletionWithOperation({
      operation: 'newsletterGeneration',
      companyId: input.company_id,
      cache_version: `${input.cache_version ?? 'newsletter'}:operator-playbook:v1:attempt:${attempt}`,
      model: 'gpt-4o',
      temperature: 0.25,
      response_format: { type: 'json_object' },
      max_tokens: targetWords >= 1600 ? 4600 : 3600,
      messages: [
        { role: 'system', content: enhancedPlaybookSystemPrompt },
        { role: 'user', content: buildOperatorPlaybookPrompt(input, targetWords, retryReason) },
      ],
    });

    const raw = completion.output ? JSON.parse(completion.output) : null;
    const parsed = raw ? parseOperatorPlaybookOutput(raw, template) : null;
    if (!parsed) {
      retryReason = 'output was not valid structured operator playbook JSON';
      continue;
    }
    if (parsed.title.trim().length > 0 && parsed.title.trim().length < 20) {
      parsed.title = `${parsed.title.trim()}: Operator Playbook`;
      if (!parsed.seo_meta_title?.trim()) {
        parsed.seo_meta_title = parsed.title.trim();
      }
    }
    if (!parsed.excerpt?.trim() || parsed.excerpt.trim().length < 70) {
      const fallbackExcerpt = [
        raw.summary_body,
        raw.framework_intro_html,
        raw.outcome_html,
        parsed.title,
      ].find((value) => typeof value === 'string' && value.trim().length > 0);
      if (typeof fallbackExcerpt === 'string' && fallbackExcerpt.trim()) {
        parsed.excerpt = fallbackExcerpt.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 155);
      }
    }
    if (!parsed.seo_meta_description?.trim() || parsed.seo_meta_description.trim().length < 70) {
      parsed.seo_meta_description = (parsed.excerpt || parsed.title).slice(0, 155).trim();
    }

    let activeRaw = raw;
    let activeParsed = parsed;
    let evaluation = getOperatorPlaybookComposite(activeParsed, targetWords);

    if (evaluation.weak && attempt < 2) {
      const repair = await runCompletionWithOperation({
        operation: 'newsletterGeneration',
        companyId: input.company_id,
        cache_version: `${input.cache_version ?? 'newsletter'}:operator-playbook-repair:v1:attempt:${attempt}`,
        model: 'gpt-4o',
        temperature: 0.2,
        response_format: { type: 'json_object' },
        max_tokens: targetWords >= 1600 ? 4800 : 3800,
        messages: [
          { role: 'system', content: 'You are repairing an operator action-letter newsletter. Return only valid JSON and make it deeper, more concrete, and more search-friendly.' },
          { role: 'user', content: buildOperatorPlaybookRepairPrompt(input, targetWords, activeRaw, retryReason || 'depth and SEO are too weak') },
        ],
      });

      const repairedRaw = repair.output ? JSON.parse(repair.output) : null;
      const repairedParsed = repairedRaw ? parseOperatorPlaybookOutput(repairedRaw, template) : null;
      if (repairedParsed) {
        const repairedEvaluation = getOperatorPlaybookComposite(repairedParsed, targetWords);
        if (repairedEvaluation.composite > evaluation.composite) {
          activeRaw = repairedRaw;
          activeParsed = repairedParsed;
          evaluation = repairedEvaluation;
        }
      }
    }

    if (evaluation.weak && attempt < 2) {
      const depthRepair = await runCompletionWithOperation({
        operation: 'newsletterGeneration',
        companyId: input.company_id,
        cache_version: `${input.cache_version ?? 'newsletter'}:operator-playbook-depth:v1:attempt:${attempt}`,
        model: 'gpt-4o',
        temperature: 0.2,
        response_format: { type: 'json_object' },
        max_tokens: targetWords >= 1600 ? 3200 : 2600,
        messages: [
          { role: 'system', content: 'You are deepening an operator playbook. Return only valid JSON for the requested repair fields.' },
          { role: 'user', content: buildOperatorPlaybookDepthRepairPrompt(input, targetWords, activeRaw, retryReason || 'depth is still too weak') },
        ],
      });

      const depthRepairRaw = depthRepair.output ? JSON.parse(depthRepair.output) : null;
      const merged = mergeOperatorPlaybookRepair(activeRaw, depthRepairRaw, template);
      if (merged) {
        const repairedEvaluation = getOperatorPlaybookComposite(merged.mergedParsed, targetWords);
        if (repairedEvaluation.composite > evaluation.composite) {
          activeRaw = merged.mergedRaw;
          activeParsed = merged.mergedParsed;
          evaluation = repairedEvaluation;
        }
      }
    }

    if (evaluation.weak && evaluation.score.meta.wordCount < Math.round(targetWords * 0.9) && attempt < 2) {
      const expansion = await runCompletionWithOperation({
        operation: 'newsletterGeneration',
        companyId: input.company_id,
        cache_version: `${input.cache_version ?? 'newsletter'}:operator-playbook-expansion:v1:attempt:${attempt}`,
        model: 'gpt-4o',
        temperature: 0.25,
        response_format: { type: 'json_object' },
        max_tokens: targetWords >= 1600 ? 4200 : 3400,
        messages: [
          { role: 'system', content: 'You are expanding an operator playbook action-letter newsletter. Return only valid JSON for the requested fields and add real depth.' },
          { role: 'user', content: buildOperatorPlaybookExpansionPrompt(input, targetWords, activeRaw, retryReason || 'word count and depth are still too weak') },
        ],
      });

      const expansionRaw = expansion.output ? JSON.parse(expansion.output) : null;
      const merged = mergeOperatorPlaybookExpansion(activeRaw, expansionRaw, template);
      if (merged) {
        const repairedEvaluation = getOperatorPlaybookComposite(merged.mergedParsed, targetWords);
        if (repairedEvaluation.composite > evaluation.composite) {
          activeRaw = merged.mergedRaw;
          activeParsed = merged.mergedParsed;
          evaluation = repairedEvaluation;
        }
      }
    }

    if (evaluation.weak && targetWords >= 1600 && evaluation.score.meta.wordCount < Math.round(targetWords * 0.95) && attempt < 2) {
      const focusedExpansion = await runCompletionWithOperation({
        operation: 'newsletterGeneration',
        companyId: input.company_id,
        cache_version: `${input.cache_version ?? 'newsletter'}:operator-playbook-focused:v2:attempt:${attempt}`,
        model: 'gpt-4o',
        temperature: 0.1,
        response_format: { type: 'json_object' },
        max_tokens: 4600,
        messages: [
          { role: 'system', content: 'You are rewriting the long-form execution body of an operator playbook for a 1600-word target. Return only valid JSON. Materially expand the body, make the framework steps more specific, and deepen the breakdown reasoning.' },
          { role: 'user', content: buildOperatorPlaybookFocusedBodyPrompt(input, targetWords, activeRaw, retryReason || `draft is still materially below target length (${evaluation.score.meta.wordCount}/${targetWords} words)`) },
        ],
      });

      const focusedRaw = focusedExpansion.output ? JSON.parse(focusedExpansion.output) : null;
      const merged = mergeOperatorPlaybookExpansion(activeRaw, focusedRaw, template);
      if (merged) {
        const repairedEvaluation = getOperatorPlaybookComposite(merged.mergedParsed, targetWords);
        if (repairedEvaluation.composite > evaluation.composite) {
          activeRaw = merged.mergedRaw;
          activeParsed = merged.mergedParsed;
          evaluation = repairedEvaluation;
        }
      }
    }

    if (evaluation.weak && attempt < 2) {
      const focused = await runCompletionWithOperation({
        operation: 'newsletterGeneration',
        companyId: input.company_id,
        cache_version: `${input.cache_version ?? 'newsletter'}:operator-playbook-focused:v1:attempt:${attempt}`,
        model: 'gpt-4o',
        temperature: 0.15,
        response_format: { type: 'json_object' },
        max_tokens: targetWords >= 1600 ? 4200 : 3200,
        messages: [
          { role: 'system', content: 'You are rewriting only the long-form execution body of an operator playbook. Return only valid JSON. Make it denser, clearer, and more action-ready.' },
          { role: 'user', content: buildOperatorPlaybookFocusedBodyPrompt(input, targetWords, activeRaw, retryReason || 'depth is still too weak') },
        ],
      });

      const focusedRaw = focused.output ? JSON.parse(focused.output) : null;
      const merged = mergeOperatorPlaybookExpansion(activeRaw, focusedRaw, template);
      if (merged) {
        const repairedEvaluation = getOperatorPlaybookComposite(merged.mergedParsed, targetWords);
        if (repairedEvaluation.composite > evaluation.composite) {
          activeRaw = merged.mergedRaw;
          activeParsed = merged.mergedParsed;
          evaluation = repairedEvaluation;
        }
      }
    }

    const { score, analysis, weak, composite } = evaluation;
    if (composite > bestScore) { bestScore = composite; best = activeParsed; }
    if (!weak) {
      return { needs_clarification: false, mode: 'full', confidence: 'high', template_used: true, hook_assessment: { strength: 'moderate', note: 'Newsletter-owned operator playbook generation path used.' }, result: activeParsed, governance: buildGovernanceExplainabilityMetadata(null) };
    }

    retryReason = [
      `depth too weak (${score.breakdown.depth}/20)`,
      `seo too weak (${score.breakdown.seo}/15)`,
      score.meta.wordCount < Math.round(targetWords * 0.85) ? `draft far below target length (${score.meta.wordCount}/${targetWords} words)` : '',
      analysis.avgParagraphWords < 65 ? `average paragraph depth too light (${analysis.avgParagraphWords} words)` : '',
      analysis.frameworkCount < 3 ? `not enough framework steps (${analysis.frameworkCount})` : '',
      analysis.frameworkAvgWords < 9 ? `framework steps too generic (${analysis.frameworkAvgWords} words avg)` : '',
      analysis.breakdownAvgWords < 95 ? `step breakdowns too thin (${analysis.breakdownAvgWords} words avg)` : '',
      analysis.mistakesCount < 3 ? `not enough realistic mistakes (${analysis.mistakesCount})` : '',
      analysis.mistakesAvgWords < 11 ? `mistakes are too generic (${analysis.mistakesAvgWords} words avg)` : '',
      analysis.ctaWords < 45 ? `CTA too thin (${analysis.ctaWords} words)` : '',
      !activeParsed.excerpt || activeParsed.excerpt.trim().length < 80 ? `excerpt too weak (${activeParsed.excerpt?.trim().length || 0} chars)` : '',
      !activeParsed.seo_meta_title || activeParsed.seo_meta_title.trim().length < 35 ? `seo title too weak (${activeParsed.seo_meta_title?.trim().length || 0} chars)` : '',
      !activeParsed.seo_meta_description || activeParsed.seo_meta_description.trim().length < 110 ? `seo description too weak (${activeParsed.seo_meta_description?.trim().length || 0} chars)` : '',
    ].filter(Boolean).join('; ');

    if (composite > bestScore) { bestScore = composite; best = activeParsed; }
  }

  if (best) {
    return { needs_clarification: false, mode: 'full', confidence: 'medium', template_used: true, hook_assessment: { strength: 'moderate', note: 'Newsletter-owned operator playbook generation path used.' }, result: best, governance: buildGovernanceExplainabilityMetadata(null) };
  }
  throw new Error('Failed to generate Operator Playbook newsletter');
}
