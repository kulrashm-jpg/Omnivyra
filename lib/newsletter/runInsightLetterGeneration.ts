import { runCompletionWithOperation } from '../../backend/services/aiGateway';
import { instantiateNewsletterTemplate, getDefaultNewsletterTemplates } from './defaultNewsletterTemplates';
import { calculateNewsletterQualityScore } from './newsletterValidation';
import type { NewsletterGenerationRequest, NewsletterGenerationResult } from './runNewsletterGeneration';
import type {
  ContentBlock,
  HeadingBlock,
  ParagraphBlock,
  KeyInsightsBlock,
  CalloutBlock,
  QuoteBlock,
  SummaryBlock,
  ColumnsBlock,
  ListBlock,
  ReferencesBlock,
} from '../content/blockTypes';
import { flattenBlocks } from '../content/blockUtils';

function getTargetWords(input: NewsletterGenerationRequest): number {
  const raw = input.answers?.target_word_count;
  return raw ? parseInt(String(raw), 10) || 1200 : 1200;
}

function getMinimalThesisTemplate(input: NewsletterGenerationRequest): ContentBlock[] {
  if (Array.isArray(input.template_blocks) && input.template_blocks.length > 0) {
    return input.template_blocks as ContentBlock[];
  }
  const template = getDefaultNewsletterTemplates().find((item) => item.name.toLowerCase() === 'minimal thesis');
  return template ? instantiateNewsletterTemplate(template, getTargetWords(input)) : [];
}


function buildMinimalThesisSectionPrompt(
  input: NewsletterGenerationRequest,
  targetWords: number,
  retryReason?: string,
): string {
  const sections: string[] = [];
  sections.push(`TOPIC: ${input.topic}`);
  sections.push(`TARGET WORD COUNT: ${targetWords} words minimum`);
  if (input.selected_angle) {
    sections.push(`ANGLE TITLE: ${input.selected_angle.title}`);
    sections.push(`ANGLE SUMMARY: ${input.selected_angle.angle_summary}`);
  }
  if (input.answers?.uniqueness_directive) sections.push(`UNIQUENESS DIRECTIVE: ${input.answers.uniqueness_directive}`);
  if (input.answers?.must_include_points) sections.push(`MUST-INCLUDE POINTS: ${input.answers.must_include_points}`);
  if (input.answers?.campaign_objective) sections.push(`CAMPAIGN OBJECTIVE: ${input.answers.campaign_objective}`);
  if (input.answers?.trend_context) sections.push(`TREND CONTEXT: ${input.answers.trend_context}`);
  if (input.companyContext?.audience) sections.push(`AUDIENCE: ${input.companyContext.audience}`);
  if (input.companyContext?.brand_voice) sections.push(`BRAND VOICE: ${input.companyContext.brand_voice}`);
  if (input.companyContext?.industry) sections.push(`INDUSTRY: ${input.companyContext.industry}`);
  if (input.companyContext?.writingStyleInstructions) {
    sections.push(`WRITING STYLE GUIDE:\n${input.companyContext.writingStyleInstructions}`);
  }
  if (retryReason) sections.push(`PREVIOUS DRAFT FAILED BECAUSE: ${retryReason}`);

  const deeperTier = targetWords >= 1600;

  return `${sections.join('\n\n')}

YOUR TASK:
Write a high-quality "Minimal Thesis" Insight Letter. Generate a structured JSON object with named fields, not a generic block list.

HARD RULES:
- This must feel like original thinking, not a recap.
- Keep the visible sequence: Hook, Context, Insight, Expansion, Implication, Closing.
- Make structure obvious, depth real, and GEO extraction strong.
- Use HTML strings with <p> tags for all *_html fields.
- Every major section should feel complete on its own.
- Use at least one grounded example, observed pattern, or realistic scenario.
- Fill both callouts, the quote, the key insights, and the summary with distinct extractable value.
- Do not write neat but shallow sections. The body must feel argued, not summarized.
- Do not use markdown fences.

SECTION REQUIREMENTS:
- hook_html: 2 short paragraphs with tension, a challenged assumption, and a reason to keep reading.
- context_html: explain why this matters now with concrete stakes and a recognizable scenario.
- insight_html: explain the real mechanism with a reusable lens or mental model. Use ${deeperTier ? 'at least 2 paragraphs and about 140-220 words' : 'at least 2 paragraphs and about 120-180 words'}.
- evidence_html: give one grounded example, observed pattern, or realistic scenario that proves the thesis. Use ${deeperTier ? 'about 110-180 words' : 'about 90-150 words'}.
- expansion_html: add the deeper layer, second-order effect, or hidden dynamic. Use ${deeperTier ? 'about 120-180 words' : 'about 90-140 words'}.
- implication_html: explain the practical decision shift or operating consequence for the reader. Use ${deeperTier ? 'about 120-180 words' : 'about 90-140 words'} and include a clear operating takeaway.
- closing_html: end with a memorable line worth forwarding.
- thesis_callout: one-sentence high-conviction thesis.
- practical_shift_callout: one-sentence operating change or decision lens.
- quote_text: one sharp quote-worthy line capturing the thesis.
- key_insights: ${deeperTier ? '5-6' : '4-5'} dense standalone takeaways.
- summary_body: 2-3 sentence standalone synthesis suitable for inbox previews and AI answers.

RETURN JSON WITH EXACTLY THESE FIELDS:
{
  "title": "string",
  "excerpt": "string",
  "seo_meta_title": "string",
  "seo_meta_description": "string",
  "tags": ["string"],
  "thesis_callout": "string",
  "practical_shift_callout": "string",
  "quote_text": "string",
  "quote_author": "string",
  "quote_source": "string",
  "key_insights": ["string"],
  "hook_html": "string with <p> tags",
  "context_html": "string with <p> tags",
  "insight_html": "string with <p> tags",
  "evidence_html": "string with <p> tags",
  "expansion_html": "string with <p> tags",
  "implication_html": "string with <p> tags",
  "closing_html": "string with <p> tags",
  "summary_body": "string"
}`;
}

function normalizeParagraphHtml(aiData: any): string {
  const rawText =
    typeof aiData?.html === 'string' ? aiData.html :
    typeof aiData?.text === 'string' ? aiData.text :
    typeof aiData?.body === 'string' ? aiData.body :
    typeof aiData?.content === 'string' ? aiData.content :
    typeof aiData?.value === 'string' ? aiData.value :
    '';
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

function normalizeHeadingText(tpl: HeadingBlock, aiData: any): string {
  if (typeof tpl.text === 'string' && tpl.text.trim()) return tpl.text;
  const value =
    typeof aiData?.text === 'string' ? aiData.text :
    typeof aiData?.title === 'string' ? aiData.title :
    typeof aiData?.heading === 'string' ? aiData.heading :
    typeof aiData?.label === 'string' ? aiData.label :
    '';
  return value.trim();
}

function mergeBlockContent(tplBlock: ContentBlock, aiData: any): ContentBlock {
  switch (tplBlock.type) {
    case 'paragraph':
      return { ...tplBlock, html: normalizeParagraphHtml(aiData) } as ParagraphBlock;
    case 'heading':
      return { ...tplBlock, text: normalizeHeadingText(tplBlock, aiData), anchor: '' } as HeadingBlock;
    case 'key_insights':
      return {
        ...tplBlock,
        items: Array.isArray(aiData?.items)
          ? aiData.items.map((item: any) => String(typeof item === 'string' ? item : item?.text || '').trim())
          : tplBlock.items,
      } as KeyInsightsBlock;
    case 'callout':
      return {
        ...tplBlock,
        title: typeof aiData?.title === 'string' ? aiData.title : '',
        body: typeof aiData?.body === 'string' ? aiData.body : typeof aiData?.text === 'string' ? aiData.text : '',
      } as CalloutBlock;
    case 'quote':
      return {
        ...tplBlock,
        text: typeof aiData?.text === 'string' ? aiData.text : typeof aiData?.quote === 'string' ? aiData.quote : '',
        author: typeof aiData?.author === 'string' ? aiData.author : '',
        source: typeof aiData?.source === 'string' ? aiData.source : '',
      } as QuoteBlock;
    case 'summary':
      return {
        ...tplBlock,
        body: typeof aiData?.body === 'string' ? aiData.body : typeof aiData?.text === 'string' ? aiData.text : '',
      } as SummaryBlock;
    case 'list':
      return {
        ...tplBlock,
        items: Array.isArray(aiData?.items)
          ? aiData.items.map((item: any, index: number) => ({
              id: tplBlock.items[index]?.id ?? `item-${index}`,
              text: typeof item === 'string' ? item : item?.text || '',
            }))
          : tplBlock.items,
      } as ListBlock;
    case 'references':
      return {
        ...tplBlock,
        items: Array.isArray(aiData?.items)
          ? aiData.items.map((item: any, index: number) => ({
              id: tplBlock.items[index]?.id ?? `ref-${index}`,
              title: typeof item === 'string' ? item : item?.title || item?.text || '',
              url: typeof item === 'string' ? '' : item?.url || item?.href || '',
            }))
          : tplBlock.items,
      } as ReferencesBlock;
    case 'columns': {
      const aiColumns = Array.isArray(aiData?.columns) ? aiData.columns : [];
      return {
        ...tplBlock,
        columns: tplBlock.columns.map((col, index) => ({
          ...col,
          blocks: col.blocks.map((inner, innerIndex) => mergeBlockContent(inner, aiColumns[index]?.blocks?.[innerIndex] || aiColumns[index]?.[innerIndex] || {})),
        })),
      } as ColumnsBlock;
    }
    default:
      return tplBlock;
  }
}

function parseMinimalThesisSectionOutput(raw: any, template: ContentBlock[]) {
  if (!raw || typeof raw !== 'object') return null;

  const nextTemplate = template.map((block) => ({ ...block })) as ContentBlock[];
  let calloutIndex = 0;
  let paragraphIndex = 0;

  const paragraphFields = [
    'hook_html',
    'context_html',
    'insight_html',
    'evidence_html',
    'expansion_html',
    'implication_html',
    'closing_html',
  ];

  const contentBlocks = nextTemplate.map((block) => {
    switch (block.type) {
      case 'key_insights':
        return {
          ...block,
          items: Array.isArray(raw.key_insights)
            ? raw.key_insights.map((item: unknown) => String(item ?? '').trim()).filter(Boolean)
            : block.items,
        } as KeyInsightsBlock;
      case 'callout': {
        const body = calloutIndex === 0 ? raw.thesis_callout : raw.practical_shift_callout;
        calloutIndex += 1;
        return {
          ...block,
          title: '',
          body: typeof body === 'string' ? body.trim() : '',
        } as CalloutBlock;
      }
      case 'quote':
        return {
          ...block,
          text: typeof raw.quote_text === 'string' ? raw.quote_text.trim() : '',
          author: typeof raw.quote_author === 'string' ? raw.quote_author.trim() : '',
          source: typeof raw.quote_source === 'string' ? raw.quote_source.trim() : '',
        } as QuoteBlock;
      case 'summary':
        return {
          ...block,
          body: typeof raw.summary_body === 'string' ? raw.summary_body.trim() : '',
        } as SummaryBlock;
      case 'paragraph': {
        const fieldName = paragraphFields[paragraphIndex];
        paragraphIndex += 1;
        return {
          ...block,
          html: normalizeParagraphHtml({ html: typeof fieldName === 'string' ? raw[fieldName] : '' }),
        } as ParagraphBlock;
      }
      default:
        return block;
    }
  });

  return {
    title: typeof raw.title === 'string' ? raw.title : 'Untitled',
    excerpt: typeof raw.excerpt === 'string' ? raw.excerpt : '',
    content_html: '',
    tags: Array.isArray(raw.tags) ? raw.tags.filter((tag: unknown) => typeof tag === 'string') : [],
    category: typeof raw.category === 'string' ? raw.category : '',
    seo_meta_title: typeof raw.seo_meta_title === 'string' ? raw.seo_meta_title : '',
    seo_meta_description: typeof raw.seo_meta_description === 'string' ? raw.seo_meta_description : '',
    key_insights: [],
    content_blocks: contentBlocks,
  };
}

function extractMinimalThesisState(blocks: ContentBlock[]) {
  const flat = flattenBlocks(blocks);
  const paragraphs = flat.filter((block): block is ParagraphBlock => block.type === 'paragraph');
  const callouts = flat.filter((block): block is CalloutBlock => block.type === 'callout');
  const quotes = flat.filter((block): block is QuoteBlock => block.type === 'quote');
  const summaries = flat.filter((block): block is SummaryBlock => block.type === 'summary');
  const keyInsights = flat.filter((block): block is KeyInsightsBlock => block.type === 'key_insights');

  return {
    thesis_callout: callouts[0]?.body ?? '',
    practical_shift_callout: callouts[1]?.body ?? '',
    quote_text: quotes[0]?.text ?? '',
    quote_author: quotes[0]?.author ?? '',
    quote_source: quotes[0]?.source ?? '',
    key_insights: keyInsights[0]?.items ?? [],
    hook_html: paragraphs[0]?.html ?? '',
    context_html: paragraphs[1]?.html ?? '',
    insight_html: paragraphs[2]?.html ?? '',
    evidence_html: paragraphs[3]?.html ?? '',
    expansion_html: paragraphs[4]?.html ?? '',
    implication_html: paragraphs[5]?.html ?? '',
    closing_html: paragraphs[6]?.html ?? '',
    summary_body: summaries[0]?.body ?? '',
  };
}

function buildMinimalThesisDepthRepairPrompt(
  input: NewsletterGenerationRequest,
  targetWords: number,
  state: ReturnType<typeof extractMinimalThesisState>,
  retryReason: string,
): string {
  const deeperTier = targetWords >= 1600;
  return `TOPIC: ${input.topic}

REPAIR GOAL:
The structure and extraction surfaces are acceptable, but the BODY DEPTH is still too weak.
You must deepen the body sections while preserving the thesis, key insights, quote, callouts, and overall sequence.

CURRENT THESIS CALLOUT:
${state.thesis_callout}

CURRENT PRACTICAL-SHIFT CALLOUT:
${state.practical_shift_callout}

CURRENT QUOTE:
${state.quote_text}

CURRENT KEY INSIGHTS:
${state.key_insights.join('\n- ')}

CURRENT SUMMARY:
${state.summary_body}

WHY THE DRAFT WAS REJECTED:
${retryReason}

DEPTH RULES:
- Keep the same visible sequence: Hook, Context, Insight, Expansion, Implication, Closing.
- Do not rewrite the thesis into something different.
- Make the body feel argued, not summarized.
- Add mechanism, example, second-order effect, and practical implication.
- Use HTML strings with <p> tags only.
- Make each section denser and more complete.

SECTION TARGETS:
- hook_html: strengthen tension and sharpen the challenged assumption. About ${deeperTier ? '70-110' : '60-90'} words.
- context_html: explain why this matters now with concrete stakes. About ${deeperTier ? '90-140' : '70-110'} words.
- insight_html: the deepest reasoning section. Use at least 2 paragraphs and about ${deeperTier ? '170-260' : '140-220'} words.
- evidence_html: one grounded example, observed pattern, or realistic scenario. About ${deeperTier ? '130-190' : '100-150'} words.
- expansion_html: deepen the hidden dynamic or second-order effect. About ${deeperTier ? '140-200' : '110-160'} words.
- implication_html: explain the practical decision shift clearly. About ${deeperTier ? '140-200' : '110-160'} words.
- closing_html: end with a memorable line, but keep it earned. About ${deeperTier ? '45-80' : '35-60'} words.

RETURN JSON WITH EXACTLY THESE FIELDS:
{
  "hook_html": "string with <p> tags",
  "context_html": "string with <p> tags",
  "insight_html": "string with <p> tags",
  "evidence_html": "string with <p> tags",
  "expansion_html": "string with <p> tags",
  "implication_html": "string with <p> tags",
  "closing_html": "string with <p> tags"
}`;
}

function applyMinimalThesisDepthRepair(
  blocks: ContentBlock[],
  raw: any,
): ContentBlock[] {
  const paragraphFields = [
    'hook_html',
    'context_html',
    'insight_html',
    'evidence_html',
    'expansion_html',
    'implication_html',
    'closing_html',
  ];
  let paragraphIndex = 0;

  return blocks.map((block) => {
    if (block.type !== 'paragraph') return block;
    const fieldName = paragraphFields[paragraphIndex];
    paragraphIndex += 1;
    const nextHtml = typeof fieldName === 'string' ? raw?.[fieldName] : '';
    return {
      ...block,
      html: typeof nextHtml === 'string' && nextHtml.trim()
        ? normalizeParagraphHtml({ html: nextHtml })
        : block.html,
    } as ParagraphBlock;
  });
}

function countWords(text: string): number {
  const normalized = text.trim();
  return normalized ? normalized.split(/\s+/).filter(Boolean).length : 0;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function analyzeMinimalThesisDraft(blocks: ContentBlock[]) {
  const flat = flattenBlocks(blocks);
  const headings = flat
    .filter((block): block is HeadingBlock => block.type === 'heading')
    .map((block) => block.text.trim().toLowerCase())
    .filter(Boolean);
  const paragraphs = flat.filter((block): block is ParagraphBlock => block.type === 'paragraph');
  const keyInsights = flat.filter((block): block is KeyInsightsBlock => block.type === 'key_insights');
  const callouts = flat.filter((block): block is CalloutBlock => block.type === 'callout');
  const quotes = flat.filter((block): block is QuoteBlock => block.type === 'quote');
  const summaries = flat.filter((block): block is SummaryBlock => block.type === 'summary');

  const paragraphWordCounts = paragraphs.map((block) => countWords(stripHtml(block.html))).filter((count) => count > 0);
  const avgParagraphWords = paragraphWordCounts.length
    ? Math.round(paragraphWordCounts.reduce((sum, count) => sum + count, 0) / paragraphWordCounts.length)
    : 0;

  const requiredHeadings = ['hook', 'context', 'insight', 'expansion', 'implication', 'closing'];
  const missingHeadings = requiredHeadings.filter((label) => !headings.some((heading) => heading === label || heading.includes(label)));
  const filledInsights = keyInsights.some((block) => block.items.filter((item) => item.trim().length >= 18).length >= 3);
  const filledCallouts = callouts.filter((block) => countWords(`${block.title ?? ''} ${block.body ?? ''}`) >= 10).length;
  const filledQuotes = quotes.filter((block) => countWords(`${block.text ?? ''} ${block.author ?? ''} ${block.source ?? ''}`) >= 12).length;
  const filledSummaries = summaries.filter((block) => countWords(block.body) >= 28).length;
  const sectionWordCounts = {
    hook: paragraphWordCounts[0] ?? 0,
    context: paragraphWordCounts[1] ?? 0,
    insight: paragraphWordCounts[2] ?? 0,
    evidence: paragraphWordCounts[3] ?? 0,
    expansion: paragraphWordCounts[4] ?? 0,
    implication: paragraphWordCounts[5] ?? 0,
    closing: paragraphWordCounts[6] ?? 0,
  };

  return {
    missingHeadings,
    paragraphCount: paragraphWordCounts.length,
    avgParagraphWords,
    sectionWordCounts,
    filledInsights,
    filledCallouts,
    filledQuotes,
    filledSummaries,
  };
}

export async function runInsightLetterGeneration(
  input: NewsletterGenerationRequest,
): Promise<NewsletterGenerationResult> {
  const template = getMinimalThesisTemplate(input);
  const targetWords = getTargetWords(input);

  let retryReason: string | undefined;
  let best: ReturnType<typeof parseOutput> | null = null;
  let bestScore = -1;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const prompt = buildMinimalThesisSectionPrompt(input, targetWords, retryReason);
    const completion = await runCompletionWithOperation({
      operation: 'blogGeneration',
      companyId: input.company_id,
      model: 'gpt-4o',
      temperature: 0.25,
      response_format: { type: 'json_object' },
      max_tokens: targetWords >= 1600 ? 5600 : 4600,
      messages: [
        {
          role: 'system',
          content: 'You are a senior newsletter strategist and writer. Return only valid JSON. Write a deeply reasoned, forwardable insight letter with strong extraction surfaces. Do not omit any requested fields.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const raw = completion.output ? JSON.parse(completion.output) : null;
    const parsed = raw ? parseMinimalThesisSectionOutput(raw, template) : null;
    if (!parsed) {
      retryReason = 'output was not valid template JSON';
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
      format_type: 'insight-letter',
    });

    const composite = score.breakdown.structure * 3 + score.breakdown.depth * 3 + score.breakdown.geo * 3 + score.breakdown.seo;
    if (composite > bestScore) {
      bestScore = composite;
      best = parsed;
    }

    const analysis = analyzeMinimalThesisDraft(parsed.content_blocks);
    const weakStructure = score.breakdown.structure < 22
      || score.issues.some((issue) => issue.category === 'structure')
      || analysis.missingHeadings.length > 0
      || !analysis.filledInsights;
    const weakDepth = score.breakdown.depth < 16
      || score.issues.some((issue) => issue.category === 'depth')
      || analysis.paragraphCount < (targetWords >= 1600 ? 9 : 8)
      || analysis.avgParagraphWords < (targetWords >= 1600 ? 100 : 90)
      || analysis.sectionWordCounts.insight < (targetWords >= 1600 ? 130 : 110)
      || analysis.sectionWordCounts.evidence < (targetWords >= 1600 ? 95 : 80)
      || analysis.sectionWordCounts.expansion < (targetWords >= 1600 ? 100 : 80)
      || analysis.sectionWordCounts.implication < (targetWords >= 1600 ? 100 : 80);
    const weakGeo = score.breakdown.geo < 16
      || score.issues.some((issue) => issue.category === 'geo')
      || analysis.filledCallouts < 2
      || analysis.filledQuotes < 1
      || analysis.filledSummaries < 1;

    if (weakDepth) {
      try {
        const depthRepairPrompt = buildMinimalThesisDepthRepairPrompt(
          input,
          targetWords,
          extractMinimalThesisState(parsed.content_blocks),
          [
            `depth score: ${score.breakdown.depth}/20`,
            analysis.paragraphCount < (targetWords >= 1600 ? 9 : 8) ? `not enough body paragraphs (${analysis.paragraphCount})` : '',
            analysis.avgParagraphWords < (targetWords >= 1600 ? 100 : 90) ? `average paragraph depth too light (${analysis.avgParagraphWords} words)` : '',
            analysis.sectionWordCounts.insight < (targetWords >= 1600 ? 130 : 110) ? `insight section too thin (${analysis.sectionWordCounts.insight} words)` : '',
            analysis.sectionWordCounts.evidence < (targetWords >= 1600 ? 95 : 80) ? `evidence section too thin (${analysis.sectionWordCounts.evidence} words)` : '',
            analysis.sectionWordCounts.expansion < (targetWords >= 1600 ? 100 : 80) ? `expansion section too thin (${analysis.sectionWordCounts.expansion} words)` : '',
            analysis.sectionWordCounts.implication < (targetWords >= 1600 ? 100 : 80) ? `implication section too thin (${analysis.sectionWordCounts.implication} words)` : '',
          ].filter(Boolean).join('; '),
        );

        const depthRepair = await runCompletionWithOperation({
          operation: 'blogGeneration',
          companyId: input.company_id,
          model: 'gpt-4o',
          temperature: 0.2,
          response_format: { type: 'json_object' },
          max_tokens: targetWords >= 1600 ? 3200 : 2400,
          messages: [
            {
              role: 'system',
              content: 'You are a senior newsletter writer improving body depth only. Return only valid JSON. Keep the thesis and extraction surfaces intact while deepening the body.',
            },
            {
              role: 'user',
              content: depthRepairPrompt,
            },
          ],
        });

        const depthRaw = depthRepair.output ? JSON.parse(depthRepair.output) : null;
        if (depthRaw && typeof depthRaw === 'object') {
          const repairedBlocks = applyMinimalThesisDepthRepair(parsed.content_blocks, depthRaw);
          const repairedScore = calculateNewsletterQualityScore(repairedBlocks, {
            title: parsed.title,
            excerpt: parsed.excerpt,
            seo_meta_title: parsed.seo_meta_title,
            seo_meta_description: parsed.seo_meta_description,
            tags: parsed.tags,
            target_word_count: targetWords,
            content_type: 'newsletter',
            format_type: 'insight-letter',
          });
          if (repairedScore.breakdown.depth > score.breakdown.depth) {
            parsed.content_blocks = repairedBlocks;
          }
        }
      } catch {
        // Best-effort repair only
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
      format_type: 'insight-letter',
    });
    const finalAnalysis = analyzeMinimalThesisDraft(parsed.content_blocks);

    const finalWeakStructure = finalScore.breakdown.structure < 22
      || finalScore.issues.some((issue) => issue.category === 'structure')
      || finalAnalysis.missingHeadings.length > 0
      || !finalAnalysis.filledInsights;
    const finalWeakDepth = finalScore.breakdown.depth < 16
      || finalScore.issues.some((issue) => issue.category === 'depth')
      || finalAnalysis.paragraphCount < (targetWords >= 1600 ? 9 : 8)
      || finalAnalysis.avgParagraphWords < (targetWords >= 1600 ? 100 : 90)
      || finalAnalysis.sectionWordCounts.insight < (targetWords >= 1600 ? 130 : 110)
      || finalAnalysis.sectionWordCounts.evidence < (targetWords >= 1600 ? 95 : 80)
      || finalAnalysis.sectionWordCounts.expansion < (targetWords >= 1600 ? 100 : 80)
      || finalAnalysis.sectionWordCounts.implication < (targetWords >= 1600 ? 100 : 80);
    const finalWeakGeo = finalScore.breakdown.geo < 16
      || finalScore.issues.some((issue) => issue.category === 'geo')
      || finalAnalysis.filledCallouts < 2
      || finalAnalysis.filledQuotes < 1
      || finalAnalysis.filledSummaries < 1;

    const finalComposite = finalScore.breakdown.structure * 3 + finalScore.breakdown.depth * 3 + finalScore.breakdown.geo * 3 + finalScore.breakdown.seo;
    if (finalComposite > bestScore) {
      bestScore = finalComposite;
      best = parsed;
    }

    if (!finalWeakStructure && !finalWeakDepth && !finalWeakGeo) {
      return {
        needs_clarification: false,
        mode: 'full',
        confidence: 'high',
        template_used: true,
        hook_assessment: { strength: 'moderate', note: 'Newsletter-owned insight generation path used.' },
        result: parsed,
      };
    }

    retryReason = [
      finalWeakStructure ? `structure too weak (${finalScore.breakdown.structure}/25)` : '',
      finalWeakDepth ? `depth too weak (${finalScore.breakdown.depth}/20)` : '',
      finalWeakGeo ? `GEO too weak (${finalScore.breakdown.geo}/20)` : '',
      finalAnalysis.missingHeadings.length > 0 ? `missing sections: ${finalAnalysis.missingHeadings.join(', ')}` : '',
      !finalAnalysis.filledInsights ? 'key insights are not dense enough' : '',
      finalAnalysis.paragraphCount < (targetWords >= 1600 ? 9 : 8) ? `not enough body paragraphs (${finalAnalysis.paragraphCount})` : '',
      finalAnalysis.avgParagraphWords < (targetWords >= 1600 ? 100 : 90) ? `average paragraph depth too light (${finalAnalysis.avgParagraphWords} words)` : '',
      finalAnalysis.sectionWordCounts.insight < (targetWords >= 1600 ? 130 : 110) ? `insight section still too thin (${finalAnalysis.sectionWordCounts.insight} words)` : '',
      finalAnalysis.sectionWordCounts.evidence < (targetWords >= 1600 ? 95 : 80) ? `evidence section still too thin (${finalAnalysis.sectionWordCounts.evidence} words)` : '',
      finalAnalysis.sectionWordCounts.expansion < (targetWords >= 1600 ? 100 : 80) ? `expansion section still too thin (${finalAnalysis.sectionWordCounts.expansion} words)` : '',
      finalAnalysis.sectionWordCounts.implication < (targetWords >= 1600 ? 100 : 80) ? `implication section still too thin (${finalAnalysis.sectionWordCounts.implication} words)` : '',
      finalAnalysis.filledCallouts < 2 ? 'both callouts are not working yet' : '',
      finalAnalysis.filledQuotes < 1 ? 'quote block is still weak' : '',
      finalAnalysis.filledSummaries < 1 ? 'summary is still too thin' : '',
    ].filter(Boolean).join('; ');
  }

  if (best) {
    return {
      needs_clarification: false,
      mode: 'full',
      confidence: 'medium',
      template_used: true,
      hook_assessment: { strength: 'moderate', note: 'Newsletter-owned insight generation path used.' },
      result: best,
    };
  }

  throw new Error('Failed to generate Minimal Thesis newsletter');
}
