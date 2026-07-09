import { calculateNewsletterQualityScore } from './newsletterValidation';
import type { NewsletterGenerationRequest, NewsletterGenerationResult } from './runNewsletterGeneration';
import type {
  ContentBlock,
  HeadingBlock,
  ParagraphBlock,
  KeyInsightsBlock,
  CalloutBlock,
  QuoteBlock,
  SummaryBlock,
  ColumnsBlock,
  ListBlock,
  ReferencesBlock,
} from '../content/blockTypes';
import { flattenBlocks } from '../content/blockUtils';
import {
  normalizeParagraphHtml,
  stripHtml,
  countWords,
  mergeQuote,
  mergeSummary,
  mergeKeyInsights,
} from './shared/blockHelpers';
import { buildContextHeader } from './shared/promptHelpers';
import {
  resolveTargetWords,
  resolveTemplate,
  buildParsedResult,
  buildSuccessResult,
  buildFallbackResult,
  callAI,
  callRepairAI,
} from './shared/pipeline';

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------


// Agent-B split: private helpers live in ./runInsightLetterGenerationHelpers (behavior-preserving).
import { getTemplate, buildPrompt, buildDepthRepairPrompt, buildExpansionPrompt, PARAGRAPH_FIELDS, parseParagraphHtmlFromObject, parseOutput, ensureExtractables, extractState, applyDepthRepair, analyzeDraft, scoreBlocks, compositeScore } from './runInsightLetterGenerationHelpers';

export async function runInsightLetterGeneration(
  input: NewsletterGenerationRequest,
): Promise<NewsletterGenerationResult> {
  const targetWords = resolveTargetWords(input);
  const template = getTemplate(input);
  const cacheBase = `${input.cache_version ?? 'newsletter'}:minimal-thesis`;
  const note = 'Newsletter-owned insight generation path used.';

  let retryReason: string | undefined;
  let best: ReturnType<typeof parseOutput> | null = null;
  let bestScore = -1;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const raw = await callAI({
      operation: 'newsletterGeneration', companyId: input.company_id,
      cacheVersion: `${cacheBase}:v3:attempt:${attempt}`,
      temperature: 0.25,
      maxTokens: targetWords >= 1600 ? 5600 : 4600,
      systemPrompt: 'You are a senior newsletter strategist and writer. Return only valid JSON. Write a deeply reasoned, forwardable insight letter with strong extraction surfaces. Do not omit any requested fields.',
      userPrompt: buildPrompt(input, targetWords, retryReason),
    });

    const parsed = raw ? ensureExtractables(parseOutput(raw, template)) : null;
    if (!parsed) { retryReason = 'output was not valid template JSON'; continue; }

    const score = scoreBlocks(parsed.content_blocks, parsed, targetWords);
    const cScore = score.breakdown.structure * 3 + score.breakdown.depth * 3 + score.breakdown.geo * 3 + score.breakdown.seo;
    if (cScore > bestScore) { bestScore = cScore; best = parsed; }

    const analysis = analyzeDraft(parsed.content_blocks);
    const weakDepth = score.breakdown.depth < 16
      || score.issues.some((i) => i.category === 'depth')
      || analysis.paragraphCount < (targetWords >= 1600 ? 9 : 8)
      || analysis.avgParagraphWords < (targetWords >= 1600 ? 100 : 90)
      || analysis.sectionWordCounts.insight < (targetWords >= 1600 ? 130 : 110)
      || analysis.sectionWordCounts.evidence < (targetWords >= 1600 ? 95 : 80)
      || analysis.sectionWordCounts.expansion < (targetWords >= 1600 ? 100 : 80)
      || analysis.sectionWordCounts.implication < (targetWords >= 1600 ? 100 : 80);

    if (weakDepth) {
      const depthRaw = await callRepairAI({
        operation: 'newsletterGeneration', companyId: input.company_id,
        cacheVersion: `${cacheBase}-repair:v4:attempt:${attempt}`,
        temperature: 0.2,
        maxTokens: targetWords >= 1600 ? 4200 : 2400,
        systemPrompt: 'You are a senior newsletter writer improving body depth only. Return only valid JSON. Keep the thesis and extraction surfaces intact while deepening the body.',
        userPrompt: buildDepthRepairPrompt(input, targetWords, extractState(parsed.content_blocks), [
          `depth score: ${score.breakdown.depth}/20`,
          analysis.paragraphCount < (targetWords >= 1600 ? 9 : 8) ? `not enough body paragraphs (${analysis.paragraphCount})` : '',
          analysis.avgParagraphWords < (targetWords >= 1600 ? 100 : 90) ? `average paragraph depth too light (${analysis.avgParagraphWords} words)` : '',
          analysis.sectionWordCounts.insight < (targetWords >= 1600 ? 130 : 110) ? `insight section too thin (${analysis.sectionWordCounts.insight} words)` : '',
          analysis.sectionWordCounts.evidence < (targetWords >= 1600 ? 95 : 80) ? `evidence section too thin (${analysis.sectionWordCounts.evidence} words)` : '',
          analysis.sectionWordCounts.expansion < (targetWords >= 1600 ? 100 : 80) ? `expansion section too thin (${analysis.sectionWordCounts.expansion} words)` : '',
          analysis.sectionWordCounts.implication < (targetWords >= 1600 ? 100 : 80) ? `implication section too thin (${analysis.sectionWordCounts.implication} words)` : '',
        ].filter(Boolean).join('; ')),
      });
      if (depthRaw && typeof depthRaw === 'object') {
        const repairedBlocks = ensureExtractables({ ...parsed, content_blocks: applyDepthRepair(parsed.content_blocks, depthRaw) })?.content_blocks ?? parsed.content_blocks;
        const repairedScore = scoreBlocks(repairedBlocks, parsed, targetWords);
        if (repairedScore.breakdown.depth > score.breakdown.depth) {
          parsed.content_blocks = repairedBlocks;
        }
      }
    }

    // Expansion pass 1
    const finalScore = scoreBlocks(parsed.content_blocks, parsed, targetWords);
    const finalAnalysis = analyzeDraft(parsed.content_blocks);
    if (targetWords >= 1200 && finalScore.meta.wordCount < Math.round(targetWords * 0.9)) {
      const currentC = compositeScore(finalScore, finalAnalysis, targetWords);
      const expansionRaw = await callRepairAI({
        operation: 'newsletterGeneration', companyId: input.company_id,
        cacheVersion: `${cacheBase}-focused:v1:attempt:${attempt}`,
        temperature: 0.15,
        maxTokens: targetWords >= 1600 ? 5200 : 4200,
        systemPrompt: 'You are a senior newsletter writer expanding only the long-form body of an insight letter. Return only valid JSON. Make it materially longer, more reasoned, and still sharply structured.',
        userPrompt: buildExpansionPrompt(input, targetWords, extractState(parsed.content_blocks), `draft is still far below target length (${finalScore.meta.wordCount}/${targetWords} words); every major paragraph needs more reasoning, example depth, and implications`),
      });
      if (expansionRaw && typeof expansionRaw === 'object') {
        const repairedBlocks = ensureExtractables({ ...parsed, content_blocks: applyDepthRepair(parsed.content_blocks, expansionRaw) })?.content_blocks ?? parsed.content_blocks;
        const repairedScore = scoreBlocks(repairedBlocks, parsed, targetWords);
        const repairedAnalysis = analyzeDraft(repairedBlocks);
        if (compositeScore(repairedScore, repairedAnalysis, targetWords) > currentC) {
          parsed.content_blocks = repairedBlocks;
        }
      }
    }

    // Expansion pass 2 (high word-count targets only)
    const settledScore = scoreBlocks(parsed.content_blocks, parsed, targetWords);
    const settledAnalysis = analyzeDraft(parsed.content_blocks);
    if (targetWords >= 1600 && settledScore.meta.wordCount < Math.round(targetWords * 0.95)) {
      const currentC = compositeScore(settledScore, settledAnalysis, targetWords);
      const expansionRaw = await callRepairAI({
        operation: 'newsletterGeneration', companyId: input.company_id,
        cacheVersion: `${cacheBase}-focused:v2:attempt:${attempt}`,
        temperature: 0.1,
        maxTokens: 5600,
        systemPrompt: 'You are a senior newsletter writer expanding only the long-form body of a 1600-word insight letter. Return only valid JSON. Materially lengthen the reasoning, deepen the examples, and strengthen the second-order implications without changing the thesis.',
        userPrompt: buildExpansionPrompt(input, targetWords, extractState(parsed.content_blocks), `draft is still materially under target (${settledScore.meta.wordCount}/${targetWords} words); expand context, insight, evidence, expansion, implication, and closing so the letter gets much closer to the expected 1600-word depth`),
      });
      if (expansionRaw && typeof expansionRaw === 'object') {
        const repairedBlocks = ensureExtractables({ ...parsed, content_blocks: applyDepthRepair(parsed.content_blocks, expansionRaw) })?.content_blocks ?? parsed.content_blocks;
        const repairedScore = scoreBlocks(repairedBlocks, parsed, targetWords);
        const repairedAnalysis = analyzeDraft(repairedBlocks);
        if (compositeScore(repairedScore, repairedAnalysis, targetWords) > currentC) {
          parsed.content_blocks = repairedBlocks;
        }
      }
    }

    const final2Score = scoreBlocks(parsed.content_blocks, parsed, targetWords);
    const final2Analysis = analyzeDraft(parsed.content_blocks);
    const weakStructure = final2Score.breakdown.structure < 22 || score.issues.some((i) => i.category === 'structure') || final2Analysis.missingHeadings.length > 0 || !final2Analysis.filledInsights;
    const weakDepth2 = final2Score.breakdown.depth < 16 || score.issues.some((i) => i.category === 'depth') || final2Analysis.paragraphCount < (targetWords >= 1600 ? 9 : 8) || final2Analysis.avgParagraphWords < (targetWords >= 1600 ? 100 : 90) || final2Analysis.sectionWordCounts.insight < (targetWords >= 1600 ? 130 : 110) || final2Analysis.sectionWordCounts.evidence < (targetWords >= 1600 ? 95 : 80) || final2Analysis.sectionWordCounts.expansion < (targetWords >= 1600 ? 100 : 80) || final2Analysis.sectionWordCounts.implication < (targetWords >= 1600 ? 100 : 80);
    const weakGeo = final2Score.breakdown.geo < 16 || score.issues.some((i) => i.category === 'geo') || final2Analysis.filledCallouts < 2 || final2Analysis.filledQuotes < 1 || final2Analysis.filledSummaries < 1;
    const finalC = final2Score.breakdown.structure * 3 + final2Score.breakdown.depth * 3 + final2Score.breakdown.geo * 3 + final2Score.breakdown.seo;
    if (finalC > bestScore) { bestScore = finalC; best = parsed; }

    if (!weakStructure && !weakDepth2 && !weakGeo) {
      return buildSuccessResult(parsed, note);
    }

    retryReason = [
      weakStructure ? `structure too weak (${final2Score.breakdown.structure}/25)` : '',
      weakDepth2 ? `depth too weak (${final2Score.breakdown.depth}/20)` : '',
      weakGeo ? `GEO too weak (${final2Score.breakdown.geo}/20)` : '',
      final2Analysis.missingHeadings.length > 0 ? `missing sections: ${final2Analysis.missingHeadings.join(', ')}` : '',
      !final2Analysis.filledInsights ? 'key insights are not dense enough' : '',
      final2Analysis.paragraphCount < (targetWords >= 1600 ? 9 : 8) ? `not enough body paragraphs (${final2Analysis.paragraphCount})` : '',
      final2Analysis.avgParagraphWords < (targetWords >= 1600 ? 100 : 90) ? `average paragraph depth too light (${final2Analysis.avgParagraphWords} words)` : '',
      final2Analysis.sectionWordCounts.insight < (targetWords >= 1600 ? 130 : 110) ? `insight section still too thin (${final2Analysis.sectionWordCounts.insight} words)` : '',
      final2Analysis.sectionWordCounts.evidence < (targetWords >= 1600 ? 95 : 80) ? `evidence section still too thin (${final2Analysis.sectionWordCounts.evidence} words)` : '',
      final2Analysis.sectionWordCounts.expansion < (targetWords >= 1600 ? 100 : 80) ? `expansion section still too thin (${final2Analysis.sectionWordCounts.expansion} words)` : '',
      final2Analysis.sectionWordCounts.implication < (targetWords >= 1600 ? 100 : 80) ? `implication section still too thin (${final2Analysis.sectionWordCounts.implication} words)` : '',
      final2Analysis.filledCallouts < 2 ? 'both callouts are not working yet' : '',
      final2Analysis.filledQuotes < 1 ? 'quote block is still weak' : '',
      final2Analysis.filledSummaries < 1 ? 'summary is still too thin' : '',
    ].filter(Boolean).join('; ');
  }

  if (best) return buildFallbackResult(best, note);
  throw new Error('Failed to generate Minimal Thesis newsletter');
}
