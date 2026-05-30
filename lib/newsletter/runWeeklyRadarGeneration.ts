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

function getTargetWords(input: NewsletterGenerationRequest): number {
  const raw = input.answers?.target_word_count;
  return raw ? parseInt(String(raw), 10) || 1200 : 1200;
}

function getSignalRadarTemplate(input: NewsletterGenerationRequest): ContentBlock[] {
  if (Array.isArray(input.template_blocks) && input.template_blocks.length > 0) {
    return input.template_blocks as ContentBlock[];
  }
  const template = getDefaultNewsletterTemplates().find((item) => item.name.toLowerCase() === 'signal radar');
  return template ? instantiateNewsletterTemplate(template, getTargetWords(input)) : [];
}

function buildWeeklyRadarPrompt(
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
  if (input.answers?.campaign_objective) parts.push(`CAMPAIGN OBJECTIVE: ${input.answers.campaign_objective}`);
  if (input.answers?.trend_context) parts.push(`TREND CONTEXT: ${input.answers.trend_context}`);
  if (input.companyContext?.audience) parts.push(`AUDIENCE: ${input.companyContext.audience}`);
  if (input.companyContext?.brand_voice) parts.push(`BRAND VOICE: ${input.companyContext.brand_voice}`);
  if (input.companyContext?.industry) parts.push(`INDUSTRY: ${input.companyContext.industry}`);
  if (retryReason) parts.push(`PREVIOUS DRAFT FAILED BECAUSE: ${retryReason}`);

  return `${parts.join('\n\n')}

YOUR TASK:
Write a high-quality "Signal Radar" Weekly Brief. This should feel like a true editorial briefing with curation, analysis, and extractable insight.

HARD RULES:
- Do not dump updates. Curate signals and interpret them.
- Every signal must include both what happened and why it matters.
- Build a real pattern section that connects the dots.
- Make GEO strong with clear key insights, a real summary, and usable references.
- Add one quotable editorial line that captures the defining signal of the week.
- Make every paragraph substantial. No short analyst notes.
- Use HTML strings with <p> tags for paragraph fields.
- Return only valid JSON.

RETURN JSON WITH EXACTLY THESE FIELDS:
{
  "title": "string",
  "excerpt": "string",
  "seo_meta_title": "string",
  "seo_meta_description": "string",
  "tags": ["string"],
  "lead_callout": "string",
  "quote_text": "string",
  "quote_author": "string",
  "quote_source": "string",
  "key_insights": ["string"],
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
  "summary_body": "string",
  "references": [
    { "title": "string", "url": "string" }
  ]
}

REQUIREMENTS:
- signals must contain exactly ${signalCount} items
- week_summary_html should be 2 meaningful paragraphs and about ${targetWords >= 1600 ? '110-170' : targetWords >= 1200 ? '90-140' : '75-110'} words
- every what_happened_html should be about ${targetWords >= 1600 ? '90-140' : targetWords >= 1200 ? '75-120' : '60-95'} words
- every why_it_matters_html should be about ${targetWords >= 1600 ? '110-170' : targetWords >= 1200 ? '90-140' : '70-110'} words
- pattern_html should explain the larger pattern, not repeat the signals, and should be about ${targetWords >= 1600 ? '140-200' : targetWords >= 1200 ? '110-160' : '85-120'} words
- quick_takes should contain ${targetWords >= 1600 ? 6 : 4} analytical bullets
- references should contain at least ${targetWords >= 1600 ? 3 : 2} credible items
- why_it_matters_html must be at least as strong as what_happened_html
- key_insights must be dense standalone takeaways
- closing_html should be about ${targetWords >= 1600 ? '70-110' : targetWords >= 1200 ? '55-90' : '45-75'} words
- summary_body should be at least 30 words`;
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

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function countWords(text: string): number {
  const normalized = text.trim();
  return normalized ? normalized.split(/\s+/).filter(Boolean).length : 0;
}

function normalizeSignals(rawSignals: unknown, signalCount: number) {
  const items = Array.isArray(rawSignals) ? rawSignals : [];
  const normalized = items
    .map((item: any) => ({
      what_happened_heading: typeof item?.what_happened_heading === 'string'
        ? item.what_happened_heading.trim()
        : typeof item?.what_happened_title === 'string'
          ? item.what_happened_title.trim()
          : typeof item?.heading === 'string'
            ? item.heading.trim()
            : '',
      what_happened_html: normalizeParagraphHtml(
        typeof item?.what_happened_html === 'string'
          ? item.what_happened_html
          : typeof item?.what_happened === 'string'
            ? item.what_happened
            : typeof item?.body === 'string'
              ? item.body
              : '',
      ),
      why_it_matters_heading: typeof item?.why_it_matters_heading === 'string'
        ? item.why_it_matters_heading.trim()
        : typeof item?.why_it_matters_title === 'string'
          ? item.why_it_matters_title.trim()
          : 'Why It Matters',
      why_it_matters_html: normalizeParagraphHtml(
        typeof item?.why_it_matters_html === 'string'
          ? item.why_it_matters_html
          : typeof item?.why_it_matters === 'string'
            ? item.why_it_matters
            : typeof item?.analysis_html === 'string'
              ? item.analysis_html
              : typeof item?.analysis === 'string'
                ? item.analysis
                : '',
      ),
    }))
    .filter((item) => item.what_happened_heading || item.what_happened_html || item.why_it_matters_html);

  while (normalized.length < signalCount) {
    normalized.push({
      what_happened_heading: '',
      what_happened_html: '',
      why_it_matters_heading: 'Why It Matters',
      why_it_matters_html: '',
    });
  }

  return normalized.slice(0, signalCount);
}

function parseWeeklyRadarOutput(raw: any, template: ContentBlock[], signalCount: number) {
  if (!raw || typeof raw !== 'object') return null;
  const signals = normalizeSignals(raw.signals, signalCount);
  if (signals.length === 0) return null;

  const nextBlocks: ContentBlock[] = [];
  let signalIndex = 0;

  for (const block of template) {
    if (block.type === 'key_insights') {
      nextBlocks.push({
        ...block,
        items: Array.isArray(raw.key_insights)
          ? raw.key_insights.map((item: unknown) => String(item ?? '').trim()).filter(Boolean)
          : block.items,
      } as KeyInsightsBlock);
      continue;
    }

    if (block.type === 'callout') {
      nextBlocks.push({
        ...block,
        title: '',
        body: typeof raw.lead_callout === 'string' ? raw.lead_callout.trim() : '',
      } as CalloutBlock);
      continue;
    }

    if (block.type === 'quote') {
      nextBlocks.push({
        ...block,
        text: typeof raw.quote_text === 'string' ? raw.quote_text.trim() : '',
        author: typeof raw.quote_author === 'string' ? raw.quote_author.trim() : '',
        source: typeof raw.quote_source === 'string' ? raw.quote_source.trim() : '',
      } as QuoteBlock);
      continue;
    }

    if (block.type === 'paragraph') {
      const paragraphTargets = [
        raw.week_summary_html,
        raw.pattern_html,
        raw.closing_html,
      ];
      const paragraphIndex = nextBlocks.filter((item) => item.type === 'paragraph').length;
      nextBlocks.push({
        ...block,
        html: normalizeParagraphHtml(paragraphTargets[paragraphIndex]),
      } as ParagraphBlock);
      continue;
    }

    if (block.type === 'columns') {
      const signal = signals[signalIndex];
      signalIndex += 1;
      const mergedColumns: ColumnsBlock = {
        ...block,
        columns: block.columns.map((column, columnIdx) => ({
          ...column,
          blocks: column.blocks.map((inner) => {
            if (inner.type === 'heading') {
              return {
                ...inner,
                text: columnIdx === 0
                  ? String(signal?.what_happened_heading || inner.text || '').trim()
                  : String(signal?.why_it_matters_heading || inner.text || '').trim(),
              };
            }
            if (inner.type === 'paragraph') {
              return {
                ...inner,
                html: normalizeParagraphHtml(columnIdx === 0 ? signal?.what_happened_html : signal?.why_it_matters_html),
              } as ParagraphBlock;
            }
            return inner;
          }),
        })),
      };
      nextBlocks.push(mergedColumns);
      continue;
    }

    if (block.type === 'list') {
      nextBlocks.push({
        ...block,
        items: Array.isArray(raw.quick_takes)
          ? raw.quick_takes.map((item: unknown, index: number) => ({
              id: block.items[index]?.id ?? `qt-${index}`,
              text: String(item ?? '').trim(),
            }))
          : block.items,
      } as ListBlock);
      continue;
    }

    if (block.type === 'summary') {
      nextBlocks.push({
        ...block,
        body: typeof raw.summary_body === 'string' ? raw.summary_body.trim() : '',
      } as SummaryBlock);
      continue;
    }

    if (block.type === 'references') {
      nextBlocks.push({
        ...block,
        items: Array.isArray(raw.references)
          ? raw.references.map((item: any, index: number) => ({
              id: block.items[index]?.id ?? `ref-${index}`,
              title: typeof item?.title === 'string' ? item.title.trim() : '',
              url: typeof item?.url === 'string' ? item.url.trim() : '',
            }))
          : block.items,
      } as ReferencesBlock);
      continue;
    }

    nextBlocks.push(block);
  }

  return {
    title: typeof raw.title === 'string' ? raw.title : 'Untitled',
    excerpt: typeof raw.excerpt === 'string' ? raw.excerpt : '',
    content_html: '',
    tags: Array.isArray(raw.tags) ? raw.tags.filter((tag: unknown) => typeof tag === 'string') : [],
    category: '',
    seo_meta_title: typeof raw.seo_meta_title === 'string' ? raw.seo_meta_title : '',
    seo_meta_description: typeof raw.seo_meta_description === 'string' ? raw.seo_meta_description : '',
    key_insights: [],
    content_blocks: nextBlocks,
  };
}

function ensureWeeklyRadarExtractables(result: ReturnType<typeof parseWeeklyRadarOutput>) {
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

function analyzeWeeklyRadarDraft(blocks: ContentBlock[]) {
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

function buildWeeklyRadarDepthRepairPrompt(
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

function buildWeeklyRadarFocusedBodyPrompt(
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

function applyWeeklyRadarDepthRepair(blocks: ContentBlock[], raw: any, signalCount: number): ContentBlock[] {
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
