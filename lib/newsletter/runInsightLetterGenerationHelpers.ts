/** Part of runInsightLetterGeneration (Agent-B split — main module keeps the original path). */
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


export function getTemplate(input: NewsletterGenerationRequest): ContentBlock[] {
  return resolveTemplate(input, 'minimal thesis', resolveTargetWords(input));
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

export function buildPrompt(input: NewsletterGenerationRequest, targetWords: number, retryReason?: string): string {
  const header = buildContextHeader(input, targetWords, retryReason);
  const deeperTier = targetWords >= 1600;

  return `${header}

YOUR TASK:
Write a high-quality "Minimal Thesis" Insight Letter. Generate a structured JSON object with named fields, not a generic block list.

HARD RULES:
- This must feel like original thinking, not a recap.
- Keep the visible sequence: Hook, Context, Insight, Expansion, Implication, Closing.
- Make structure obvious, depth real, and GEO extraction strong.
- Use HTML strings with <p> tags for all *_html fields.
- Every major section should feel complete on its own.
- Use at least one grounded example, observed pattern, or realistic scenario.
- Fill both callouts, the quote, the key insights, and the summary with distinct extractable value.
- Do not write neat but shallow sections. The body must feel argued, not summarized.
- Do not use markdown fences.

SECTION REQUIREMENTS:
- hook_html: 2 short paragraphs with tension, a challenged assumption, and a reason to keep reading.
- context_html: explain why this matters now with concrete stakes and a recognizable scenario.
- insight_html: explain the real mechanism with a reusable lens or mental model. Use ${deeperTier ? 'at least 2 paragraphs and about 140-220 words' : 'at least 2 paragraphs and about 120-180 words'}.
- evidence_html: give one grounded example, observed pattern, or realistic scenario that proves the thesis. Use ${deeperTier ? 'about 110-180 words' : 'about 90-150 words'}.
- expansion_html: add the deeper layer, second-order effect, or hidden dynamic. Use ${deeperTier ? 'about 120-180 words' : 'about 90-140 words'}.
- implication_html: explain the practical decision shift or operating consequence for the reader. Use ${deeperTier ? 'about 120-180 words' : 'about 90-140 words'} and include a clear operating takeaway.
- closing_html: end with a memorable line worth forwarding.
- thesis_callout: one-sentence high-conviction thesis.
- practical_shift_callout: one-sentence operating change or decision lens.
- quote_text: one sharp quote-worthy line capturing the thesis.
- key_insights: ${deeperTier ? '5-6' : '4-5'} dense standalone takeaways.
- summary_body: 2-3 sentence standalone synthesis suitable for inbox previews and AI answers.

RETURN JSON WITH EXACTLY THESE FIELDS:
{
  "title": "string",
  "excerpt": "string",
  "seo_meta_title": "string",
  "seo_meta_description": "string",
  "tags": ["string"],
  "thesis_callout": "string",
  "practical_shift_callout": "string",
  "quote_text": "string",
  "quote_author": "string",
  "quote_source": "string",
  "key_insights": ["string"],
  "hook_html": "string with <p> tags",
  "context_html": "string with <p> tags",
  "insight_html": "string with <p> tags",
  "evidence_html": "string with <p> tags",
  "expansion_html": "string with <p> tags",
  "implication_html": "string with <p> tags",
  "closing_html": "string with <p> tags",
  "summary_body": "string"
}`;
}

// ---------------------------------------------------------------------------
// Repair / expansion prompts
// ---------------------------------------------------------------------------

export function buildDepthRepairPrompt(
  input: NewsletterGenerationRequest,
  targetWords: number,
  state: ReturnType<typeof extractState>,
  retryReason: string,
): string {
  const deeperTier = targetWords >= 1600;
  return `TOPIC: ${input.topic}

REPAIR GOAL:
The structure and extraction surfaces are acceptable, but the BODY DEPTH is still too weak.
You must deepen the body sections while preserving the thesis, key insights, quote, callouts, and overall sequence.

CURRENT THESIS CALLOUT:
${state.thesis_callout}

CURRENT PRACTICAL-SHIFT CALLOUT:
${state.practical_shift_callout}

CURRENT QUOTE:
${state.quote_text}

CURRENT KEY INSIGHTS:
${state.key_insights.join('\n- ')}

CURRENT SUMMARY:
${state.summary_body}

WHY THE DRAFT WAS REJECTED:
${retryReason}

DEPTH RULES:
- Keep the same visible sequence: Hook, Context, Insight, Expansion, Implication, Closing.
- Do not rewrite the thesis into something different.
- Make the body feel argued, not summarized.
- Add mechanism, example, second-order effect, and practical implication.
- Use HTML strings with <p> tags only.
- Make each section denser and more complete.

SECTION TARGETS:
- hook_html: strengthen tension and sharpen the challenged assumption. About ${deeperTier ? '70-110' : '60-90'} words.
- context_html: explain why this matters now with concrete stakes. About ${deeperTier ? '90-140' : '70-110'} words.
- insight_html: the deepest reasoning section. Use at least 2 paragraphs and about ${deeperTier ? '170-260' : '140-220'} words.
- evidence_html: one grounded example, observed pattern, or realistic scenario. About ${deeperTier ? '130-190' : '100-150'} words.
- expansion_html: deepen the hidden dynamic or second-order effect. About ${deeperTier ? '140-200' : '110-160'} words.
- implication_html: explain the practical decision shift clearly. About ${deeperTier ? '140-200' : '110-160'} words.
- closing_html: end with a memorable line, but keep it earned. About ${deeperTier ? '45-80' : '35-60'} words.

RETURN JSON WITH EXACTLY THESE FIELDS:
{
  "hook_html": "string with <p> tags",
  "context_html": "string with <p> tags",
  "insight_html": "string with <p> tags",
  "evidence_html": "string with <p> tags",
  "expansion_html": "string with <p> tags",
  "implication_html": "string with <p> tags",
  "closing_html": "string with <p> tags"
}`;
}

export function buildExpansionPrompt(
  input: NewsletterGenerationRequest,
  targetWords: number,
  state: ReturnType<typeof extractState>,
  retryReason: string,
): string {
  const deeperTier = targetWords >= 1600;
  return `TOPIC: ${input.topic}

EXPANSION GOAL:
The insight letter is materially below target length. Expand only the long-form body so the draft gets much closer to the target word count while keeping the thesis, extractable callouts, quote, and section sequence intact.

CURRENT THESIS CALLOUT:
${state.thesis_callout}

CURRENT PRACTICAL-SHIFT CALLOUT:
${state.practical_shift_callout}

CURRENT QUOTE:
${state.quote_text}

CURRENT KEY INSIGHTS:
${state.key_insights.join('\n- ')}

CURRENT SUMMARY:
${state.summary_body}

WHY THE DRAFT WAS REJECTED:
${retryReason}

EXPANSION RULES:
- Keep the same visible sequence: Hook, Context, Insight, Expansion, Implication, Closing.
- Do not change the thesis.
- Add real substance, not filler.
- Add mechanism, scenario detail, second-order effects, and a stronger operating implication.
- Use HTML strings with <p> tags only.
- Make every major section feel complete and forwardable.

SECTION TARGETS:
- hook_html: about ${deeperTier ? '95-140' : '80-120'} words
- context_html: about ${deeperTier ? '120-170' : '100-145'} words
- insight_html: at least 2 paragraphs and about ${deeperTier ? '210-320' : '180-260'} words
- evidence_html: one grounded example or realistic scenario, about ${deeperTier ? '160-230' : '130-190'} words
- expansion_html: hidden dynamic or second-order effect, about ${deeperTier ? '170-240' : '140-200'} words
- implication_html: practical decision shift, about ${deeperTier ? '170-240' : '140-200'} words
- closing_html: about ${deeperTier ? '55-90' : '45-75'} words

RETURN JSON WITH EXACTLY THESE FIELDS:
{
  "hook_html": "string with <p> tags",
  "context_html": "string with <p> tags",
  "insight_html": "string with <p> tags",
  "evidence_html": "string with <p> tags",
  "expansion_html": "string with <p> tags",
  "implication_html": "string with <p> tags",
  "closing_html": "string with <p> tags"
}`;
}

// ---------------------------------------------------------------------------
// Output parsing
// ---------------------------------------------------------------------------

export const PARAGRAPH_FIELDS = [
  'hook_html', 'context_html', 'insight_html', 'evidence_html',
  'expansion_html', 'implication_html', 'closing_html',
] as const;

export function parseParagraphHtmlFromObject(aiData: any): string {
  const rawText =
    typeof aiData?.html === 'string' ? aiData.html :
    typeof aiData?.text === 'string' ? aiData.text :
    typeof aiData?.body === 'string' ? aiData.body :
    typeof aiData?.content === 'string' ? aiData.content :
    typeof aiData?.value === 'string' ? aiData.value :
    '';
  return normalizeParagraphHtml(rawText);
}

export function parseOutput(raw: any, template: ContentBlock[]) {
  if (!raw || typeof raw !== 'object') return null;
  let calloutIndex = 0;
  let paragraphIndex = 0;

  const contentBlocks = template.map((block) => {
    switch (block.type) {
      case 'key_insights':
        return mergeKeyInsights(block as KeyInsightsBlock, raw.key_insights);
      case 'callout': {
        const body = calloutIndex === 0 ? raw.thesis_callout : raw.practical_shift_callout;
        calloutIndex += 1;
        return { ...block, title: '', body: typeof body === 'string' ? body.trim() : '' } as CalloutBlock;
      }
      case 'quote':
        return mergeQuote(block as QuoteBlock, raw);
      case 'summary':
        return mergeSummary(block as SummaryBlock, raw.summary_body);
      case 'paragraph': {
        const fieldName = PARAGRAPH_FIELDS[paragraphIndex];
        paragraphIndex += 1;
        return {
          ...block,
          html: parseParagraphHtmlFromObject({ html: typeof fieldName === 'string' ? raw[fieldName] : '' }),
        } as ParagraphBlock;
      }
      default:
        return block;
    }
  });

  return buildParsedResult(raw, contentBlocks);
}

// ---------------------------------------------------------------------------
// Extractables enforcement
// ---------------------------------------------------------------------------

export function ensureExtractables(result: ReturnType<typeof parseOutput>) {
  if (!result) return result;
  const flat = flattenBlocks(result.content_blocks);
  const paragraphs = flat.filter((b): b is ParagraphBlock => b.type === 'paragraph');
  const callouts = flat.filter((b): b is CalloutBlock => b.type === 'callout');
  const quotes = flat.filter((b): b is QuoteBlock => b.type === 'quote');
  const summaries = flat.filter((b): b is SummaryBlock => b.type === 'summary');
  const summary = summaries[0];
  const fallbackQuote = stripHtml(paragraphs[2]?.html || paragraphs[4]?.html || paragraphs[5]?.html || paragraphs[0]?.html || '').slice(0, 180).trim();
  const fallbackSummary = summary?.body?.trim() || stripHtml(paragraphs[5]?.html || paragraphs[6]?.html || '').slice(0, 220).trim();
  let calloutIndex = 0;

  result.content_blocks = result.content_blocks.map((block) => {
    if (block.type === 'callout') {
      const currentWords = countWords(`${(block as CalloutBlock).title} ${(block as CalloutBlock).body}`);
      if (currentWords >= 12) { calloutIndex += 1; return block; }
      const fallback = calloutIndex === 0
        ? `Core thesis: ${fallbackQuote || fallbackSummary || result.title}`
        : `Practical shift: ${fallbackSummary || fallbackQuote || result.title}`;
      calloutIndex += 1;
      return { ...block, body: fallback } as CalloutBlock;
    }
    if (block.type === 'quote') {
      if (countWords(`${(block as QuoteBlock).text} ${(block as QuoteBlock).author} ${(block as QuoteBlock).source}`) >= 12) return block;
      return { ...block, text: fallbackQuote || fallbackSummary || result.title, author: (block as QuoteBlock).author || 'Omnivyra', source: (block as QuoteBlock).source || 'Insight letter' } as QuoteBlock;
    }
    if (block.type === 'summary') {
      if (countWords((block as SummaryBlock).body) >= 28) return block;
      return { ...block, body: fallbackSummary || fallbackQuote || result.title } as SummaryBlock;
    }
    return block;
  });

  if (!result.excerpt || result.excerpt.trim().length < 70) {
    result.excerpt = (fallbackSummary || fallbackQuote || result.title).slice(0, 155).trim();
  }
  if (result.title.trim().length > 0 && result.title.trim().length < 20) {
    result.title = `${result.title.trim()}: Insight Letter`;
  }
  if (!result.seo_meta_title || !result.seo_meta_title.trim()) {
    result.seo_meta_title = result.title.trim();
  }
  if (!result.seo_meta_description || result.seo_meta_description.trim().length < 70) {
    result.seo_meta_description = (fallbackSummary || fallbackQuote || result.excerpt || result.title).slice(0, 155).trim();
  }
  return result;
}

// ---------------------------------------------------------------------------
// State extraction (for repair prompts)
// ---------------------------------------------------------------------------

export function extractState(blocks: ContentBlock[]) {
  const flat = flattenBlocks(blocks);
  const paragraphs = flat.filter((b): b is ParagraphBlock => b.type === 'paragraph');
  const callouts = flat.filter((b): b is CalloutBlock => b.type === 'callout');
  const quotes = flat.filter((b): b is QuoteBlock => b.type === 'quote');
  const summaries = flat.filter((b): b is SummaryBlock => b.type === 'summary');
  const keyInsights = flat.filter((b): b is KeyInsightsBlock => b.type === 'key_insights');
  return {
    thesis_callout: callouts[0]?.body ?? '',
    practical_shift_callout: callouts[1]?.body ?? '',
    quote_text: quotes[0]?.text ?? '',
    quote_author: quotes[0]?.author ?? '',
    quote_source: quotes[0]?.source ?? '',
    key_insights: keyInsights[0]?.items ?? [],
    hook_html: paragraphs[0]?.html ?? '',
    context_html: paragraphs[1]?.html ?? '',
    insight_html: paragraphs[2]?.html ?? '',
    evidence_html: paragraphs[3]?.html ?? '',
    expansion_html: paragraphs[4]?.html ?? '',
    implication_html: paragraphs[5]?.html ?? '',
    closing_html: paragraphs[6]?.html ?? '',
    summary_body: summaries[0]?.body ?? '',
  };
}

// ---------------------------------------------------------------------------
// Depth-repair block patch
// ---------------------------------------------------------------------------

export function applyDepthRepair(blocks: ContentBlock[], raw: any): ContentBlock[] {
  let paragraphIndex = 0;
  return blocks.map((block) => {
    if (block.type !== 'paragraph') return block;
    const fieldName = PARAGRAPH_FIELDS[paragraphIndex];
    paragraphIndex += 1;
    const nextHtml = typeof fieldName === 'string' ? raw?.[fieldName] : '';
    return {
      ...block,
      html: typeof nextHtml === 'string' && nextHtml.trim() ? normalizeParagraphHtml(nextHtml) : (block as ParagraphBlock).html,
    } as ParagraphBlock;
  });
}

// ---------------------------------------------------------------------------
// Draft analysis
// ---------------------------------------------------------------------------

export function analyzeDraft(blocks: ContentBlock[]) {
  const flat = flattenBlocks(blocks);
  const headings = flat
    .filter((b): b is HeadingBlock => b.type === 'heading')
    .map((b) => b.text.trim().toLowerCase())
    .filter(Boolean);
  const paragraphs = flat.filter((b): b is ParagraphBlock => b.type === 'paragraph');
  const keyInsights = flat.filter((b): b is KeyInsightsBlock => b.type === 'key_insights');
  const callouts = flat.filter((b): b is CalloutBlock => b.type === 'callout');
  const quotes = flat.filter((b): b is QuoteBlock => b.type === 'quote');
  const summaries = flat.filter((b): b is SummaryBlock => b.type === 'summary');
  const paragraphWordCounts = paragraphs.map((b) => countWords(stripHtml(b.html))).filter((c) => c > 0);
  const avgParagraphWords = paragraphWordCounts.length ? Math.round(paragraphWordCounts.reduce((s, c) => s + c, 0) / paragraphWordCounts.length) : 0;
  const required = ['hook', 'context', 'insight', 'expansion', 'implication', 'closing'];
  const missingHeadings = required.filter((l) => !headings.some((h) => h === l || h.includes(l)));
  return {
    missingHeadings,
    paragraphCount: paragraphWordCounts.length,
    avgParagraphWords,
    sectionWordCounts: {
      hook: paragraphWordCounts[0] ?? 0,
      context: paragraphWordCounts[1] ?? 0,
      insight: paragraphWordCounts[2] ?? 0,
      evidence: paragraphWordCounts[3] ?? 0,
      expansion: paragraphWordCounts[4] ?? 0,
      implication: paragraphWordCounts[5] ?? 0,
      closing: paragraphWordCounts[6] ?? 0,
    },
    filledInsights: keyInsights.some((b) => b.items.filter((i) => i.trim().length >= 18).length >= 3),
    filledCallouts: callouts.filter((b) => countWords(`${b.title ?? ''} ${b.body ?? ''}`) >= 10).length,
    filledQuotes: quotes.filter((b) => countWords(`${b.text ?? ''} ${b.author ?? ''} ${b.source ?? ''}`) >= 12).length,
    filledSummaries: summaries.filter((b) => countWords(b.body) >= 28).length,
  };
}

export function scoreBlocks(blocks: ContentBlock[], parsed: NonNullable<ReturnType<typeof parseOutput>>, targetWords: number) {
  return calculateNewsletterQualityScore(blocks, {
    title: parsed.title, excerpt: parsed.excerpt,
    seo_meta_title: parsed.seo_meta_title, seo_meta_description: parsed.seo_meta_description,
    tags: parsed.tags, target_word_count: targetWords,
    content_type: 'newsletter', format_type: 'insight-letter',
  });
}

export function compositeScore(score: ReturnType<typeof calculateNewsletterQualityScore>, analysis: ReturnType<typeof analyzeDraft>, targetWords: number) {
  return score.breakdown.depth * 5
    + score.breakdown.seo * 2
    + analysis.avgParagraphWords * 2
    + analysis.sectionWordCounts.insight
    + analysis.sectionWordCounts.evidence
    + analysis.sectionWordCounts.expansion
    + analysis.sectionWordCounts.implication
    + Math.min(score.meta.wordCount, targetWords);
}

// ---------------------------------------------------------------------------
// Exported entry point
// ---------------------------------------------------------------------------

