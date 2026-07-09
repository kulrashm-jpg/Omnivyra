/** Part of runMarketMapGeneration (Agent-B split — main module keeps the original path). */
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
  QuoteBlock,
  SummaryBlock,
  ReferencesBlock,
  ColumnsBlock,
  ListBlock,
} from '../content/blockTypes';
import { flattenBlocks } from '../content/blockUtils';


export function getTargetWords(input: NewsletterGenerationRequest): number {
  const raw = input.answers?.target_word_count;
  return raw ? parseInt(String(raw), 10) || 1600 : 1600;
}

export function getMarketMapTemplate(input: NewsletterGenerationRequest): ContentBlock[] {
  if (Array.isArray(input.template_blocks) && input.template_blocks.length > 0) {
    return input.template_blocks as ContentBlock[];
  }
  const template = getDefaultNewsletterTemplates().find((item) => item.name.toLowerCase() === 'market map');
  return template ? instantiateNewsletterTemplate(template, getTargetWords(input)) : [];
}

export function buildMarketMapPrompt(
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
  if (input.answers?.campaign_objective) parts.push(`CAMPAIGN OBJECTIVE: ${input.answers.campaign_objective}`);
  if (input.answers?.trend_context) parts.push(`TREND CONTEXT: ${input.answers.trend_context}`);
  if (input.companyContext?.audience) parts.push(`AUDIENCE: ${input.companyContext.audience}`);
  if (input.companyContext?.brand_voice) parts.push(`BRAND VOICE: ${input.companyContext.brand_voice}`);
  if (input.companyContext?.industry) parts.push(`INDUSTRY: ${input.companyContext.industry}`);
  if (retryReason) parts.push(`PREVIOUS DRAFT FAILED BECAUSE: ${retryReason}`);

  return `${parts.join('\n\n')}

YOUR TASK:
Write a high-quality "Market Map" Strategic Letter. The main goal is deeper strategic reasoning, not surface commentary.

RETURN JSON WITH EXACTLY THESE FIELDS:
{
  "title": "string",
  "excerpt": "string",
  "seo_meta_title": "string",
  "seo_meta_description": "string",
  "tags": ["string"],
  "key_insights": ["string"],
  "situation_html": "string with <p> tags",
  "what_most_teams_see_html": "string with <p> tags",
  "what_strong_teams_notice_html": "string with <p> tags",
  "shift_html": "string with <p> tags",
  "quote_text": "string",
  "quote_author": "string",
  "quote_source": "string",
  "analysis_html": "string with <p> tags",
  "positioning_html": "string with <p> tags",
  "strategic_moves": ["string"],
  "thesis_html": "string with <p> tags",
  "summary_body": "string",
  "references": [{ "title": "string", "url": "string" }]
}

DEPTH RULES:
- analysis_html is the main depth carrier and must feel like consultant-grade reasoning
- positioning_html must explain where the opportunity is moving and why
- shift_html must explain what changed and why it matters now
- what_strong_teams_notice_html must reveal a non-obvious pattern or signal, not a summary
- strategic_moves must be concrete, differentiated, and useful
- use references to ground the strategy
- shift_html should be about 95-145 words
- analysis_html should be about 230-340 words
- positioning_html should be about 140-210 words
- thesis_html should be about 90-130 words
- strategic_moves should contain at least 4 items and each item should be at least 14 words
- return only valid JSON`;
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

export function countWords(text: string): number {
  const normalized = text.trim();
  return normalized ? normalized.split(/\s+/).filter(Boolean).length : 0;
}

export function parseMarketMapOutput(raw: any, template: ContentBlock[]) {
  if (!raw || typeof raw !== 'object') return null;

  const topLevelParagraphFields = [
    raw.situation_html,
    raw.shift_html,
    raw.analysis_html,
    raw.positioning_html,
    raw.thesis_html,
  ];
  let paragraphIndex = 0;

  const contentBlocks = template.map((block) => {
    if (block.type === 'key_insights') {
      return {
        ...block,
        items: Array.isArray(raw.key_insights)
          ? raw.key_insights.map((item: unknown) => String(item ?? '').trim()).filter(Boolean)
          : block.items,
      } as KeyInsightsBlock;
    }
    if (block.type === 'paragraph') {
      return {
        ...block,
        html: normalizeParagraphHtml(topLevelParagraphFields[paragraphIndex++]),
      } as ParagraphBlock;
    }
    if (block.type === 'columns') {
      const nextColumns: ColumnsBlock = {
        ...block,
        columns: block.columns.map((column, idx) => ({
          ...column,
          blocks: column.blocks.map((inner) => {
            if (inner.type === 'paragraph') {
              return {
                ...inner,
                html: normalizeParagraphHtml(idx === 0 ? raw.what_most_teams_see_html : raw.what_strong_teams_notice_html),
              } as ParagraphBlock;
            }
            return inner;
          }),
        })),
      };
      return nextColumns;
    }
    if (block.type === 'quote') {
      return {
        ...block,
        text: typeof raw.quote_text === 'string' ? raw.quote_text.trim() : '',
        author: typeof raw.quote_author === 'string' ? raw.quote_author.trim() : '',
        source: typeof raw.quote_source === 'string' ? raw.quote_source.trim() : '',
      } as QuoteBlock;
    }
    if (block.type === 'list') {
      return {
        ...block,
        items: Array.isArray(raw.strategic_moves)
          ? raw.strategic_moves.map((item: unknown, index: number) => ({
              id: block.items[index]?.id ?? `move-${index}`,
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

export function analyzeMarketMapDraft(blocks: ContentBlock[]) {
  const flat = flattenBlocks(blocks);
  const paragraphs = flat.filter((block): block is ParagraphBlock => block.type === 'paragraph');
  const paragraphWordCounts = paragraphs.map((block) => block.html.replace(/<[^>]+>/g, ' ').trim().split(/\s+/).filter(Boolean).length);
  const strategicMoves = flat
    .filter((block): block is ListBlock => block.type === 'list')
    .flatMap((block) => block.items.map((item) => countWords(item.text)));
  return {
    avgParagraphWords: paragraphWordCounts.length
      ? Math.round(paragraphWordCounts.reduce((sum, count) => sum + count, 0) / paragraphWordCounts.length)
      : 0,
    paragraphCount: paragraphWordCounts.length,
    noticeWords: paragraphWordCounts[2] ?? 0,
    shiftWords: paragraphWordCounts[3] ?? 0,
    analysisWords: paragraphWordCounts[4] ?? 0,
    positioningWords: paragraphWordCounts[5] ?? 0,
    thesisWords: paragraphWordCounts[6] ?? 0,
    moveCount: strategicMoves.length,
    avgMoveWords: strategicMoves.length
      ? Math.round(strategicMoves.reduce((sum, count) => sum + count, 0) / strategicMoves.length)
      : 0,
  };
}

export function buildMarketMapDepthRepairPrompt(
  input: NewsletterGenerationRequest,
  retryReason: string,
  parsed: NonNullable<ReturnType<typeof parseMarketMapOutput>>,
): string {
  return `TOPIC: ${input.topic}

REPAIR GOAL:
Depth is still too weak. Keep the same strategic thesis and structure, but deepen only the body reasoning.

CURRENT TITLE:
${parsed.title}

WHY THE DRAFT WAS REJECTED:
${retryReason}

RETURN JSON WITH EXACTLY THESE FIELDS:
{
  "what_strong_teams_notice_html": "string with <p> tags",
  "shift_html": "string with <p> tags",
  "analysis_html": "string with <p> tags",
  "positioning_html": "string with <p> tags",
  "strategic_moves": ["string"],
  "thesis_html": "string with <p> tags"
}

DEPTH TARGETS:
- what_strong_teams_notice_html: surface a more non-obvious pattern or signal that creates strategic advantage
- shift_html: make the non-obvious shift clearer and more consequential
- analysis_html: deepen forces, incentives, leverage, and second-order effects
- positioning_html: explain where the opportunity is moving, what smart teams should do, and what weak teams will miss
- strategic_moves: make each move more decision-grade and more differentiated
- thesis_html: conclude with a sharper strategic lens and a stronger strategic judgment
- make the rewritten sections feel more like a strategic map and less like a generic market commentary
- keep the same underlying thesis, but make the reasoning more developed
- return only valid JSON`;
}

export function buildMarketMapFocusedBodyPrompt(
  input: NewsletterGenerationRequest,
  targetWords: number,
  retryReason: string,
  parsed: NonNullable<ReturnType<typeof parseMarketMapOutput>>,
): string {
  const deeperTier = targetWords >= 1600;
  return `TOPIC: ${input.topic}

FOCUSED DEEPENING GOAL:
The market map still needs more depth. Rewrite only the strategic core with stronger pattern recognition, sharper analysis, and clearer positioning.

CURRENT TITLE:
${parsed.title}

WHY THE DRAFT WAS REJECTED:
${retryReason}

RETURN JSON WITH EXACTLY THESE FIELDS:
{
  "what_strong_teams_notice_html": "string with <p> tags",
  "shift_html": "string with <p> tags",
  "analysis_html": "string with <p> tags",
  "positioning_html": "string with <p> tags",
  "strategic_moves": ["string"],
  "thesis_html": "string with <p> tags"
}

STRICT RULES:
- what_strong_teams_notice_html must reveal a non-obvious signal that changes strategic interpretation
- shift_html must connect that signal to the market change with clearer strategic consequences
- analysis_html must deepen the market forces, incentives, leverage, and second-order effects
- positioning_html must explain what strong teams should do next and what weak teams will miss
- strategic_moves must be concrete strategic actions with rationale, not generic advice
- thesis_html must end with a sharper strategic judgment
- what_strong_teams_notice_html should be about ${deeperTier ? '110-150' : '85-120'} words
- shift_html should be about ${deeperTier ? '120-170' : '95-135'} words
- analysis_html should be about ${deeperTier ? '280-380' : '220-310'} words
- positioning_html should be about ${deeperTier ? '170-240' : '130-190'} words
- thesis_html should be about ${deeperTier ? '110-150' : '80-115'} words
- strategic_moves must contain at least 4 items and average at least ${deeperTier ? '18' : '15'} words per item
- do not change the core thesis, only deepen it
- return only valid JSON`;
}

export function applyMarketMapDepthRepair(
  blocks: ContentBlock[],
  raw: any,
): ContentBlock[] {
  const topLevelParagraphFields = [
    undefined,
    raw.shift_html,
    raw.analysis_html,
    raw.positioning_html,
    raw.thesis_html,
  ];
  let paragraphIndex = 0;

  return blocks.map((block) => {
    if (block.type === 'list' && Array.isArray(raw.strategic_moves)) {
      return {
        ...block,
        items: raw.strategic_moves.map((item: unknown, index: number) => ({
          id: block.items[index]?.id ?? `move-${index}`,
          text: String(item ?? '').trim(),
        })).filter((item: { text: string }) => item.text),
      } as ListBlock;
    }
    if (block.type === 'columns') {
      return {
        ...block,
        columns: block.columns.map((column, index) => ({
          ...column,
          blocks: column.blocks.map((inner) => {
            if (inner.type !== 'paragraph') return inner;
            const nextHtml = index === 0 ? raw.what_most_teams_see_html : raw.what_strong_teams_notice_html;
            if (typeof nextHtml !== 'string' || !nextHtml.trim()) return inner;
            return {
              ...inner,
              html: normalizeParagraphHtml(nextHtml),
            } as ParagraphBlock;
          }),
        })),
      } as ColumnsBlock;
    }
    if (block.type !== 'paragraph') return block;
    const nextValue = topLevelParagraphFields[paragraphIndex++];
    if (typeof nextValue !== 'string' || !nextValue.trim()) return block;
    return {
      ...block,
      html: normalizeParagraphHtml(nextValue),
    } as ParagraphBlock;
  });
}

export function getMarketMapCompositeScore(
  parsed: NonNullable<ReturnType<typeof parseMarketMapOutput>>,
  targetWords: number,
) {
  const score = calculateNewsletterQualityScore(parsed.content_blocks, {
    title: parsed.title,
    excerpt: parsed.excerpt,
    seo_meta_title: parsed.seo_meta_title,
    seo_meta_description: parsed.seo_meta_description,
    tags: parsed.tags,
    target_word_count: targetWords,
    content_type: 'newsletter',
    format_type: 'strategic-letter',
  });
  const analysis = analyzeMarketMapDraft(parsed.content_blocks);
  const composite = score.breakdown.depth * 5
    + score.breakdown.seo * 2
    + analysis.noticeWords
    + analysis.shiftWords
    + analysis.analysisWords
    + analysis.positioningWords
    + analysis.thesisWords
    + analysis.avgMoveWords * 6
    + Math.min(score.meta.wordCount, targetWords);
  return { score, analysis, composite };
}

