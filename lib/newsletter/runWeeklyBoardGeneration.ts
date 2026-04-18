import { runCompletionWithOperation } from '../../backend/services/aiGateway';
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

function getTargetWords(input: NewsletterGenerationRequest): number {
  const raw = input.answers?.target_word_count;
  return raw ? parseInt(String(raw), 10) || 1200 : 1200;
}

function getAnalystBoardTemplate(input: NewsletterGenerationRequest): ContentBlock[] {
  if (Array.isArray(input.template_blocks) && input.template_blocks.length > 0) {
    return input.template_blocks as ContentBlock[];
  }
  const template = getDefaultNewsletterTemplates().find((item) => item.name.toLowerCase() === 'analyst board');
  return template ? instantiateNewsletterTemplate(template, getTargetWords(input)) : [];
}

function normalizeParagraphHtml(value: unknown): string {
  const rawText = typeof value === 'string' ? value : '';
  const trimmed = rawText.trim();
  if (!trimmed) return '';
  if (/<p[\s>]/i.test(trimmed)) return trimmed;
  return trimmed
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => `<p>${part}</p>`)
    .join('');
}

function buildAnalystBoardPrompt(
  input: NewsletterGenerationRequest,
  targetWords: number,
  signalCount: number,
  retryReason?: string,
): string {
  const parts: string[] = [];
  parts.push(`TOPIC: ${input.topic}`);
  parts.push(`TARGET WORD COUNT: ${targetWords} words minimum`);
  if (input.selected_angle) {
    parts.push(`ANGLE TITLE: ${input.selected_angle.title}`);
    parts.push(`ANGLE SUMMARY: ${input.selected_angle.angle_summary}`);
  }
  if (input.answers?.uniqueness_directive) parts.push(`UNIQUENESS DIRECTIVE: ${input.answers.uniqueness_directive}`);
  if (input.answers?.must_include_points) parts.push(`MUST-INCLUDE POINTS: ${input.answers.must_include_points}`);
  if (input.answers?.trend_context) parts.push(`TREND CONTEXT: ${input.answers.trend_context}`);
  if (input.companyContext?.audience) parts.push(`AUDIENCE: ${input.companyContext.audience}`);
  if (input.companyContext?.brand_voice) parts.push(`BRAND VOICE: ${input.companyContext.brand_voice}`);
  if (retryReason) parts.push(`PREVIOUS DRAFT FAILED BECAUSE: ${retryReason}`);

  return `${parts.join('\n\n')}

YOUR TASK:
Write an "Analyst Board" weekly brief that feels like a real analyst desk note: curated, interpretive, and decision-useful.

HARD RULES:
- Do not produce placeholder bullets or ultra-short blurbs.
- Each signal must contain concrete description plus analytical interpretation.
- The pattern section must connect the signals into a board-level read.
- The callouts must be distinct: one for the lead signal, one for what strong teams should watch next.
- Make both callouts quote-worthy and at least 14 words each.
- Add one quotable analyst line that captures the week in a way a leader could forward.
- Use HTML strings with <p> tags for all *_html fields.
- Return only valid JSON.

RETURN JSON WITH EXACTLY THESE FIELDS:
{
  "title": "string",
  "excerpt": "string",
  "seo_meta_title": "string",
  "seo_meta_description": "string",
  "tags": ["string"],
  "key_insights": ["string"],
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
  "summary_body": "string",
  "references": [{ "title": "string", "url": "string" }]
}

REQUIREMENTS:
- signals must contain exactly ${signalCount} items
- week_summary_html should be 2 meaningful paragraphs and about ${targetWords >= 1600 ? '110-170' : targetWords >= 1200 ? '90-140' : '75-110'} words
- each signal body should be about ${targetWords >= 1600 ? '140-220' : targetWords >= 1200 ? '120-180' : '90-140'} words
- pattern_html should explain the larger pattern, not restate the signals, and should be about ${targetWords >= 1600 ? '140-200' : targetWords >= 1200 ? '110-160' : '85-120'} words
- closing_html should be about ${targetWords >= 1600 ? '70-110' : targetWords >= 1200 ? '55-90' : '45-75'} words
- quick_takes should contain ${targetWords >= 1600 ? 6 : 4} analyst-grade bullets
- references should contain at least ${targetWords >= 1600 ? 3 : 2} credible items
- key_insights must contain ${targetWords >= 1600 ? '5-6' : '4-5'} dense standalone takeaways
- summary_body should be 2-3 sentences and at least 30 words`;
}

function normalizeSignals(rawSignals: unknown, signalCount: number) {
  const items = Array.isArray(rawSignals) ? rawSignals : [];
  const normalized = items
    .map((item) => ({
      heading: typeof item?.heading === 'string'
        ? item.heading.trim()
        : typeof item?.title === 'string'
          ? item.title.trim()
          : typeof item?.label === 'string'
            ? item.label.trim()
            : '',
      body_html: normalizeParagraphHtml(
        typeof item?.body_html === 'string'
          ? item.body_html
          : typeof item?.body === 'string'
            ? item.body
            : typeof item?.analysis_html === 'string'
              ? item.analysis_html
              : typeof item?.text === 'string'
                ? item.text
                : '',
      ),
    }))
    .filter((item) => item.heading || item.body_html);

  while (normalized.length < signalCount) {
    normalized.push({ heading: '', body_html: '' });
  }

  return normalized.slice(0, signalCount);
}

function parseAnalystBoardOutput(raw: any, template: ContentBlock[], signalCount: number) {
  if (!raw || typeof raw !== 'object') return null;
  const signals = normalizeSignals(raw.signals, signalCount);

  let calloutIndex = 0;
  let signalHeadingIndex = 0;
  let signalBodyIndex = 0;
  const staticParagraphFields = [raw.week_summary_html, raw.pattern_html, raw.closing_html];
  let staticParagraphIndex = 0;

  const contentBlocks = template.map((block) => {
    if (block.type === 'key_insights') {
      return {
        ...block,
        items: Array.isArray(raw.key_insights)
          ? raw.key_insights.map((item: unknown) => String(item ?? '').trim()).filter(Boolean)
          : block.items,
      } as KeyInsightsBlock;
    }
    if (block.type === 'callout') {
      const body = calloutIndex === 0 ? raw.lead_signal_callout : raw.watch_next_callout;
      calloutIndex += 1;
      return {
        ...block,
        title: '',
        body: typeof body === 'string' ? body.trim() : '',
      } as CalloutBlock;
    }
    if (block.type === 'quote') {
      return {
        ...block,
        text: typeof raw.quote_text === 'string' ? raw.quote_text.trim() : '',
        author: typeof raw.quote_author === 'string' ? raw.quote_author.trim() : '',
        source: typeof raw.quote_source === 'string' ? raw.quote_source.trim() : '',
      } as QuoteBlock;
    }
    if (block.type === 'paragraph') {
      let paragraphTarget: unknown;
      if (staticParagraphIndex === 0) {
        paragraphTarget = staticParagraphFields[staticParagraphIndex++];
      } else if (signalBodyIndex < signalCount) {
        paragraphTarget = signals[signalBodyIndex++].body_html;
      } else {
        paragraphTarget = staticParagraphFields[staticParagraphIndex++];
      }
      return {
        ...block,
        html: normalizeParagraphHtml(paragraphTarget),
      } as ParagraphBlock;
    }
    if (block.type === 'list') {
      return {
        ...block,
        items: Array.isArray(raw.quick_takes)
          ? raw.quick_takes.map((item: unknown, index: number) => ({
              id: block.items[index]?.id ?? `qt-${index}`,
              text: String(item ?? '').trim(),
            }))
          : block.items,
      } as ListBlock;
    }
    if (block.type === 'summary') {
      return {
        ...block,
        body: typeof raw.summary_body === 'string' ? raw.summary_body.trim() : '',
      } as SummaryBlock;
    }
    if (block.type === 'references') {
      return {
        ...block,
        items: Array.isArray(raw.references)
          ? raw.references.map((item: any, index: number) => ({
              id: block.items[index]?.id ?? `ref-${index}`,
              title: typeof item?.title === 'string' ? item.title.trim() : '',
              url: typeof item?.url === 'string' ? item.url.trim() : '',
            }))
          : block.items,
      } as ReferencesBlock;
    }
    if (block.type === 'heading' && block.level === 3) {
      const heading = signals[signalHeadingIndex++]?.heading || '';
      return {
        ...block,
        text: heading || block.text,
      };
    }
    return block;
  });

  return {
    title: typeof raw.title === 'string' ? raw.title : 'Untitled',
    excerpt: typeof raw.excerpt === 'string' ? raw.excerpt : '',
    content_html: '',
    tags: Array.isArray(raw.tags) ? raw.tags.filter((tag: unknown) => typeof tag === 'string') : [],
    category: '',
    seo_meta_title: typeof raw.seo_meta_title === 'string' ? raw.seo_meta_title : '',
    seo_meta_description: typeof raw.seo_meta_description === 'string' ? raw.seo_meta_description : '',
    key_insights: [],
    content_blocks: contentBlocks,
  };
}

function ensureAnalystBoardExtractables(result: ReturnType<typeof parseAnalystBoardOutput>) {
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

function countWords(text: string): number {
  const normalized = text.trim();
  return normalized ? normalized.split(/\s+/).filter(Boolean).length : 0;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function analyzeAnalystBoardDraft(blocks: ContentBlock[]) {
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

function getAnalystBoardComposite(
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

function buildAnalystBoardDepthRepairPrompt(
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

function buildAnalystBoardFocusedBodyPrompt(
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

function buildAnalystBoardExpansionPrompt(
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

function applyAnalystBoardDepthRepair(blocks: ContentBlock[], raw: any, signalCount: number): ContentBlock[] {
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

export async function runWeeklyBoardGeneration(
  input: NewsletterGenerationRequest,
): Promise<NewsletterGenerationResult> {
  const template = getAnalystBoardTemplate(input);
  const targetWords = getTargetWords(input);
  const signalCount = targetWords >= 1600 ? 5 : targetWords >= 1200 ? 4 : 3;

  let retryReason: string | undefined;
  let best: ReturnType<typeof parseAnalystBoardOutput> | null = null;
  let bestScore = -1;

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
          content: 'You are a senior analyst editor writing an intelligent weekly brief. Return only valid JSON. Be specific, interpretive, and decision-useful.',
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
    };
  }

  throw new Error('Failed to generate Analyst Board newsletter');
}
