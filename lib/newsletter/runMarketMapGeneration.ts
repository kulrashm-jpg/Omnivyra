import { runCompletionWithOperation } from '../../backend/services/aiGateway';
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

function getTargetWords(input: NewsletterGenerationRequest): number {
  const raw = input.answers?.target_word_count;
  return raw ? parseInt(String(raw), 10) || 1600 : 1600;
}

function getMarketMapTemplate(input: NewsletterGenerationRequest): ContentBlock[] {
  if (Array.isArray(input.template_blocks) && input.template_blocks.length > 0) {
    return input.template_blocks as ContentBlock[];
  }
  const template = getDefaultNewsletterTemplates().find((item) => item.name.toLowerCase() === 'market map');
  return template ? instantiateNewsletterTemplate(template, getTargetWords(input)) : [];
}

function buildMarketMapPrompt(
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
- shift_html should be about 80-130 words
- analysis_html should be about 190-300 words
- positioning_html should be about 120-190 words
- thesis_html should be about 80-120 words
- return only valid JSON`;
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

function parseMarketMapOutput(raw: any, template: ContentBlock[]) {
  if (!raw || typeof raw !== 'object') return null;

  const paragraphFields = [
    raw.situation_html,
    raw.what_most_teams_see_html,
    raw.what_strong_teams_notice_html,
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

function analyzeMarketMapDraft(blocks: ContentBlock[]) {
  const flat = flattenBlocks(blocks);
  const paragraphs = flat.filter((block): block is ParagraphBlock => block.type === 'paragraph');
  const paragraphWordCounts = paragraphs.map((block) => block.html.replace(/<[^>]+>/g, ' ').trim().split(/\s+/).filter(Boolean).length);
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
  };
}

function buildMarketMapDepthRepairPrompt(
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
  "thesis_html": "string with <p> tags"
}

DEPTH TARGETS:
- what_strong_teams_notice_html: surface a more non-obvious pattern or signal that creates strategic advantage
- shift_html: make the non-obvious shift clearer and more consequential
- analysis_html: deepen forces, incentives, leverage, and second-order effects
- positioning_html: explain where the opportunity is moving, what smart teams should do, and what weak teams will miss
- thesis_html: conclude with a sharper strategic lens and a stronger strategic judgment
- make the rewritten sections feel more like a strategic map and less like a generic market commentary
- keep the same underlying thesis, but make the reasoning more developed
- return only valid JSON`;
}

function buildMarketMapFocusedBodyPrompt(
  input: NewsletterGenerationRequest,
  retryReason: string,
  parsed: NonNullable<ReturnType<typeof parseMarketMapOutput>>,
): string {
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
  "thesis_html": "string with <p> tags"
}

STRICT RULES:
- what_strong_teams_notice_html must reveal a non-obvious signal that changes strategic interpretation
- shift_html must connect that signal to the market change with clearer strategic consequences
- analysis_html must deepen the market forces, incentives, leverage, and second-order effects
- positioning_html must explain what strong teams should do next and what weak teams will miss
- thesis_html must end with a sharper strategic judgment
- do not change the core thesis, only deepen it
- return only valid JSON`;
}

function applyMarketMapDepthRepair(
  blocks: ContentBlock[],
  raw: any,
): ContentBlock[] {
  const paragraphFields = [
    undefined,
    undefined,
    raw.what_strong_teams_notice_html,
    raw.shift_html,
    raw.analysis_html,
    raw.positioning_html,
    raw.thesis_html,
  ];
  let paragraphIndex = 0;

  return blocks.map((block) => {
    if (block.type !== 'paragraph') return block;
    const nextValue = paragraphFields[paragraphIndex++];
    if (typeof nextValue !== 'string' || !nextValue.trim()) return block;
    return {
      ...block,
      html: normalizeParagraphHtml(nextValue),
    } as ParagraphBlock;
  });
}

export async function runMarketMapGeneration(
  input: NewsletterGenerationRequest,
): Promise<NewsletterGenerationResult> {
  const template = getMarketMapTemplate(input);
  const targetWords = getTargetWords(input);
  let retryReason: string | undefined;
  let best: ReturnType<typeof parseMarketMapOutput> | null = null;
  let bestScore = -1;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const completion = await runCompletionWithOperation({
      operation: 'blogGeneration',
      companyId: input.company_id,
      model: 'gpt-4o',
      temperature: 0.25,
      response_format: { type: 'json_object' },
      max_tokens: targetWords >= 2000 ? 5600 : 4600,
      messages: [
        {
          role: 'system',
          content: 'You are a strategy consultant writing a strategic newsletter. Return only valid JSON. Focus on deep strategic logic, not generic commentary.',
        },
        {
          role: 'user',
          content: buildMarketMapPrompt(input, targetWords, retryReason),
        },
      ],
    });

    const raw = completion.output ? JSON.parse(completion.output) : null;
    const parsed = raw ? parseMarketMapOutput(raw, template) : null;
    if (!parsed) {
      retryReason = 'output was not valid structured strategic-letter JSON';
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
      format_type: 'strategic-letter',
    });

    const analysis = analyzeMarketMapDraft(parsed.content_blocks);
    const weakDepth = score.breakdown.depth < 16
      || score.issues.some((issue) => issue.category === 'depth')
      || analysis.avgParagraphWords < 90
      || analysis.noticeWords < 55
      || analysis.shiftWords < 70
      || analysis.analysisWords < 145
      || analysis.positioningWords < 100
      || analysis.thesisWords < 68;

    if (weakDepth) {
      try {
        const repair = await runCompletionWithOperation({
          operation: 'blogGeneration',
          companyId: input.company_id,
          model: 'gpt-4o',
          temperature: 0.2,
          response_format: { type: 'json_object' },
          max_tokens: 2400,
          messages: [
            {
              role: 'system',
              content: 'You are a strategy consultant improving depth only. Return only valid JSON. Keep the same thesis and structure while deepening reasoning.',
            },
            {
              role: 'user',
              content: buildMarketMapDepthRepairPrompt(
                input,
                [
                  `depth too weak (${score.breakdown.depth}/20)`,
                  analysis.avgParagraphWords < 90 ? `average paragraph depth too light (${analysis.avgParagraphWords} words)` : '',
                  analysis.noticeWords < 55 ? `strong-teams-notice section too thin (${analysis.noticeWords} words)` : '',
                  analysis.shiftWords < 70 ? `shift section too thin (${analysis.shiftWords} words)` : '',
                  analysis.analysisWords < 145 ? `analysis section too thin (${analysis.analysisWords} words)` : '',
                  analysis.positioningWords < 100 ? `positioning section too thin (${analysis.positioningWords} words)` : '',
                  analysis.thesisWords < 68 ? `thesis section too thin (${analysis.thesisWords} words)` : '',
                ].filter(Boolean).join('; '),
                parsed,
              ),
            },
          ],
        });

        const repairRaw = repair.output ? JSON.parse(repair.output) : null;
        if (repairRaw && typeof repairRaw === 'object') {
          const repairedBlocks = applyMarketMapDepthRepair(parsed.content_blocks, repairRaw);
          const repairedScore = calculateNewsletterQualityScore(repairedBlocks, {
            title: parsed.title,
            excerpt: parsed.excerpt,
            seo_meta_title: parsed.seo_meta_title,
            seo_meta_description: parsed.seo_meta_description,
            tags: parsed.tags,
            target_word_count: targetWords,
            content_type: 'newsletter',
            format_type: 'strategic-letter',
          });
          const repairedAnalysis = analyzeMarketMapDraft(repairedBlocks);
          const repairedComposite = repairedScore.breakdown.depth * 3 + repairedAnalysis.analysisWords + repairedAnalysis.positioningWords + repairedAnalysis.thesisWords;
          const originalComposite = score.breakdown.depth * 3 + analysis.analysisWords + analysis.positioningWords + analysis.thesisWords;
          if (repairedComposite > originalComposite) {
            parsed.content_blocks = repairedBlocks;
          }
        }
      } catch {
        // Best-effort repair only
      }
    }

    const interimScore = calculateNewsletterQualityScore(parsed.content_blocks, {
      title: parsed.title,
      excerpt: parsed.excerpt,
      seo_meta_title: parsed.seo_meta_title,
      seo_meta_description: parsed.seo_meta_description,
      tags: parsed.tags,
      target_word_count: targetWords,
      content_type: 'newsletter',
      format_type: 'strategic-letter',
    });
    const repairedAnalysis = analyzeMarketMapDraft(parsed.content_blocks);
    const stillWeakAfterRepair = interimScore.breakdown.depth < 17
      || repairedAnalysis.avgParagraphWords < 95
      || repairedAnalysis.noticeWords < 65
      || repairedAnalysis.shiftWords < 80
      || repairedAnalysis.analysisWords < 175
      || repairedAnalysis.positioningWords < 115
      || repairedAnalysis.thesisWords < 80;

    if (stillWeakAfterRepair) {
      try {
        const secondRepair = await runCompletionWithOperation({
          operation: 'blogGeneration',
          companyId: input.company_id,
          model: 'gpt-4o',
          temperature: 0.15,
          response_format: { type: 'json_object' },
          max_tokens: 3000,
          messages: [
            {
              role: 'system',
              content: 'You are a top-tier strategy consultant improving only depth. Return only valid JSON. Keep the thesis and structure fixed, but make the strategic reasoning more rigorous, more differentiated, and more decision-grade.',
            },
            {
              role: 'user',
              content: buildMarketMapDepthRepairPrompt(
                input,
                [
                  'depth still below target after first repair',
                  repairedAnalysis.avgParagraphWords < 95 ? `average paragraph depth still too light (${repairedAnalysis.avgParagraphWords} words)` : '',
                  repairedAnalysis.noticeWords < 65 ? `strong-teams-notice section still too thin (${repairedAnalysis.noticeWords} words)` : '',
                  repairedAnalysis.shiftWords < 80 ? `shift section still too thin (${repairedAnalysis.shiftWords} words)` : '',
                  repairedAnalysis.analysisWords < 175 ? `analysis still too thin (${repairedAnalysis.analysisWords} words)` : '',
                  repairedAnalysis.positioningWords < 115 ? `positioning still too thin (${repairedAnalysis.positioningWords} words)` : '',
                  repairedAnalysis.thesisWords < 80 ? `thesis still too thin (${repairedAnalysis.thesisWords} words)` : '',
                ].filter(Boolean).join('; '),
                parsed,
              ),
            },
          ],
        });

        const secondRepairRaw = secondRepair.output ? JSON.parse(secondRepair.output) : null;
        if (secondRepairRaw && typeof secondRepairRaw === 'object') {
          const secondRepairedBlocks = applyMarketMapDepthRepair(parsed.content_blocks, secondRepairRaw);
          const secondScore = calculateNewsletterQualityScore(secondRepairedBlocks, {
            title: parsed.title,
            excerpt: parsed.excerpt,
            seo_meta_title: parsed.seo_meta_title,
            seo_meta_description: parsed.seo_meta_description,
            tags: parsed.tags,
            target_word_count: targetWords,
            content_type: 'newsletter',
            format_type: 'strategic-letter',
          });
          const secondAnalysis = analyzeMarketMapDraft(secondRepairedBlocks);
          const secondComposite = secondScore.breakdown.depth * 3 + secondAnalysis.analysisWords + secondAnalysis.positioningWords + secondAnalysis.thesisWords;
          const currentComposite = interimScore.breakdown.depth * 3 + repairedAnalysis.analysisWords + repairedAnalysis.positioningWords + repairedAnalysis.thesisWords;
          if (secondComposite > currentComposite) {
            parsed.content_blocks = secondRepairedBlocks;
          }
        }
      } catch {
        // Best-effort second repair only
      }
    }

    const preFinalScore = calculateNewsletterQualityScore(parsed.content_blocks, {
      title: parsed.title,
      excerpt: parsed.excerpt,
      seo_meta_title: parsed.seo_meta_title,
      seo_meta_description: parsed.seo_meta_description,
      tags: parsed.tags,
      target_word_count: targetWords,
      content_type: 'newsletter',
      format_type: 'strategic-letter',
    });
    const preFinalAnalysis = analyzeMarketMapDraft(parsed.content_blocks);
    const stillMateriallyWeak = preFinalScore.breakdown.depth < 17
      || preFinalAnalysis.noticeWords < 75
      || preFinalAnalysis.shiftWords < 90
      || preFinalAnalysis.analysisWords < 185
      || preFinalAnalysis.positioningWords < 120
      || preFinalAnalysis.thesisWords < 85;

    if (stillMateriallyWeak) {
      try {
        const focusedRepair = await runCompletionWithOperation({
          operation: 'blogGeneration',
          companyId: input.company_id,
          model: 'gpt-4o',
          temperature: 0.1,
          response_format: { type: 'json_object' },
          max_tokens: 2400,
          messages: [
            {
              role: 'system',
              content: 'You are a senior strategy consultant rewriting only the strategic core of a market map. Return only valid JSON. Make it sharper, more insightful, and more decision-grade.',
            },
            {
              role: 'user',
              content: buildMarketMapFocusedBodyPrompt(
                input,
                [
                  `depth still materially weak (${preFinalScore.breakdown.depth}/20)`,
                  preFinalAnalysis.noticeWords < 75 ? `strong-teams-notice still too thin (${preFinalAnalysis.noticeWords} words)` : '',
                  preFinalAnalysis.shiftWords < 90 ? `shift still too thin (${preFinalAnalysis.shiftWords} words)` : '',
                  preFinalAnalysis.analysisWords < 185 ? `analysis still too thin (${preFinalAnalysis.analysisWords} words)` : '',
                  preFinalAnalysis.positioningWords < 120 ? `positioning still too thin (${preFinalAnalysis.positioningWords} words)` : '',
                  preFinalAnalysis.thesisWords < 85 ? `thesis still too thin (${preFinalAnalysis.thesisWords} words)` : '',
                ].filter(Boolean).join('; '),
                parsed,
              ),
            },
          ],
        });

        const focusedRaw = focusedRepair.output ? JSON.parse(focusedRepair.output) : null;
        if (focusedRaw && typeof focusedRaw === 'object') {
          const focusedBlocks = applyMarketMapDepthRepair(parsed.content_blocks, focusedRaw);
          const focusedScore = calculateNewsletterQualityScore(focusedBlocks, {
            title: parsed.title,
            excerpt: parsed.excerpt,
            seo_meta_title: parsed.seo_meta_title,
            seo_meta_description: parsed.seo_meta_description,
            tags: parsed.tags,
            target_word_count: targetWords,
            content_type: 'newsletter',
            format_type: 'strategic-letter',
          });
          const focusedAnalysis = analyzeMarketMapDraft(focusedBlocks);
          const focusedComposite = focusedScore.breakdown.depth * 4
            + focusedAnalysis.noticeWords
            + focusedAnalysis.analysisWords
            + focusedAnalysis.positioningWords
            + focusedAnalysis.thesisWords;
          const currentComposite = preFinalScore.breakdown.depth * 4
            + preFinalAnalysis.noticeWords
            + preFinalAnalysis.analysisWords
            + preFinalAnalysis.positioningWords
            + preFinalAnalysis.thesisWords;
          if (focusedComposite > currentComposite) {
            parsed.content_blocks = focusedBlocks;
          }
        }
      } catch {
        // Best-effort focused repair only
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
      format_type: 'strategic-letter',
    });
    const finalAnalysis = analyzeMarketMapDraft(parsed.content_blocks);
    const finalWeakDepth = finalScore.breakdown.depth < 17
      || finalScore.issues.some((issue) => issue.category === 'depth')
      || finalAnalysis.avgParagraphWords < 95
      || finalAnalysis.paragraphCount < 7
      || finalAnalysis.noticeWords < 65
      || finalAnalysis.shiftWords < 90
      || finalAnalysis.analysisWords < 175
      || finalAnalysis.positioningWords < 115
      || finalAnalysis.thesisWords < 80;

    const composite = finalScore.breakdown.structure * 3 + finalScore.breakdown.depth * 3 + finalScore.breakdown.geo * 3 + finalScore.breakdown.seo;
    if (composite > bestScore) {
      bestScore = composite;
      best = parsed;
    }

    if (!finalWeakDepth) {
      return {
        needs_clarification: false,
        mode: 'full',
        confidence: 'high',
        template_used: true,
        hook_assessment: { strength: 'moderate', note: 'Newsletter-owned market map generation path used.' },
        result: parsed,
      };
    }

    retryReason = [
      `depth too weak (${finalScore.breakdown.depth}/20)`,
      finalAnalysis.avgParagraphWords < 95 ? `average paragraph depth too light (${finalAnalysis.avgParagraphWords} words)` : '',
      finalAnalysis.paragraphCount < 7 ? `not enough substantive body paragraphs (${finalAnalysis.paragraphCount})` : '',
      finalAnalysis.noticeWords < 65 ? `strong-teams-notice section too thin (${finalAnalysis.noticeWords} words)` : '',
      finalAnalysis.shiftWords < 90 ? `shift section too thin (${finalAnalysis.shiftWords} words)` : '',
      finalAnalysis.analysisWords < 175 ? `analysis section too thin (${finalAnalysis.analysisWords} words)` : '',
      finalAnalysis.positioningWords < 115 ? `positioning section too thin (${finalAnalysis.positioningWords} words)` : '',
      finalAnalysis.thesisWords < 80 ? `thesis section too thin (${finalAnalysis.thesisWords} words)` : '',
    ].filter(Boolean).join('; ');
  }

  if (best) {
    return {
      needs_clarification: false,
      mode: 'full',
      confidence: 'medium',
      template_used: true,
      hook_assessment: { strength: 'moderate', note: 'Newsletter-owned market map generation path used.' },
      result: best,
    };
  }

  throw new Error('Failed to generate Market Map newsletter');
}
