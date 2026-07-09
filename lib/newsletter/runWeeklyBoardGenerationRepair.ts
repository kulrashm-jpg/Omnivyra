/** Part of runWeeklyBoardGeneration (Agent-B split — main module keeps the original path). */
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

import { parseAnalystBoardOutput, normalizeParagraphHtml, getTargetWords, normalizeSignals } from './runWeeklyBoardGenerationPrompts';

export function ensureAnalystBoardExtractables(result: ReturnType<typeof parseAnalystBoardOutput>) {
  if (!result) return result;
  const flat = flattenBlocks(result.content_blocks);
  const paragraphs = flat.filter((block): block is ParagraphBlock => block.type === 'paragraph');
  const summary = flat.find((block): block is SummaryBlock => block.type === 'summary');
  const quote = flat.find((block): block is QuoteBlock => block.type === 'quote');
  const fallbackLead = stripHtml(paragraphs[0]?.html || paragraphs[1]?.html || '').slice(0, 220).trim();
  const fallbackWatch = summary?.body?.trim() || stripHtml(paragraphs[paragraphs.length - 1]?.html || '').slice(0, 220).trim();
  let calloutIndex = 0;

  result.content_blocks = result.content_blocks.map((block) => {
    if (block.type !== 'callout') return block;
    const currentWords = countWords(`${block.title} ${block.body}`);
    const fallback = calloutIndex === 0 ? fallbackLead : fallbackWatch;
    calloutIndex += 1;
    if (currentWords >= 10) return block;
    return {
      ...block,
      body: calloutIndex === 1
        ? `Lead signal to watch this week: ${fallback}`
        : `What strong teams should watch next: ${fallback}`,
    } as CalloutBlock;
  });

  result.content_blocks = result.content_blocks.map((block) => {
    if (block.type !== 'quote') return block;
    const currentWords = countWords(`${block.text} ${block.author} ${block.source}`);
    if (currentWords >= 12) return block;
    const fallbackQuote = fallbackLead || fallbackWatch || quote?.text || result.title;
    return {
      ...block,
      text: fallbackQuote,
      author: block.author || 'Omnivyra Analyst Desk',
      source: block.source || 'Weekly board note',
    } as QuoteBlock;
  });

  const ensurePreviewLength = (value: string, fallback: string) => {
    const trimmed = value.trim();
    if (trimmed.length >= 70) return trimmed.slice(0, 155).trim();
    const stitched = [trimmed, fallback.trim(), result.title.trim()]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    return stitched.slice(0, 155).trim();
  };

  if (!result.excerpt || result.excerpt.trim().length < 70) {
    const excerptSource = summary?.body?.trim() || fallbackLead || result.title;
    result.excerpt = ensurePreviewLength(excerptSource, fallbackWatch || fallbackLead || result.title);
  }
  if (result.title.trim().length > 0 && result.title.trim().length < 20) {
    result.title = `${result.title.trim()}: Analyst Board`;
  }
  if (!result.seo_meta_title || !result.seo_meta_title.trim()) {
    result.seo_meta_title = result.title.trim();
  }
  if (!result.seo_meta_description || result.seo_meta_description.trim().length < 70) {
    const descSource = summary?.body?.trim() || fallbackWatch || result.excerpt;
    result.seo_meta_description = ensurePreviewLength(descSource, fallbackLead || result.excerpt || result.title);
  }

  return result;
}

export function countWords(text: string): number {
  const normalized = text.trim();
  return normalized ? normalized.split(/\s+/).filter(Boolean).length : 0;
}

export function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function analyzeAnalystBoardDraft(blocks: ContentBlock[]) {
  const flat = flattenBlocks(blocks);
  const paragraphs = flat.filter((block): block is ParagraphBlock => block.type === 'paragraph');
  const callouts = flat.filter((block): block is CalloutBlock => block.type === 'callout');
  const quotes = flat.filter((block): block is QuoteBlock => block.type === 'quote');
  const references = flat.filter((block): block is ReferencesBlock => block.type === 'references');
  const summaries = flat.filter((block): block is SummaryBlock => block.type === 'summary');
  const insights = flat.filter((block): block is KeyInsightsBlock => block.type === 'key_insights');
  const lists = flat.filter((block): block is ListBlock => block.type === 'list');

  const paragraphWordCounts = paragraphs.map((block) => countWords(stripHtml(block.html))).filter(Boolean);
  const avgParagraphWords = paragraphWordCounts.length
    ? Math.round(paragraphWordCounts.reduce((sum, count) => sum + count, 0) / paragraphWordCounts.length)
    : 0;
  const filledReferences = references.reduce((sum, block) => sum + block.items.filter((item) => item.title.trim() || item.url.trim()).length, 0);
  const filledCallouts = callouts.filter((block) => countWords(`${block.title} ${block.body}`) >= 10).length;
  const filledQuotes = quotes.filter((block) => countWords(`${block.text} ${block.author} ${block.source}`) >= 12).length;
  const summaryOk = summaries.some((block) => countWords(block.body) >= 24);
  const insightsOk = insights.some((block) => block.items.filter((item) => item.trim().length >= 18).length >= 3);
  const quickTakesOk = lists.some((block) => block.items.filter((item) => item.text.trim().length >= 18).length >= 4);
  const strongSignals = paragraphWordCounts.slice(1, Math.max(1, paragraphWordCounts.length - 2)).filter((count) => count >= 90).length;

  return {
    avgParagraphWords,
    filledReferences,
    filledCallouts,
    filledQuotes,
    summaryOk,
    insightsOk,
    quickTakesOk,
    strongSignals,
  };
}

export function getAnalystBoardComposite(
  blocks: ContentBlock[],
  parsed: NonNullable<ReturnType<typeof parseAnalystBoardOutput>>,
  targetWords: number,
  signalCount: number,
) {
  const score = calculateNewsletterQualityScore(blocks, {
    title: parsed.title,
    excerpt: parsed.excerpt,
    seo_meta_title: parsed.seo_meta_title,
    seo_meta_description: parsed.seo_meta_description,
    tags: parsed.tags,
    target_word_count: targetWords,
    content_type: 'newsletter',
    format_type: 'weekly-brief',
  });
  const analysis = analyzeAnalystBoardDraft(blocks);
  const composite = score.breakdown.depth * 5
    + score.breakdown.seo * 2
    + analysis.avgParagraphWords * 2
    + analysis.strongSignals * 40
    + analysis.filledReferences * 8
    + Math.min(score.meta.wordCount, targetWords)
    + (analysis.quickTakesOk ? 30 : 0);
  return { score, analysis, composite, signalCount };
}

export function buildAnalystBoardDepthRepairPrompt(
  input: NewsletterGenerationRequest,
  targetWords: number,
  signalCount: number,
  retryReason: string,
): string {
  return `TOPIC: ${input.topic}

REPAIR GOAL:
The analyst board is structurally present, but it is still too thin. Deepen only the editorial body and extraction surfaces.

WHY THE DRAFT FAILED:
${retryReason}

RETURN JSON WITH EXACTLY THESE FIELDS:
{
  "lead_signal_callout": "string",
  "watch_next_callout": "string",
  "quote_text": "string",
  "quote_author": "string",
  "quote_source": "string",
  "week_summary_html": "string with <p> tags",
  "signals": [
    {
      "heading": "string",
      "body_html": "string with <p> tags"
    }
  ],
  "pattern_html": "string with <p> tags",
  "quick_takes": ["string"],
  "closing_html": "string with <p> tags",
  "summary_body": "string"
}

RULES:
- signals must contain exactly ${signalCount} items
- week_summary_html must be 2 meaningful paragraphs
- each signal body must be deeper, more analytical, and at least ${targetWords >= 1600 ? '140' : targetWords >= 1200 ? '115' : '90'} words
- pattern_html must explain the emerging pattern with judgment, not recap
- both callouts must be sharp, substantive, and at least 14 words
- quote_text must be a strong analyst line of at least 12 words
- quick_takes must be dense and specific
- summary_body must be a real 2-3 sentence synthesis`;
}

export function buildAnalystBoardFocusedBodyPrompt(
  input: NewsletterGenerationRequest,
  targetWords: number,
  signalCount: number,
  retryReason: string,
): string {
  return `TOPIC: ${input.topic}

FOCUSED DEEPENING GOAL:
The analyst board still reads too thin for the target length. Rewrite only the long-form body so it feels like a real analyst note with stronger interpretation and clearer decision value.

WHY THE DRAFT WAS REJECTED:
${retryReason}

RETURN JSON WITH EXACTLY THESE FIELDS:
{
  "lead_signal_callout": "string",
  "watch_next_callout": "string",
  "quote_text": "string",
  "quote_author": "string",
  "quote_source": "string",
  "week_summary_html": "string with <p> tags",
  "signals": [
    {
      "heading": "string",
      "body_html": "string with <p> tags"
    }
  ],
  "pattern_html": "string with <p> tags",
  "quick_takes": ["string"],
  "closing_html": "string with <p> tags",
  "summary_body": "string"
}

STRICT RULES:
- signals must contain exactly ${signalCount} items
- week_summary_html should be at least ${targetWords >= 1600 ? '180' : targetWords >= 1200 ? '120' : '90'} words
- each signal body must be at least ${targetWords >= 1600 ? '205' : targetWords >= 1200 ? '140' : '100'} words and explain the signal, what it means, and what a strong team does with it
- pattern_html should be at least ${targetWords >= 1600 ? '180' : targetWords >= 1200 ? '120' : '90'} words with interpretation and second-order implications
- closing_html should be at least ${targetWords >= 1600 ? '105' : targetWords >= 1200 ? '75' : '55'} words
- both callouts must be at least 16 words and materially different
- quote_text must be at least 14 words
- quick_takes should be dense one-line conclusions, not labels
- summary_body must be a concrete 2-3 sentence synthesis
- return only valid JSON`;
}

export function buildAnalystBoardExpansionPrompt(
  input: NewsletterGenerationRequest,
  targetWords: number,
  signalCount: number,
  retryReason: string,
): string {
  return `TOPIC: ${input.topic}

EXPANSION GOAL:
The analyst board is materially below target length. Expand only the long-form body so it feels like a real analyst desk note with fuller signal interpretation and clearer decision value.

WHY THE DRAFT WAS REJECTED:
${retryReason}

RETURN JSON WITH EXACTLY THESE FIELDS:
{
  "lead_signal_callout": "string",
  "watch_next_callout": "string",
  "quote_text": "string",
  "quote_author": "string",
  "quote_source": "string",
  "week_summary_html": "string with <p> tags",
  "signals": [
    {
      "heading": "string",
      "body_html": "string with <p> tags"
    }
  ],
  "pattern_html": "string with <p> tags",
  "quick_takes": ["string"],
  "closing_html": "string with <p> tags",
  "summary_body": "string"
}

STRICT RULES:
- signals must contain exactly ${signalCount} items
- week_summary_html should be at least ${targetWords >= 1600 ? '200' : '140'} words
- each signal body should be at least ${targetWords >= 1600 ? '220' : '160'} words and include the signal, interpretation, why now, and what strong teams should do
- pattern_html should be at least ${targetWords >= 1600 ? '190' : '140'} words
- closing_html should be at least ${targetWords >= 1600 ? '110' : '75'} words
- both callouts must be at least 16 words
- quote_text must be at least 14 words
- quick_takes must be sharp decision lines, not labels
- summary_body must be a strong 2-3 sentence synthesis
- return only valid JSON`;
}

export function applyAnalystBoardDepthRepair(blocks: ContentBlock[], raw: any, signalCount: number): ContentBlock[] {
  const signals = normalizeSignals(raw?.signals, signalCount);
  let calloutIndex = 0;
  let signalHeadingIndex = 0;
  let signalBodyIndex = 0;
  const staticParagraphFields = [raw?.week_summary_html, raw?.pattern_html, raw?.closing_html];
  let staticParagraphIndex = 0;

  return blocks.map((block) => {
    if (block.type === 'callout') {
      const body = calloutIndex === 0 ? raw?.lead_signal_callout : raw?.watch_next_callout;
      calloutIndex += 1;
      return { ...block, body: typeof body === 'string' && body.trim() ? body.trim() : block.body } as CalloutBlock;
    }
    if (block.type === 'quote') {
      return {
        ...block,
        text: typeof raw?.quote_text === 'string' && raw.quote_text.trim() ? raw.quote_text.trim() : block.text,
        author: typeof raw?.quote_author === 'string' && raw.quote_author.trim() ? raw.quote_author.trim() : block.author,
        source: typeof raw?.quote_source === 'string' && raw.quote_source.trim() ? raw.quote_source.trim() : block.source,
      } as QuoteBlock;
    }
    if (block.type === 'paragraph') {
      let nextValue: unknown;
      if (staticParagraphIndex === 0) nextValue = staticParagraphFields[staticParagraphIndex++];
      else if (signalBodyIndex < signalCount) nextValue = signals[signalBodyIndex++].body_html;
      else nextValue = staticParagraphFields[staticParagraphIndex++];
      return {
        ...block,
        html: typeof nextValue === 'string' && nextValue.trim() ? normalizeParagraphHtml(nextValue) : block.html,
      } as ParagraphBlock;
    }
    if (block.type === 'heading' && block.level === 3) {
      const heading = signals[signalHeadingIndex++]?.heading;
      return { ...block, text: typeof heading === 'string' && heading.trim() ? heading.trim() : block.text };
    }
    if (block.type === 'list' && Array.isArray(raw?.quick_takes)) {
      return {
        ...block,
        items: raw.quick_takes.map((item: unknown, index: number) => ({
          id: block.items[index]?.id ?? `qt-${index}`,
          text: String(item ?? '').trim(),
        })),
      } as ListBlock;
    }
    if (block.type === 'summary' && typeof raw?.summary_body === 'string' && raw.summary_body.trim()) {
      return { ...block, body: raw.summary_body.trim() } as SummaryBlock;
    }
    return block;
  });
}

