import { runCompletionWithOperation } from '../../backend/services/aiGateway';
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

function getTargetWords(input: NewsletterGenerationRequest): number {
  const raw = input.answers?.target_word_count;
  return raw ? parseInt(String(raw), 10) || 1600 : 1600;
}

function getStrategyMemoTemplate(input: NewsletterGenerationRequest): ContentBlock[] {
  if (Array.isArray(input.template_blocks) && input.template_blocks.length > 0) {
    return input.template_blocks as ContentBlock[];
  }
  const template = getDefaultNewsletterTemplates().find((item) => item.name.toLowerCase() === 'strategy memo');
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

function buildStrategyMemoPrompt(
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
- shift_html should be about ${deeperTier ? '90-140' : '70-110'} words
- forces_at_play_html should be about ${deeperTier ? '110-170' : '85-130'} words
- why_it_matters_now_html should be about ${deeperTier ? '90-140' : '70-110'} words
- analysis_html should be about ${deeperTier ? '220-320' : '170-260'} words
- positioning_html should be about ${deeperTier ? '140-210' : '110-170'} words
- thesis_html should be about ${deeperTier ? '90-130' : '70-100'} words
- return only valid JSON`;
}

function parseStrategyMemoOutput(raw: any, template: ContentBlock[]) {
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

function analyzeStrategyMemoDraft(blocks: ContentBlock[]) {
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

function buildStrategyMemoDepthRepairPrompt(
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
- every rewritten section should feel like a memo for operators making a real decision, not commentary for observers
- keep the same underlying thesis, but make the reasoning more developed
- return only valid JSON`;
}

function buildStrategyMemoFocusedBodyPrompt(
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

function applyStrategyMemoDepthRepair(
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

export async function runStrategyMemoGeneration(
  input: NewsletterGenerationRequest,
): Promise<NewsletterGenerationResult> {
  const template = getStrategyMemoTemplate(input);
  const targetWords = getTargetWords(input);
  let retryReason: string | undefined;
  let best: ReturnType<typeof parseStrategyMemoOutput> | null = null;
  let bestScore = -1;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const completion = await runCompletionWithOperation({
      operation: 'blogGeneration',
      companyId: input.company_id,
      model: 'gpt-4o',
      temperature: 0.25,
      response_format: { type: 'json_object' },
      max_tokens: targetWords >= 2000 ? 5400 : 4400,
      messages: [
        {
          role: 'system',
          content: 'You are a strategy consultant writing a strategy memo newsletter. Return only valid JSON. Focus on deep strategic logic, leverage, and clear market positioning.',
        },
        {
          role: 'user',
          content: buildStrategyMemoPrompt(input, targetWords, retryReason),
        },
      ],
    });

    const raw = completion.output ? JSON.parse(completion.output) : null;
    const parsed = raw ? parseStrategyMemoOutput(raw, template) : null;
    if (!parsed) {
      retryReason = 'output was not valid structured strategy memo JSON';
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

    const analysis = analyzeStrategyMemoDraft(parsed.content_blocks);
    const weakDepth = score.breakdown.depth < 16
      || score.issues.some((issue) => issue.category === 'depth')
      || analysis.avgParagraphWords < 90
      || analysis.paragraphCount < 7
      || analysis.calloutWords < 14
      || analysis.moveCount < 3
      || analysis.avgStrategicMoveWords < 11
      || analysis.analysisWords < 150
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
          max_tokens: 2600,
          messages: [
            {
              role: 'system',
              content: 'You are a strategy consultant improving memo depth only. Return only valid JSON. Keep the same thesis and structure while deepening reasoning.',
            },
            {
              role: 'user',
              content: buildStrategyMemoDepthRepairPrompt(
                input,
                [
                  `depth too weak (${score.breakdown.depth}/20)`,
                  analysis.avgParagraphWords < 90 ? `average paragraph depth too light (${analysis.avgParagraphWords} words)` : '',
                  analysis.paragraphCount < 7 ? `not enough substantive body paragraphs (${analysis.paragraphCount})` : '',
                  analysis.calloutWords < 14 ? `lead callout too light (${analysis.calloutWords} words)` : '',
                  analysis.moveCount < 3 ? `not enough substantive strategic moves (${analysis.moveCount})` : '',
                  analysis.avgStrategicMoveWords < 11 ? `strategic moves too generic on average (${analysis.avgStrategicMoveWords} words)` : '',
                  analysis.analysisWords < 150 ? `analysis section too thin (${analysis.analysisWords} words)` : '',
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
          const repairedBlocks = applyStrategyMemoDepthRepair(parsed.content_blocks, repairRaw);
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
          const repairedAnalysis = analyzeStrategyMemoDraft(repairedBlocks);
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
    const repairedAnalysis = analyzeStrategyMemoDraft(parsed.content_blocks);
    const stillWeakAfterRepair = interimScore.breakdown.depth < 17
      || repairedAnalysis.avgParagraphWords < 95
      || repairedAnalysis.calloutWords < 18
      || repairedAnalysis.moveCount < 3
      || repairedAnalysis.avgStrategicMoveWords < 14
      || repairedAnalysis.analysisWords < 180
      || repairedAnalysis.positioningWords < 120
      || repairedAnalysis.thesisWords < 85;

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
              content: 'You are a top-tier strategy consultant improving only depth. Return only valid JSON. Do not change the thesis, but make the reasoning more rigorous, concrete, and decision-grade.',
            },
            {
              role: 'user',
              content: buildStrategyMemoDepthRepairPrompt(
                input,
                [
                  `depth still below target after first repair`,
                  repairedAnalysis.avgParagraphWords < 95 ? `average paragraph depth still too light (${repairedAnalysis.avgParagraphWords} words)` : '',
                  repairedAnalysis.calloutWords < 18 ? `lead callout still too light (${repairedAnalysis.calloutWords} words)` : '',
                  repairedAnalysis.moveCount < 3 ? `strategic moves still too few (${repairedAnalysis.moveCount})` : '',
                  repairedAnalysis.avgStrategicMoveWords < 14 ? `strategic moves still too generic on average (${repairedAnalysis.avgStrategicMoveWords} words)` : '',
                  repairedAnalysis.analysisWords < 180 ? `analysis still too thin (${repairedAnalysis.analysisWords} words)` : '',
                  repairedAnalysis.positioningWords < 120 ? `positioning still too thin (${repairedAnalysis.positioningWords} words)` : '',
                  repairedAnalysis.thesisWords < 85 ? `thesis still too thin (${repairedAnalysis.thesisWords} words)` : '',
                ].filter(Boolean).join('; '),
                parsed,
              ),
            },
          ],
        });

        const secondRepairRaw = secondRepair.output ? JSON.parse(secondRepair.output) : null;
        if (secondRepairRaw && typeof secondRepairRaw === 'object') {
          const secondRepairedBlocks = applyStrategyMemoDepthRepair(parsed.content_blocks, secondRepairRaw);
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
          const secondAnalysis = analyzeStrategyMemoDraft(secondRepairedBlocks);
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
    const preFinalAnalysis = analyzeStrategyMemoDraft(parsed.content_blocks);
    const stillMateriallyWeak = preFinalScore.breakdown.depth < 18
      || preFinalAnalysis.analysisWords < 190
      || preFinalAnalysis.positioningWords < 125
      || preFinalAnalysis.thesisWords < 90
      || preFinalAnalysis.avgStrategicMoveWords < 15;

    if (stillMateriallyWeak) {
      try {
        const focusedRepair = await runCompletionWithOperation({
          operation: 'blogGeneration',
          companyId: input.company_id,
          model: 'gpt-4o',
          temperature: 0.1,
          response_format: { type: 'json_object' },
          max_tokens: 2600,
          messages: [
            {
              role: 'system',
              content: 'You are a senior strategy consultant rewriting only the strategic core of a memo. Return only valid JSON. Make the logic deeper, sharper, and more decision-grade.',
            },
            {
              role: 'user',
              content: buildStrategyMemoFocusedBodyPrompt(
                input,
                [
                  `depth still materially weak (${preFinalScore.breakdown.depth}/20)`,
                  preFinalAnalysis.analysisWords < 190 ? `analysis still too thin (${preFinalAnalysis.analysisWords} words)` : '',
                  preFinalAnalysis.positioningWords < 125 ? `positioning still too thin (${preFinalAnalysis.positioningWords} words)` : '',
                  preFinalAnalysis.thesisWords < 90 ? `thesis still too thin (${preFinalAnalysis.thesisWords} words)` : '',
                  preFinalAnalysis.avgStrategicMoveWords < 15 ? `strategic moves still too generic on average (${preFinalAnalysis.avgStrategicMoveWords} words)` : '',
                ].filter(Boolean).join('; '),
                parsed,
              ),
            },
          ],
        });

        const focusedRaw = focusedRepair.output ? JSON.parse(focusedRepair.output) : null;
        if (focusedRaw && typeof focusedRaw === 'object') {
          const focusedBlocks = applyStrategyMemoDepthRepair(parsed.content_blocks, focusedRaw);
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
          const focusedAnalysis = analyzeStrategyMemoDraft(focusedBlocks);
          const focusedComposite = focusedScore.breakdown.depth * 4
            + focusedAnalysis.analysisWords
            + focusedAnalysis.positioningWords
            + focusedAnalysis.thesisWords
            + focusedAnalysis.avgStrategicMoveWords * 4;
          const currentComposite = preFinalScore.breakdown.depth * 4
            + preFinalAnalysis.analysisWords
            + preFinalAnalysis.positioningWords
            + preFinalAnalysis.thesisWords
            + preFinalAnalysis.avgStrategicMoveWords * 4;
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
    const finalAnalysis = analyzeStrategyMemoDraft(parsed.content_blocks);
    const finalWeakDepth = finalScore.breakdown.depth < 18
      || finalScore.issues.some((issue) => issue.category === 'depth')
      || finalAnalysis.avgParagraphWords < 98
      || finalAnalysis.paragraphCount < 7
      || finalAnalysis.calloutWords < 18
      || finalAnalysis.moveCount < 3
      || finalAnalysis.avgStrategicMoveWords < 14
      || finalAnalysis.analysisWords < 180
      || finalAnalysis.positioningWords < 120
      || finalAnalysis.thesisWords < 85;

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
        hook_assessment: { strength: 'moderate', note: 'Newsletter-owned strategy memo generation path used.' },
        result: parsed,
      };
    }

    retryReason = [
      `depth too weak (${finalScore.breakdown.depth}/20)`,
      finalAnalysis.avgParagraphWords < 98 ? `average paragraph depth too light (${finalAnalysis.avgParagraphWords} words)` : '',
      finalAnalysis.paragraphCount < 7 ? `not enough substantive body paragraphs (${finalAnalysis.paragraphCount})` : '',
      finalAnalysis.calloutWords < 18 ? `lead callout too light (${finalAnalysis.calloutWords} words)` : '',
      finalAnalysis.moveCount < 3 ? `not enough substantive strategic moves (${finalAnalysis.moveCount})` : '',
      finalAnalysis.avgStrategicMoveWords < 14 ? `strategic moves too generic on average (${finalAnalysis.avgStrategicMoveWords} words)` : '',
      finalAnalysis.analysisWords < 180 ? `analysis section too thin (${finalAnalysis.analysisWords} words)` : '',
      finalAnalysis.positioningWords < 120 ? `positioning section too thin (${finalAnalysis.positioningWords} words)` : '',
      finalAnalysis.thesisWords < 85 ? `thesis section too thin (${finalAnalysis.thesisWords} words)` : '',
    ].filter(Boolean).join('; ');
  }

  if (best) {
    return {
      needs_clarification: false,
      mode: 'full',
      confidence: 'medium',
      template_used: true,
      hook_assessment: { strength: 'moderate', note: 'Newsletter-owned strategy memo generation path used.' },
      result: best,
    };
  }

  throw new Error('Failed to generate Strategy Memo newsletter');
}
