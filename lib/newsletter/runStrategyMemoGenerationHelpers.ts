/** Part of runStrategyMemoGeneration (Agent-B split — main module keeps the original path). */
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
  SummaryBlock,
  ReferencesBlock,
  ColumnsBlock,
  ListBlock,
} from '../content/blockTypes';
import { flattenBlocks } from '../content/blockUtils';


export function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function getTargetWords(input: NewsletterGenerationRequest): number {
  const raw = input.answers?.target_word_count;
  return raw ? parseInt(String(raw), 10) || 1600 : 1600;
}

export function getStrategyMemoTemplate(input: NewsletterGenerationRequest): ContentBlock[] {
  if (Array.isArray(input.template_blocks) && input.template_blocks.length > 0) {
    return input.template_blocks as ContentBlock[];
  }
  const template = getDefaultNewsletterTemplates().find((item) => item.name.toLowerCase() === 'strategy memo');
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

export function buildStrategyMemoPrompt(
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

  const deeperTier = targetWords >= 2000;

  return `${parts.join('\n\n')}

YOUR TASK:
Write a high-quality "Strategy Memo" strategic letter. It should read like a consultant-grade memo with depth, leverage, and clear strategic consequences.

RETURN JSON WITH EXACTLY THESE FIELDS:
{
  "title": "string",
  "excerpt": "string",
  "seo_meta_title": "string",
  "seo_meta_description": "string",
  "tags": ["string"],
  "key_insights": ["string"],
  "lead_callout": "string",
  "situation_html": "string with <p> tags",
  "shift_html": "string with <p> tags",
  "forces_at_play_html": "string with <p> tags",
  "why_it_matters_now_html": "string with <p> tags",
  "analysis_html": "string with <p> tags",
  "positioning_html": "string with <p> tags",
  "strategic_moves": ["string"],
  "thesis_html": "string with <p> tags",
  "summary_body": "string",
  "references": [{ "title": "string", "url": "string" }]
}

DEPTH RULES:
- analysis_html is the deepest section and should explain forces, leverage, risks, and second-order effects
- positioning_html must explain where the opportunity is moving and how strong teams should respond
- shift_html must make the non-obvious change feel concrete and strategically important
- forces_at_play_html must unpack incentives, structural pressures, and hidden constraints
- why_it_matters_now_html must make urgency and timing feel decision-relevant, not generic
- strategic_moves should be differentiated and decision-grade, not generic
- references should support the memo with credible signals
- lead_callout should be at least 14 words and feel like a board-level thesis, not a slogan
- shift_html should be about ${deeperTier ? '110-160' : '85-125'} words
- forces_at_play_html should be about ${deeperTier ? '130-190' : '100-150'} words
- why_it_matters_now_html should be about ${deeperTier ? '110-160' : '85-125'} words
- analysis_html should be about ${deeperTier ? '260-360' : '210-300'} words
- positioning_html should be about ${deeperTier ? '170-240' : '130-190'} words
- thesis_html should be about ${deeperTier ? '100-145' : '80-115'} words
- return only valid JSON`;
}

export function parseStrategyMemoOutput(raw: any, template: ContentBlock[]) {
  if (!raw || typeof raw !== 'object') return null;

  const paragraphFields = [
    raw.situation_html,
    raw.shift_html,
    raw.forces_at_play_html,
    raw.why_it_matters_now_html,
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
    if (block.type === 'callout') {
      return {
        ...block,
        title: '',
        body: typeof raw.lead_callout === 'string' ? raw.lead_callout.trim() : '',
      } as CalloutBlock;
    }
    if (block.type === 'paragraph') {
      return {
        ...block,
        html: normalizeParagraphHtml(paragraphFields[paragraphIndex++]),
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
                html: normalizeParagraphHtml(idx === 0 ? raw.forces_at_play_html : raw.why_it_matters_now_html),
              } as ParagraphBlock;
            }
            return inner;
          }),
        })),
      };
      return nextColumns;
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

export function ensureStrategyMemoSeo(result: ReturnType<typeof parseStrategyMemoOutput>) {
  if (!result) return result;
  const flat = flattenBlocks(result.content_blocks);
  const paragraphs = flat.filter((block): block is ParagraphBlock => block.type === 'paragraph');
  const summary = flat.find((block): block is SummaryBlock => block.type === 'summary');
  const fallback = summary?.body?.trim() || stripHtml(paragraphs[0]?.html || '') || result.title;
  if (!result.excerpt || result.excerpt.trim().length < 70) {
    result.excerpt = fallback.slice(0, 155).trim();
  }
  if (result.title.trim().length > 0 && result.title.trim().length < 20) {
    result.title = `${result.title.trim()}: Strategy Memo`;
  }
  if (!result.seo_meta_title || !result.seo_meta_title.trim()) {
    result.seo_meta_title = result.title.trim();
  }
  if (!result.seo_meta_description || result.seo_meta_description.trim().length < 70) {
    result.seo_meta_description = fallback.slice(0, 155).trim();
  }
  return result;
}

export function analyzeStrategyMemoDraft(blocks: ContentBlock[]) {
  const flat = flattenBlocks(blocks);
  const paragraphs = flat.filter((block): block is ParagraphBlock => block.type === 'paragraph');
  const paragraphWordCounts = paragraphs.map((block) => block.html.replace(/<[^>]+>/g, ' ').trim().split(/\s+/).filter(Boolean).length);
  const calloutWords = flat
    .filter((block): block is CalloutBlock => block.type === 'callout')
    .map((block) => (block.body || '').trim().split(/\s+/).filter(Boolean).length)[0] ?? 0;
  const strategicMovesWords = flat
    .filter((block): block is ListBlock => block.type === 'list')
    .flatMap((block) => block.items.map((item) => (item.text || '').trim().split(/\s+/).filter(Boolean).length));
  const avgStrategicMoveWords = strategicMovesWords.length
    ? Math.round(strategicMovesWords.reduce((sum, count) => sum + count, 0) / strategicMovesWords.length)
    : 0;
  return {
    avgParagraphWords: paragraphWordCounts.length
      ? Math.round(paragraphWordCounts.reduce((sum, count) => sum + count, 0) / paragraphWordCounts.length)
      : 0,
    paragraphCount: paragraphWordCounts.length,
    calloutWords,
    avgStrategicMoveWords,
    moveCount: strategicMovesWords.length,
    analysisWords: paragraphWordCounts[4] ?? 0,
    positioningWords: paragraphWordCounts[5] ?? 0,
    thesisWords: paragraphWordCounts[6] ?? 0,
  };
}

export function buildStrategyMemoDepthRepairPrompt(
  input: NewsletterGenerationRequest,
  retryReason: string,
  parsed: NonNullable<ReturnType<typeof parseStrategyMemoOutput>>,
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
  "lead_callout": "string",
  "shift_html": "string with <p> tags",
  "forces_at_play_html": "string with <p> tags",
  "why_it_matters_now_html": "string with <p> tags",
  "analysis_html": "string with <p> tags",
  "positioning_html": "string with <p> tags",
  "strategic_moves": ["string"],
  "thesis_html": "string with <p> tags"
}

DEPTH TARGETS:
- lead_callout: sharpen the memo's core strategic bet in one strong sentence
- shift_html: make the non-obvious change clearer and more consequential
- forces_at_play_html: deepen incentives, constraints, and drivers
- why_it_matters_now_html: sharpen urgency and strategic stakes
- analysis_html: deepen leverage, risk, second-order effects, and positioning logic across multiple causal lenses
- positioning_html: explain what strong teams should actually do, what to avoid, and why now
- strategic_moves: each move must be a differentiated strategic action with rationale, not a generic recommendation
- thesis_html: conclude with a sharper strategic lens, clearer decision frame, and explicit tradeoff
- analysis_html should be at least 180 words
- positioning_html should be at least 120 words
- thesis_html should be at least 80 words
- every rewritten section should feel like a memo for operators making a real decision, not commentary for observers
- keep the same underlying thesis, but make the reasoning more developed
- return only valid JSON`;
}

export function buildStrategyMemoFocusedBodyPrompt(
  input: NewsletterGenerationRequest,
  retryReason: string,
  parsed: NonNullable<ReturnType<typeof parseStrategyMemoOutput>>,
): string {
  return `TOPIC: ${input.topic}

FOCUSED DEEPENING GOAL:
The strategy memo still lacks depth. Rewrite only the core strategic body so it reads like a senior consultant memo with explicit strategic judgment.

CURRENT TITLE:
${parsed.title}

WHY THE DRAFT WAS REJECTED:
${retryReason}

RETURN JSON WITH EXACTLY THESE FIELDS:
{
  "analysis_html": "string with <p> tags",
  "positioning_html": "string with <p> tags",
  "strategic_moves": ["string"],
  "thesis_html": "string with <p> tags"
}

STRICT RULES:
- analysis_html must explain market forces, incentives, leverage, risks, second-order effects, and likely consequences
- positioning_html must state where the opportunity is moving, who is best positioned, and what strong teams should change now
- strategic_moves must be concrete strategic decisions with rationale, not checklist items
- thesis_html must end with a clear strategic judgment and tradeoff
- do not change the core thesis, only deepen it
- return only valid JSON`;
}

export function applyStrategyMemoDepthRepair(
  blocks: ContentBlock[],
  raw: any,
): ContentBlock[] {
  const paragraphFields = [
    undefined,
    raw.shift_html,
    raw.forces_at_play_html,
    raw.why_it_matters_now_html,
    raw.analysis_html,
    raw.positioning_html,
    raw.thesis_html,
  ];
  let paragraphIndex = 0;

  return blocks.map((block) => {
    if (block.type === 'callout' && typeof raw.lead_callout === 'string' && raw.lead_callout.trim()) {
      return {
        ...block,
        title: '',
        body: raw.lead_callout.trim(),
      } as CalloutBlock;
    }
    if (block.type === 'list' && Array.isArray(raw.strategic_moves)) {
      return {
        ...block,
        items: raw.strategic_moves.map((item: unknown, index: number) => ({
          id: block.items[index]?.id ?? `move-${index}`,
          text: String(item ?? '').trim(),
        })).filter((item: { text: string }) => item.text),
      } as ListBlock;
    }
    if (block.type !== 'paragraph') return block;
    const nextValue = paragraphFields[paragraphIndex++];
    if (typeof nextValue !== 'string' || !nextValue.trim()) return block;
    return {
      ...block,
      html: normalizeParagraphHtml(nextValue),
    } as ParagraphBlock;
  });
}

