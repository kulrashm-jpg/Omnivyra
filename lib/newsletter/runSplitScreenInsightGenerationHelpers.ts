/** Part of runSplitScreenInsightGeneration (Agent-B split — main module keeps the original path). */
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
  ParagraphBlock,
  QuoteBlock,
  SummaryBlock,
} from '../content/blockTypes';
import { flattenBlocks } from '../content/blockUtils';


export function getTargetWords(input: NewsletterGenerationRequest): number {
  const raw = input.answers?.target_word_count;
  return raw ? parseInt(String(raw), 10) || 1200 : 1200;
}

export function getSplitScreenTemplate(input: NewsletterGenerationRequest): ContentBlock[] {
  if (Array.isArray(input.template_blocks) && input.template_blocks.length > 0) {
    return input.template_blocks as ContentBlock[];
  }
  const template = getDefaultNewsletterTemplates().find((item) => item.name.toLowerCase() === 'split-screen insight');
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

export function buildSplitScreenPrompt(
  input: NewsletterGenerationRequest,
  targetWords: number,
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
  if (input.companyContext?.audience) parts.push(`AUDIENCE: ${input.companyContext.audience}`);
  if (input.companyContext?.brand_voice) parts.push(`BRAND VOICE: ${input.companyContext.brand_voice}`);
  if (retryReason) parts.push(`PREVIOUS DRAFT FAILED BECAUSE: ${retryReason}`);

  return `${parts.join('\n\n')}

YOUR TASK:
Write a "Split-Screen Insight" newsletter that contrasts the surface story with the deeper reality and ends with a strong practical shift.

HARD RULES:
- This is an insight letter, not a recap.
- The contrast between surface story and deeper reality must feel sharp and useful.
- Fill both extraction callouts: framing note and practical-shift line.
- Fill Key Insights, quote, and summary with distinct standalone value.
- Make all major body sections substantial. No short note-style paragraphs.
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
  "framing_callout": "string",
  "practical_shift_callout": "string",
  "hook_html": "string with <p> tags",
  "context_html": "string with <p> tags",
  "surface_story_html": "string with <p> tags",
  "deeper_reality_html": "string with <p> tags",
  "quote_text": "string",
  "quote_author": "string",
  "quote_source": "string",
  "example_html": "string with <p> tags",
  "insight_html": "string with <p> tags",
  "expansion_html": "string with <p> tags",
  "implication_html": "string with <p> tags",
  "closing_html": "string with <p> tags",
  "summary_body": "string"
}

DEPTH RULES:
- hook_html should create tension, not just announce the topic
- surface_story_html must explain the default reading clearly enough to feel recognizable
- deeper_reality_html must reveal the hidden mechanism with concrete logic
- example_html should make the contrast feel real
- insight_html, expansion_html, and implication_html should each carry real reasoning, not placeholder commentary
- hook_html should be about ${targetWords >= 1600 ? '70-110' : targetWords >= 1200 ? '60-90' : '45-75'} words
- context_html should be about ${targetWords >= 1600 ? '90-140' : targetWords >= 1200 ? '75-120' : '60-95'} words
- surface_story_html should be about ${targetWords >= 1600 ? '110-170' : targetWords >= 1200 ? '90-140' : '75-115'} words
- deeper_reality_html should be about ${targetWords >= 1600 ? '130-200' : targetWords >= 1200 ? '110-170' : '90-135'} words
- example_html should be about ${targetWords >= 1600 ? '100-150' : targetWords >= 1200 ? '85-125' : '70-100'} words
- insight_html should be about ${targetWords >= 1600 ? '140-210' : targetWords >= 1200 ? '120-180' : '95-140'} words
- expansion_html should be about ${targetWords >= 1600 ? '110-170' : targetWords >= 1200 ? '90-140' : '75-110'} words
- implication_html should be about ${targetWords >= 1600 ? '110-170' : targetWords >= 1200 ? '90-140' : '75-110'} words
- key_insights should contain ${targetWords >= 1600 ? '5-6' : '4-5'} dense takeaways
- both callouts should be at least 14 words
- summary_body should be at least 30 words`;
}

export function parseSplitScreenOutput(raw: any, template: ContentBlock[]) {
  if (!raw || typeof raw !== 'object') return null;

  const paragraphFields = {
    hook_html: raw.hook_html,
    context_html: raw.context_html,
    surface_story_html: raw.surface_story_html,
    deeper_reality_html: raw.deeper_reality_html,
    example_html: raw.example_html,
    insight_html: raw.insight_html,
    expansion_html: raw.expansion_html,
    implication_html: raw.implication_html,
    closing_html: raw.closing_html,
  };
  let topLevelParagraphIndex = 0;

  const contentBlocks = template.map((block) => {
    if (block.type === 'key_insights') {
      return {
        ...block,
        items: Array.isArray(raw.key_insights)
          ? raw.key_insights.map((item: unknown) => String(item ?? '').trim()).filter(Boolean)
          : block.items,
      } as KeyInsightsBlock;
    }
    if (block.type === 'columns') {
      return {
        ...block,
        columns: block.columns.map((column, columnIndex) => ({
          ...column,
          blocks: column.blocks.map((inner) => {
            if (inner.type === 'paragraph') {
              const fieldName = columnIndex === 0 ? 'hook_html' : undefined;
              return {
                ...inner,
                html: normalizeParagraphHtml(fieldName ? paragraphFields[fieldName] : ''),
              } as ParagraphBlock;
            }
            if (inner.type === 'callout') {
              return {
                ...inner,
                title: '',
                body: typeof raw.framing_callout === 'string' ? raw.framing_callout.trim() : '',
              } as CalloutBlock;
            }
            return inner;
          }),
        })),
      };
    }
    if (block.type === 'callout') {
      return {
        ...block,
        title: '',
        body: typeof raw.practical_shift_callout === 'string' ? raw.practical_shift_callout.trim() : '',
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
    if (block.type === 'summary') {
      return {
        ...block,
        body: typeof raw.summary_body === 'string' ? raw.summary_body.trim() : '',
      } as SummaryBlock;
    }
    if (block.type === 'paragraph') {
      const fieldOrder = [
        'context_html',
        'surface_story_html',
        'deeper_reality_html',
        'example_html',
        'insight_html',
        'expansion_html',
        'implication_html',
        'closing_html',
      ] as const;
      const fieldName = fieldOrder[topLevelParagraphIndex++];
      return {
        ...block,
        html: normalizeParagraphHtml(fieldName ? paragraphFields[fieldName] : ''),
      } as ParagraphBlock;
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

export function ensureSplitScreenSeo(result: ReturnType<typeof parseSplitScreenOutput>) {
  if (!result) return result;
  const flat = flattenBlocks(result.content_blocks);
  const paragraphs = flat.filter((block): block is ParagraphBlock => block.type === 'paragraph');
  const summary = flat.find((block): block is SummaryBlock => block.type === 'summary');
  const callouts = flat.filter((block): block is CalloutBlock => block.type === 'callout');
  const quotes = flat.filter((block): block is QuoteBlock => block.type === 'quote');
  const fallback = summary?.body?.trim() || stripHtml(paragraphs[0]?.html || '') || result.title;
  const fallbackQuote = stripHtml(paragraphs[3]?.html || paragraphs[5]?.html || paragraphs[7]?.html || paragraphs[0]?.html || '').slice(0, 180).trim();
  let calloutIndex = 0;
  const rewriteBlock = (block: ContentBlock): ContentBlock => {
    if (block.type === 'columns') {
      return {
        ...block,
        columns: block.columns.map((column) => ({
          ...column,
          blocks: column.blocks.map((inner) => rewriteBlock(inner)),
        })),
      };
    }
    if (block.type === 'callout') {
      const currentWords = countWords(`${block.title} ${block.body}`);
      if (currentWords >= 14) {
        calloutIndex += 1;
        return block;
      }
      const nextBody = calloutIndex === 0
        ? `Framing note: the surface story is misleading because ${fallbackQuote || fallback || result.title}`
        : `Practical shift: teams should change how they act because ${summary?.body?.trim() || fallbackQuote || fallback || result.title}`;
      calloutIndex += 1;
      return { ...block, body: nextBody } as CalloutBlock;
    }
    if (block.type === 'quote') {
      const currentWords = countWords(`${block.text} ${block.author} ${block.source}`);
      if (currentWords >= 12) return block;
      return {
        ...block,
        text: fallbackQuote || fallback || quotes[0]?.text || result.title,
        author: block.author || 'Omnivyra',
        source: block.source || 'Split-screen insight',
      } as QuoteBlock;
    }
    return block;
  };
  result.content_blocks = result.content_blocks.map((block) => rewriteBlock(block));
  if (!result.excerpt || result.excerpt.trim().length < 70) {
    result.excerpt = fallback.slice(0, 155).trim();
  }
  if (result.title.trim().length > 0 && result.title.trim().length < 20) {
    result.title = `${result.title.trim()}: Split-Screen Insight`;
  }
  if (!result.seo_meta_title || !result.seo_meta_title.trim()) {
    result.seo_meta_title = result.title.trim();
  }
  if (!result.seo_meta_description || result.seo_meta_description.trim().length < 70) {
    result.seo_meta_description = fallback.slice(0, 155).trim();
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

export function analyzeSplitScreenDraft(blocks: ContentBlock[]) {
  const flat = flattenBlocks(blocks);
  const paragraphs = flat.filter((block): block is ParagraphBlock => block.type === 'paragraph');
  const callouts = flat.filter((block): block is CalloutBlock => block.type === 'callout');
  const quotes = flat.filter((block): block is QuoteBlock => block.type === 'quote');
  const summaries = flat.filter((block): block is SummaryBlock => block.type === 'summary');
  const insights = flat.filter((block): block is KeyInsightsBlock => block.type === 'key_insights');

  const paragraphWordCounts = paragraphs.map((block) => countWords(stripHtml(block.html))).filter(Boolean);
  const avgParagraphWords = paragraphWordCounts.length
    ? Math.round(paragraphWordCounts.reduce((sum, count) => sum + count, 0) / paragraphWordCounts.length)
    : 0;

  return {
    avgParagraphWords,
    wordCounts: {
      surface: paragraphWordCounts[2] ?? 0,
      deeper: paragraphWordCounts[3] ?? 0,
      example: paragraphWordCounts[4] ?? 0,
      insight: paragraphWordCounts[5] ?? 0,
      expansion: paragraphWordCounts[6] ?? 0,
      implication: paragraphWordCounts[7] ?? 0,
    },
    filledCallouts: callouts.filter((block) => countWords(`${block.title} ${block.body}`) >= 10).length,
    filledQuotes: quotes.filter((block) => countWords(`${block.text} ${block.author} ${block.source}`) >= 10).length,
    filledSummaries: summaries.filter((block) => countWords(block.body) >= 24).length,
    filledInsights: insights.some((block) => block.items.filter((item) => item.trim().length >= 18).length >= 3),
  };
}

export function buildSplitScreenDepthRepairPrompt(
  input: NewsletterGenerationRequest,
  targetWords: number,
  retryReason: string,
): string {
  return `TOPIC: ${input.topic}

REPAIR GOAL:
The split-screen insight has the right structure, but the body is still too thin. Deepen the reasoning while preserving the contrast and the extraction surfaces.

WHY THE DRAFT FAILED:
${retryReason}

RETURN JSON WITH EXACTLY THESE FIELDS:
{
  "framing_callout": "string",
  "practical_shift_callout": "string",
  "hook_html": "string with <p> tags",
  "context_html": "string with <p> tags",
  "surface_story_html": "string with <p> tags",
  "deeper_reality_html": "string with <p> tags",
  "example_html": "string with <p> tags",
  "insight_html": "string with <p> tags",
  "expansion_html": "string with <p> tags",
  "implication_html": "string with <p> tags",
  "closing_html": "string with <p> tags",
  "summary_body": "string"
}

RULES:
- both callouts must be substantive and at least 14 words
- deepen the contrast between the surface story and the deeper reality
- implication_html must end with a clear practical shift
- every major section should be materially more developed than before
- summary_body must be a real 2-3 sentence synthesis`;
}

export function buildSplitScreenFocusedBodyPrompt(
  input: NewsletterGenerationRequest,
  targetWords: number,
  retryReason: string,
): string {
  return `TOPIC: ${input.topic}

FOCUSED DEEPENING GOAL:
The split-screen insight is still too thin. Rewrite only the long-form body so it reads like a real insight letter with fuller reasoning, one grounded example, and a clearer practical shift.

WHY THE DRAFT WAS REJECTED:
${retryReason}

RETURN JSON WITH EXACTLY THESE FIELDS:
{
  "framing_callout": "string",
  "practical_shift_callout": "string",
  "hook_html": "string with <p> tags",
  "context_html": "string with <p> tags",
  "surface_story_html": "string with <p> tags",
  "deeper_reality_html": "string with <p> tags",
  "example_html": "string with <p> tags",
  "insight_html": "string with <p> tags",
  "expansion_html": "string with <p> tags",
  "implication_html": "string with <p> tags",
  "closing_html": "string with <p> tags",
  "summary_body": "string"
}

STRICT RULES:
- both callouts must be at least 16 words and clearly distinct
- hook_html should be at least ${targetWords >= 1600 ? '95' : targetWords >= 1200 ? '80' : '60'} words
- context_html should be at least ${targetWords >= 1600 ? '125' : targetWords >= 1200 ? '100' : '75'} words
- surface_story_html should be at least ${targetWords >= 1600 ? '150' : targetWords >= 1200 ? '120' : '90'} words
- deeper_reality_html should be at least ${targetWords >= 1600 ? '185' : targetWords >= 1200 ? '150' : '110'} words
- example_html should be at least ${targetWords >= 1600 ? '135' : targetWords >= 1200 ? '110' : '80'} words
- insight_html should be at least ${targetWords >= 1600 ? '210' : targetWords >= 1200 ? '170' : '125'} words
- expansion_html should be at least ${targetWords >= 1600 ? '150' : targetWords >= 1200 ? '120' : '90'} words
- implication_html should be at least ${targetWords >= 1600 ? '150' : targetWords >= 1200 ? '120' : '90'} words
- closing_html should be at least ${targetWords >= 1600 ? '65' : targetWords >= 1200 ? '55' : '40'} words
- every major section must use real reasoning, not summary language
- deeper_reality_html and insight_html must carry the most depth
- expansion_html and implication_html must add operational consequences, not restate the thesis
- implication_html must end with a clear operating shift
- return only valid JSON`;
}

export function applySplitScreenDepthRepair(blocks: ContentBlock[], raw: any): ContentBlock[] {
  const topLevelFields = [
    raw?.context_html,
    raw?.surface_story_html,
    raw?.deeper_reality_html,
    raw?.example_html,
    raw?.insight_html,
    raw?.expansion_html,
    raw?.implication_html,
    raw?.closing_html,
  ];
  let paragraphIndex = 0;

  return blocks.map((block) => {
    if (block.type === 'columns') {
      return {
        ...block,
        columns: block.columns.map((column, columnIndex) => ({
          ...column,
          blocks: column.blocks.map((inner) => {
            if (inner.type === 'paragraph' && columnIndex === 0) {
              return {
                ...inner,
                html: typeof raw?.hook_html === 'string' && raw.hook_html.trim() ? normalizeParagraphHtml(raw.hook_html) : inner.html,
              } as ParagraphBlock;
            }
            if (inner.type === 'callout') {
              return {
                ...inner,
                body: typeof raw?.framing_callout === 'string' && raw.framing_callout.trim() ? raw.framing_callout.trim() : inner.body,
              } as CalloutBlock;
            }
            return inner;
          }),
        })),
      };
    }
    if (block.type === 'callout') {
      return {
        ...block,
        body: typeof raw?.practical_shift_callout === 'string' && raw.practical_shift_callout.trim() ? raw.practical_shift_callout.trim() : block.body,
      } as CalloutBlock;
    }
    if (block.type === 'summary' && typeof raw?.summary_body === 'string' && raw.summary_body.trim()) {
      return { ...block, body: raw.summary_body.trim() } as SummaryBlock;
    }
    if (block.type === 'paragraph') {
      const next = topLevelFields[paragraphIndex++];
      return {
        ...block,
        html: typeof next === 'string' && next.trim() ? normalizeParagraphHtml(next) : block.html,
      } as ParagraphBlock;
    }
    return block;
  });
}

