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


export function getTargetWords(input: NewsletterGenerationRequest): number {
  const raw = input.answers?.target_word_count;
  return raw ? parseInt(String(raw), 10) || 1200 : 1200;
}

export function getAnalystBoardTemplate(input: NewsletterGenerationRequest): ContentBlock[] {
  if (Array.isArray(input.template_blocks) && input.template_blocks.length > 0) {
    return input.template_blocks as ContentBlock[];
  }
  const template = getDefaultNewsletterTemplates().find((item) => item.name.toLowerCase() === 'analyst board');
  return template ? instantiateNewsletterTemplate(template, getTargetWords(input)) : [];
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

export function buildAnalystBoardPrompt(
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

export function normalizeSignals(rawSignals: unknown, signalCount: number) {
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

export function parseAnalystBoardOutput(raw: any, template: ContentBlock[], signalCount: number) {
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

