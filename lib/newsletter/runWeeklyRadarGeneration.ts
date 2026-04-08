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
- week_summary_html should be 2-3 lines with meaning, not recap
- pattern_html should explain the larger pattern, not repeat the signals
- quick_takes should contain ${targetWords >= 1600 ? 6 : 4} analytical bullets
- references should contain at least ${targetWords >= 1600 ? 3 : 2} credible items
- why_it_matters_html must be at least as strong as what_happened_html
- key_insights must be dense standalone takeaways`;
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

function parseWeeklyRadarOutput(raw: any, template: ContentBlock[], signalCount: number) {
  if (!raw || typeof raw !== 'object') return null;
  if (!Array.isArray(raw.signals) || raw.signals.length !== signalCount) return null;

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
      const signal = raw.signals[signalIndex];
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

function analyzeWeeklyRadarDraft(blocks: ContentBlock[]) {
  const flat = flattenBlocks(blocks);
  const paragraphs = flat.filter((block): block is ParagraphBlock => block.type === 'paragraph');
  const references = flat.filter((block): block is ReferencesBlock => block.type === 'references');
  const summaries = flat.filter((block): block is SummaryBlock => block.type === 'summary');
  const insights = flat.filter((block): block is KeyInsightsBlock => block.type === 'key_insights');
  const lists = flat.filter((block): block is ListBlock => block.type === 'list');
  const columns = flat.filter((block): block is ColumnsBlock => block.type === 'columns');

  const paragraphWordCounts = paragraphs.map((block) => block.html.replace(/<[^>]+>/g, ' ').trim().split(/\s+/).filter(Boolean).length);
  const avgParagraphWords = paragraphWordCounts.length
    ? Math.round(paragraphWordCounts.reduce((sum, count) => sum + count, 0) / paragraphWordCounts.length)
    : 0;
  const filledReferences = references.reduce((sum, block) => sum + block.items.filter((item) => item.title.trim() || item.url.trim()).length, 0);
  const filledQuickTakes = lists.reduce((sum, block) => sum + block.items.filter((item) => item.text.trim().length >= 12).length, 0);
  const strongSignals = columns.filter((columnBlock) =>
    columnBlock.columns.every((column) =>
      column.blocks.some((inner) => inner.type === 'paragraph' && inner.html.replace(/<[^>]+>/g, ' ').trim().split(/\s+/).filter(Boolean).length >= 40),
    ),
  ).length;

  return {
    avgParagraphWords,
    filledReferences,
    filledQuickTakes,
    strongSignals,
    summaryOk: summaries.some((block) => block.body.trim().split(/\s+/).filter(Boolean).length >= 24),
    insightsOk: insights.some((block) => block.items.filter((item) => item.trim().length >= 18).length >= 3),
  };
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

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const completion = await runCompletionWithOperation({
      operation: 'blogGeneration',
      companyId: input.company_id,
      model: 'gpt-4o',
      temperature: 0.25,
      response_format: { type: 'json_object' },
      max_tokens: targetWords >= 1600 ? 5200 : 4200,
      messages: [
        {
          role: 'system',
          content: 'You are a senior newsletter editor writing a weekly brief. Return only valid JSON. Prioritize signal over noise and always interpret what matters.',
        },
        {
          role: 'user',
          content: buildWeeklyRadarPrompt(input, targetWords, signalCount, retryReason),
        },
      ],
    });

    const raw = completion.output ? JSON.parse(completion.output) : null;
    const parsed = raw ? parseWeeklyRadarOutput(raw, template, signalCount) : null;
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
    const weakStructure = score.breakdown.structure < 20 || score.issues.some((issue) => issue.category === 'structure') || !analysis.insightsOk || analysis.strongSignals < signalCount;
    const weakDepth = score.breakdown.depth < 14 || score.issues.some((issue) => issue.category === 'depth') || analysis.avgParagraphWords < 70;
    const weakGeo = score.breakdown.geo < 14 || score.issues.some((issue) => issue.category === 'geo') || analysis.filledReferences < (targetWords >= 1600 ? 3 : 2) || !analysis.summaryOk;

    const composite = score.breakdown.structure * 3 + score.breakdown.depth * 3 + score.breakdown.geo * 3 + score.breakdown.seo;
    if (composite > bestScore) {
      bestScore = composite;
      best = parsed;
    }

    if (!weakStructure && !weakDepth && !weakGeo) {
      return {
        needs_clarification: false,
        mode: 'full',
        confidence: 'high',
        template_used: true,
        hook_assessment: { strength: 'moderate', note: 'Newsletter-owned weekly radar generation path used.' },
        result: parsed,
      };
    }

    retryReason = [
      weakStructure ? `structure too weak (${score.breakdown.structure}/25)` : '',
      weakDepth ? `depth too weak (${score.breakdown.depth}/20)` : '',
      weakGeo ? `GEO too weak (${score.breakdown.geo}/20)` : '',
      analysis.strongSignals < signalCount ? `not all signals are fully developed (${analysis.strongSignals}/${signalCount})` : '',
      analysis.avgParagraphWords < 70 ? `paragraph depth too light (${analysis.avgParagraphWords} words)` : '',
      analysis.filledReferences < (targetWords >= 1600 ? 3 : 2) ? 'references are too weak' : '',
      !analysis.summaryOk ? 'summary is too thin' : '',
      !analysis.insightsOk ? 'key insights are too weak' : '',
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
    };
  }

  throw new Error('Failed to generate Signal Radar newsletter');
}

