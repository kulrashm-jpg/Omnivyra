/** Part of runWeeklyRadarGeneration (Agent-B split — main module keeps the original path). */
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


import { parseWeeklyRadarOutput, normalizeParagraphHtml, stripHtml, countWords, getTargetWords, normalizeSignals } from './runWeeklyRadarGenerationHelpers';

export function ensureWeeklyRadarExtractables(result: ReturnType<typeof parseWeeklyRadarOutput>) {
  if (!result) return result;
  const flat = flattenBlocks(result.content_blocks);
  const paragraphs = flat.filter((block): block is ParagraphBlock => block.type === 'paragraph');
  const summary = flat.find((block): block is SummaryBlock => block.type === 'summary');
  const quote = flat.find((block): block is QuoteBlock => block.type === 'quote');
  const callout = flat.find((block): block is CalloutBlock => block.type === 'callout');
  const fallback = summary?.body?.trim() || stripHtml(paragraphs[0]?.html || '') || result.title;
  const fallbackQuote = stripHtml(paragraphs[1]?.html || paragraphs[0]?.html || '').slice(0, 180).trim() || fallback;
  result.content_blocks = result.content_blocks.map((block) => {
    if (block.type === 'callout') {
      const currentWords = countWords(`${block.title} ${block.body}`);
      if (currentWords >= 12) return block;
      return {
        ...block,
        body: `The defining signal this week: ${fallbackQuote}`,
      } as CalloutBlock;
    }
    if (block.type === 'quote') {
      const currentWords = countWords(`${block.text} ${block.author} ${block.source}`);
      if (currentWords >= 12) return block;
      return {
        ...block,
        text: fallbackQuote || callout?.body || quote?.text || result.title,
        author: block.author || 'Omnivyra Editorial Desk',
        source: block.source || 'Signal radar note',
      } as QuoteBlock;
    }
    return block;
  });
  if (!result.excerpt || result.excerpt.trim().length < 70) {
    result.excerpt = fallback.slice(0, 155).trim();
  }
  if (result.title.trim().length > 0 && result.title.trim().length < 20) {
    result.title = `${result.title.trim()}: Signal Radar`;
  }
  if (!result.seo_meta_title || !result.seo_meta_title.trim()) {
    result.seo_meta_title = result.title.trim();
  }
  if (!result.seo_meta_description || result.seo_meta_description.trim().length < 70) {
    result.seo_meta_description = fallback.slice(0, 155).trim();
  }
  return result;
}

export function analyzeWeeklyRadarDraft(blocks: ContentBlock[]) {
  const flat = flattenBlocks(blocks);
  const paragraphs = flat.filter((block): block is ParagraphBlock => block.type === 'paragraph');
  const references = flat.filter((block): block is ReferencesBlock => block.type === 'references');
  const summaries = flat.filter((block): block is SummaryBlock => block.type === 'summary');
  const insights = flat.filter((block): block is KeyInsightsBlock => block.type === 'key_insights');
  const lists = flat.filter((block): block is ListBlock => block.type === 'list');
  const columns = flat.filter((block): block is ColumnsBlock => block.type === 'columns');
  const quotes = flat.filter((block): block is QuoteBlock => block.type === 'quote');
  const callouts = flat.filter((block): block is CalloutBlock => block.type === 'callout');

  const paragraphWordCounts = paragraphs.map((block) => block.html.replace(/<[^>]+>/g, ' ').trim().split(/\s+/).filter(Boolean).length);
  const avgParagraphWords = paragraphWordCounts.length
    ? Math.round(paragraphWordCounts.reduce((sum, count) => sum + count, 0) / paragraphWordCounts.length)
    : 0;
  const filledReferences = references.reduce((sum, block) => sum + block.items.filter((item) => item.title.trim() || item.url.trim()).length, 0);
  const filledQuickTakes = lists.reduce((sum, block) => sum + block.items.filter((item) => item.text.trim().length >= 12).length, 0);
  const filledQuotes = quotes.filter((block) => countWords(`${block.text} ${block.author} ${block.source}`) >= 12).length;
  const filledCallouts = callouts.filter((block) => countWords(`${block.title} ${block.body}`) >= 12).length;
  const strongSignals = columns.filter((columnBlock) =>
    columnBlock.columns.every((column) =>
      column.blocks.some((inner) => inner.type === 'paragraph' && inner.html.replace(/<[^>]+>/g, ' ').trim().split(/\s+/).filter(Boolean).length >= 40),
    ),
  ).length;

  return {
    avgParagraphWords,
    filledReferences,
    filledQuickTakes,
    filledQuotes,
    filledCallouts,
    strongSignals,
    summaryOk: summaries.some((block) => block.body.trim().split(/\s+/).filter(Boolean).length >= 24),
    insightsOk: insights.some((block) => block.items.filter((item) => item.trim().length >= 18).length >= 3),
  };
}

export function buildWeeklyRadarDepthRepairPrompt(
  input: NewsletterGenerationRequest,
  targetWords: number,
  signalCount: number,
  retryReason: string,
): string {
  return `TOPIC: ${input.topic}

REPAIR GOAL:
The weekly brief has the right structure, but the body is still too thin. Deepen the editorial writing only.

WHY THE DRAFT FAILED:
${retryReason}

RETURN JSON WITH EXACTLY THESE FIELDS:
{
  "quote_text": "string",
  "quote_author": "string",
  "quote_source": "string",
  "week_summary_html": "string with <p> tags",
  "signals": [
    {
      "what_happened_heading": "string",
      "what_happened_html": "string with <p> tags",
      "why_it_matters_heading": "string",
      "why_it_matters_html": "string with <p> tags"
    }
  ],
  "pattern_html": "string with <p> tags",
  "quick_takes": ["string"],
  "closing_html": "string with <p> tags",
  "summary_body": "string"
}

RULES:
- signals must contain exactly ${signalCount} items
- every what_happened_html must be at least ${targetWords >= 1600 ? '85' : targetWords >= 1200 ? '70' : '55'} words
- every why_it_matters_html must be at least ${targetWords >= 1600 ? '105' : targetWords >= 1200 ? '85' : '65'} words
- pattern_html must add interpretation, not recap
- week_summary_html and closing_html must be substantive multi-paragraph writing
- quote_text must be a quotable weekly insight line of at least 12 words
- quick_takes should be concise but sharp
- summary_body must be a real 2-3 sentence synthesis`;
}

export function buildWeeklyRadarFocusedBodyPrompt(
  input: NewsletterGenerationRequest,
  targetWords: number,
  signalCount: number,
  retryReason: string,
): string {
  return `TOPIC: ${input.topic}

FOCUSED DEEPENING GOAL:
The signal radar still needs more depth. Rewrite only the long-form body so each signal feels more interpreted, more useful, and more substantial.

WHY THE DRAFT WAS REJECTED:
${retryReason}

RETURN JSON WITH EXACTLY THESE FIELDS:
{
  "quote_text": "string",
  "quote_author": "string",
  "quote_source": "string",
  "week_summary_html": "string with <p> tags",
  "signals": [
    {
      "what_happened_heading": "string",
      "what_happened_html": "string with <p> tags",
      "why_it_matters_heading": "string",
      "why_it_matters_html": "string with <p> tags"
    }
  ],
  "pattern_html": "string with <p> tags",
  "quick_takes": ["string"],
  "closing_html": "string with <p> tags",
  "summary_body": "string"
}

STRICT RULES:
- signals must contain exactly ${signalCount} items
- every what_happened_html must be at least ${targetWords >= 1600 ? '100' : targetWords >= 1200 ? '80' : '60'} words
- every why_it_matters_html must be at least ${targetWords >= 1600 ? '130' : targetWords >= 1200 ? '105' : '80'} words
- week_summary_html must be at least ${targetWords >= 1600 ? '130' : targetWords >= 1200 ? '105' : '80'} words
- pattern_html must be at least ${targetWords >= 1600 ? '135' : targetWords >= 1200 ? '110' : '85'} words
- closing_html must be at least ${targetWords >= 1600 ? '80' : targetWords >= 1200 ? '65' : '45'} words
- why_it_matters_html must do real interpretation, not recap
- quote_text must be at least 14 words
- quick_takes should be sharp one-line conclusions, not labels
- summary_body must be a concrete 2-3 sentence synthesis
- return only valid JSON`;
}

export function applyWeeklyRadarDepthRepair(blocks: ContentBlock[], raw: any, signalCount: number): ContentBlock[] {
  const signals = normalizeSignals(raw?.signals, signalCount);
  let signalIndex = 0;
  let paragraphIndex = 0;
  const paragraphTargets = [raw?.week_summary_html, raw?.pattern_html, raw?.closing_html];

  return blocks.map((block) => {
    if (block.type === 'paragraph') {
      const next = paragraphTargets[paragraphIndex++];
      return {
        ...block,
        html: typeof next === 'string' && next.trim() ? normalizeParagraphHtml(next) : block.html,
      } as ParagraphBlock;
    }
    if (block.type === 'quote') {
      return {
        ...block,
        text: typeof raw?.quote_text === 'string' && raw.quote_text.trim() ? raw.quote_text.trim() : block.text,
        author: typeof raw?.quote_author === 'string' && raw.quote_author.trim() ? raw.quote_author.trim() : block.author,
        source: typeof raw?.quote_source === 'string' && raw.quote_source.trim() ? raw.quote_source.trim() : block.source,
      } as QuoteBlock;
    }
    if (block.type === 'columns') {
      const signal = signals[signalIndex++] || null;
      return {
        ...block,
        columns: block.columns.map((column, columnIdx) => ({
          ...column,
          blocks: column.blocks.map((inner) => {
            if (inner.type === 'heading') {
              const text = columnIdx === 0 ? signal?.what_happened_heading : signal?.why_it_matters_heading;
              return { ...inner, text: typeof text === 'string' && text.trim() ? text.trim() : inner.text };
            }
            if (inner.type === 'paragraph') {
              const html = columnIdx === 0 ? signal?.what_happened_html : signal?.why_it_matters_html;
              return {
                ...inner,
                html: typeof html === 'string' && html.trim() ? normalizeParagraphHtml(html) : inner.html,
              } as ParagraphBlock;
            }
            return inner;
          }),
        })),
      } as ColumnsBlock;
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

