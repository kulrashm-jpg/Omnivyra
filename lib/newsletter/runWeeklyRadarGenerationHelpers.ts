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


export function getTargetWords(input: NewsletterGenerationRequest): number {
  const raw = input.answers?.target_word_count;
  return raw ? parseInt(String(raw), 10) || 1200 : 1200;
}

export function getSignalRadarTemplate(input: NewsletterGenerationRequest): ContentBlock[] {
  if (Array.isArray(input.template_blocks) && input.template_blocks.length > 0) {
    return input.template_blocks as ContentBlock[];
  }
  const template = getDefaultNewsletterTemplates().find((item) => item.name.toLowerCase() === 'signal radar');
  return template ? instantiateNewsletterTemplate(template, getTargetWords(input)) : [];
}

export function buildWeeklyRadarPrompt(
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

export function normalizeParagraphHtml(value: unknown): string {
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

export function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function countWords(text: string): number {
  const normalized = text.trim();
  return normalized ? normalized.split(/\s+/).filter(Boolean).length : 0;
}

export function normalizeSignals(rawSignals: unknown, signalCount: number) {
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

export function parseWeeklyRadarOutput(raw: any, template: ContentBlock[], signalCount: number) {
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

