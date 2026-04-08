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
  return raw ? parseInt(String(raw), 10) || 1200 : 1200;
}

function getSprintSheetTemplate(input: NewsletterGenerationRequest): ContentBlock[] {
  if (Array.isArray(input.template_blocks) && input.template_blocks.length > 0) {
    return input.template_blocks as ContentBlock[];
  }
  const template = getDefaultNewsletterTemplates().find((item) => item.name.toLowerCase() === 'sprint sheet');
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

function buildSprintSheetPrompt(input: NewsletterGenerationRequest, targetWords: number, retryReason?: string): string {
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
Write a high-quality "Sprint Sheet" action letter. It should feel fast, operational, and structured like a compact execution sprint.

RETURN JSON WITH EXACTLY THESE FIELDS:
{
  "title": "string",
  "excerpt": "string",
  "seo_meta_title": "string",
  "seo_meta_description": "string",
  "tags": ["string"],
  "key_insights": ["string"],
  "operator_note": "string",
  "problem_html": "string with <p> tags",
  "outcome_html": "string with <p> tags",
  "framework_intro_html": "string with <p> tags",
  "sprint_steps": ["string"],
  "breakdown_sections": [{ "title": "string", "body": "string with <p> tags" }],
  "mistakes": ["string"],
  "cta_html": "string with <p> tags",
  "summary_body": "string",
  "references": [{ "title": "string", "url": "string" }]
}

ACTION RULES:
- make the problem and outcome concrete and operator-readable
- sprint_steps must be short but still specific enough to execute
- every breakdown section must include the action, the success check, and the likely failure mode
- mistakes must feel like real shortcuts or breakdowns teams make under pressure
- cta_html should start the sprint immediately
- excerpt should sound sharp, specific, and easy to understand in an inbox preview
- seo_meta_title should be concise and keyword-aligned
- seo_meta_description should clearly promise the sprint outcome and what the reader will learn
- problem_html, outcome_html, framework_intro_html, and cta_html should each be 2 substantial paragraphs, not one short note
- each breakdown_sections.body should be at least 2 substantial paragraphs with real execution detail
- return only valid JSON`;
}

function buildSprintSheetRepairPrompt(
  input: NewsletterGenerationRequest,
  targetWords: number,
  currentDraft: any,
  retryReason: string,
): string {
  const currentJson = JSON.stringify(currentDraft, null, 2);
  return `TOPIC: ${input.topic}

TARGET WORD COUNT: ${targetWords} words minimum

CURRENT DRAFT JSON:
${currentJson}

YOUR TASK:
Rewrite this Sprint Sheet so it becomes deeper, more operator-specific, and more search-friendly without changing the overall template shape.

FAILED BECAUSE:
${retryReason}

RETURN JSON WITH THE EXACT SAME FIELDS AS THE CURRENT DRAFT.

REPAIR RULES:
- strengthen excerpt, seo_meta_title, and seo_meta_description so they are specific, useful, and aligned to the sprint topic
- sprint_steps must feel like real execution steps that can be followed under deadline pressure
- every breakdown section must explain the action, the checkpoint, and the failure mode in more detail
- mistakes must sound like real shortcuts teams take when rushing
- cta_html should clearly tell the reader how to begin the sprint now
- keep references credible and relevant
- return only valid JSON`;
}

function buildSprintSheetDepthRepairPrompt(
  input: NewsletterGenerationRequest,
  targetWords: number,
  currentDraft: any,
  retryReason: string,
): string {
  const currentJson = JSON.stringify(currentDraft, null, 2);
  return `TOPIC: ${input.topic}

TARGET WORD COUNT: ${targetWords} words minimum

CURRENT DRAFT JSON:
${currentJson}

FAILED BECAUSE:
${retryReason}

YOUR TASK:
Deepen only the execution-heavy parts of this Sprint Sheet. Do not rewrite the full draft. Make it feel more operational, more detailed, and more useful under real delivery pressure.

RETURN JSON WITH EXACTLY THESE FIELDS:
{
  "framework_intro_html": "string with <p> tags",
  "sprint_steps": ["string"],
  "breakdown_sections": [{ "title": "string", "body": "string with <p> tags" }],
  "mistakes": ["string"],
  "cta_html": "string with <p> tags",
  "summary_body": "string"
}

DEPTH RULES:
- framework_intro_html should explain why this sprint order works and what execution drag it removes
- sprint_steps should be concrete actions, not labels or vague phases
- each breakdown body should explain action, quick check, and likely failure mode in more depth
- mistakes should sound like realistic rushed-team errors
- cta_html should tell the reader what to start today and which checkpoint to hit first
- summary_body should capture the sprint standard and execution rhythm
- framework_intro_html, cta_html, and each breakdown body should use fuller paragraphs, not compressed notes
- return only valid JSON`;
}

function buildSprintSheetExpansionPrompt(
  input: NewsletterGenerationRequest,
  targetWords: number,
  currentDraft: any,
  retryReason: string,
): string {
  const currentJson = JSON.stringify(currentDraft, null, 2);
  return `TOPIC: ${input.topic}

TARGET WORD COUNT: ${targetWords} words minimum

CURRENT DRAFT JSON:
${currentJson}

FAILED BECAUSE:
${retryReason}

YOUR TASK:
Expand the long-form body of this Sprint Sheet so it gets much closer to the target word count while staying fast, practical, and operator-specific. Add real substance, not filler.

RETURN JSON WITH EXACTLY THESE FIELDS:
{
  "problem_html": "string with <p> tags",
  "outcome_html": "string with <p> tags",
  "framework_intro_html": "string with <p> tags",
  "breakdown_sections": [{ "title": "string", "body": "string with <p> tags" }],
  "cta_html": "string with <p> tags",
  "summary_body": "string"
}

EXPANSION RULES:
- problem_html should show the execution drag and how it appears in real work
- outcome_html should explain the visible sprint win and the proof that it is working
- framework_intro_html should explain why this sprint sequence matters
- each breakdown body should become materially longer with action, checkpoint, and failure mode
- cta_html should say what to start today and what first checkpoint to hit
- summary_body should capture the sprint standard and expected rhythm
- use multi-paragraph development in the long-form fields so the average paragraph depth rises materially
- return only valid JSON`;
}

function parseSprintSheetOutput(raw: any, template: ContentBlock[]) {
  if (!raw || typeof raw !== 'object') return null;
  const breakdownBodies = Array.isArray(raw.breakdown_sections) ? raw.breakdown_sections.map((item: any) => item?.body) : [];
  let columnsIndex = 0;
  let breakdownIndex = 0;
  let standaloneParagraphSeen = 0;

  const contentBlocks = template.map((block) => {
    if (block.type === 'key_insights') {
      return { ...block, items: Array.isArray(raw.key_insights) ? raw.key_insights.map((item: unknown) => String(item ?? '').trim()).filter(Boolean) : block.items } as KeyInsightsBlock;
    }
    if (block.type === 'callout') {
      return { ...block, title: '', body: typeof raw.operator_note === 'string' ? raw.operator_note.trim() : '' } as CalloutBlock;
    }
    if (block.type === 'paragraph') {
      standaloneParagraphSeen += 1;
      const value = standaloneParagraphSeen === 1 ? raw.framework_intro_html : raw.cta_html;
      return { ...block, html: normalizeParagraphHtml(value) } as ParagraphBlock;
    }
    if (block.type === 'columns') {
      const nextColumns: ColumnsBlock = {
        ...block,
        columns: block.columns.map((column, colIdx) => ({
          ...column,
          blocks: column.blocks.map((inner) => {
            if (inner.type !== 'paragraph') return inner;
            if (columnsIndex === 0) {
              return { ...inner, html: normalizeParagraphHtml(colIdx === 0 ? raw.problem_html : raw.outcome_html) } as ParagraphBlock;
            }
            return { ...inner, html: normalizeParagraphHtml(breakdownBodies[breakdownIndex++]) } as ParagraphBlock;
          }),
        })),
      };
      columnsIndex += 1;
      return nextColumns;
    }
    if (block.type === 'list' && block.listType === 'numbered') {
      return { ...block, items: Array.isArray(raw.sprint_steps) ? raw.sprint_steps.map((item: unknown, index: number) => ({ id: block.items[index]?.id ?? `sprint-${index}`, text: String(item ?? '').trim() })) : block.items } as ListBlock;
    }
    if (block.type === 'list' && block.listType === 'bullet') {
      return { ...block, items: Array.isArray(raw.mistakes) ? raw.mistakes.map((item: unknown, index: number) => ({ id: block.items[index]?.id ?? `mistake-${index}`, text: String(item ?? '').trim() })) : block.items } as ListBlock;
    }
    if (block.type === 'summary') return { ...block, body: typeof raw.summary_body === 'string' ? raw.summary_body.trim() : '' } as SummaryBlock;
    if (block.type === 'references') {
      return {
        ...block,
        items: Array.isArray(raw.references)
          ? raw.references.map((item: any, index: number) => ({ id: block.items[index]?.id ?? `ref-${index}`, title: typeof item?.title === 'string' ? item.title.trim() : '', url: typeof item?.url === 'string' ? item.url.trim() : '' }))
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

function analyzeSprintSheetDraft(blocks: ContentBlock[]) {
  const flat = flattenBlocks(blocks);
  const paragraphs = flat.filter((block): block is ParagraphBlock => block.type === 'paragraph');
  const paragraphWordCounts = paragraphs.map((block) => block.html.replace(/<[^>]+>/g, ' ').trim().split(/\s+/).filter(Boolean).length);
  const numberedItems = flat.filter((block): block is ListBlock => block.type === 'list' && block.listType === 'numbered').flatMap((block) => block.items.map((item) => item.text.trim().split(/\s+/).filter(Boolean).length));
  const bulletItems = flat.filter((block): block is ListBlock => block.type === 'list' && block.listType === 'bullet').flatMap((block) => block.items.map((item) => item.text.trim().split(/\s+/).filter(Boolean).length));
  const breakdownParagraphs = paragraphWordCounts.slice(3, Math.max(3, paragraphWordCounts.length - 1));

  return {
    avgParagraphWords: paragraphWordCounts.length ? Math.round(paragraphWordCounts.reduce((sum, count) => sum + count, 0) / paragraphWordCounts.length) : 0,
    sprintStepCount: numberedItems.length,
    sprintStepAvgWords: numberedItems.length ? Math.round(numberedItems.reduce((sum, count) => sum + count, 0) / numberedItems.length) : 0,
    mistakesCount: bulletItems.length,
    mistakesAvgWords: bulletItems.length ? Math.round(bulletItems.reduce((sum, count) => sum + count, 0) / bulletItems.length) : 0,
    breakdownAvgWords: breakdownParagraphs.length ? Math.round(breakdownParagraphs.reduce((sum, count) => sum + count, 0) / breakdownParagraphs.length) : 0,
    ctaWords: paragraphWordCounts[paragraphWordCounts.length - 1] ?? 0,
  };
}

function getSprintSheetComposite(
  parsed: NonNullable<ReturnType<typeof parseSprintSheetOutput>>,
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
    format_type: 'action-letter',
  });
  const analysis = analyzeSprintSheetDraft(parsed.content_blocks);
  const weak = score.breakdown.depth < 16
    || score.breakdown.seo < 11
    || score.meta.wordCount < Math.round(targetWords * 0.85)
    || score.issues.some((issue) => issue.category === 'depth' || issue.category === 'seo')
    || analysis.avgParagraphWords < 65
    || analysis.sprintStepCount < 3
    || analysis.sprintStepAvgWords < 8
    || analysis.breakdownAvgWords < 90
    || analysis.mistakesCount < 3
    || analysis.mistakesAvgWords < 11
    || analysis.ctaWords < 42;

  const composite = score.breakdown.structure * 3
    + score.breakdown.depth * 4
    + score.breakdown.geo * 2
    + score.breakdown.seo * 2;

  return { score, analysis, weak, composite };
}

function mergeSprintSheetRepair(
  baseRaw: any,
  repairRaw: any,
  template: ContentBlock[],
) {
  if (!repairRaw || typeof repairRaw !== 'object') return null;
  const mergedRaw = {
    ...baseRaw,
    framework_intro_html: repairRaw.framework_intro_html ?? baseRaw.framework_intro_html,
    sprint_steps: Array.isArray(repairRaw.sprint_steps) ? repairRaw.sprint_steps : baseRaw.sprint_steps,
    breakdown_sections: Array.isArray(repairRaw.breakdown_sections) ? repairRaw.breakdown_sections : baseRaw.breakdown_sections,
    mistakes: Array.isArray(repairRaw.mistakes) ? repairRaw.mistakes : baseRaw.mistakes,
    cta_html: repairRaw.cta_html ?? baseRaw.cta_html,
    summary_body: repairRaw.summary_body ?? baseRaw.summary_body,
  };
  const mergedParsed = parseSprintSheetOutput(mergedRaw, template);
  if (!mergedParsed) return null;
  return { mergedRaw, mergedParsed };
}

function mergeSprintSheetExpansion(
  baseRaw: any,
  expansionRaw: any,
  template: ContentBlock[],
) {
  if (!expansionRaw || typeof expansionRaw !== 'object') return null;
  const mergedRaw = {
    ...baseRaw,
    problem_html: expansionRaw.problem_html ?? baseRaw.problem_html,
    outcome_html: expansionRaw.outcome_html ?? baseRaw.outcome_html,
    framework_intro_html: expansionRaw.framework_intro_html ?? baseRaw.framework_intro_html,
    breakdown_sections: Array.isArray(expansionRaw.breakdown_sections) ? expansionRaw.breakdown_sections : baseRaw.breakdown_sections,
    cta_html: expansionRaw.cta_html ?? baseRaw.cta_html,
    summary_body: expansionRaw.summary_body ?? baseRaw.summary_body,
  };
  const mergedParsed = parseSprintSheetOutput(mergedRaw, template);
  if (!mergedParsed) return null;
  return { mergedRaw, mergedParsed };
}

export async function runSprintSheetGeneration(input: NewsletterGenerationRequest): Promise<NewsletterGenerationResult> {
  const template = getSprintSheetTemplate(input);
  const targetWords = getTargetWords(input);
  let retryReason: string | undefined;
  let best: ReturnType<typeof parseSprintSheetOutput> | null = null;
  let bestScore = -1;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const completion = await runCompletionWithOperation({
      operation: 'blogGeneration',
      companyId: input.company_id,
      model: 'gpt-4o',
      temperature: 0.25,
      response_format: { type: 'json_object' },
      max_tokens: targetWords >= 1600 ? 4400 : 3400,
      messages: [
        { role: 'system', content: 'You are an operator writing an action-letter newsletter. Return only valid JSON. Focus on sprint execution, practical checkpoints, and immediate operator clarity.' },
        { role: 'user', content: buildSprintSheetPrompt(input, targetWords, retryReason) },
      ],
    });

    const raw = completion.output ? JSON.parse(completion.output) : null;
    const parsed = raw ? parseSprintSheetOutput(raw, template) : null;
    if (!parsed) {
      retryReason = 'output was not valid structured sprint sheet JSON';
      continue;
    }

    let activeRaw = raw;
    let activeParsed = parsed;
    let evaluation = getSprintSheetComposite(activeParsed, targetWords);

    if (evaluation.weak && attempt < 2) {
      const repair = await runCompletionWithOperation({
        operation: 'blogGeneration',
        companyId: input.company_id,
        model: 'gpt-4o',
        temperature: 0.2,
        response_format: { type: 'json_object' },
        max_tokens: targetWords >= 1600 ? 4600 : 3600,
        messages: [
          { role: 'system', content: 'You are repairing an action-letter sprint newsletter. Return only valid JSON and make it deeper, more concrete, and more search-friendly.' },
          { role: 'user', content: buildSprintSheetRepairPrompt(input, targetWords, activeRaw, retryReason || 'depth and SEO are too weak') },
        ],
      });

      const repairedRaw = repair.output ? JSON.parse(repair.output) : null;
      const repairedParsed = repairedRaw ? parseSprintSheetOutput(repairedRaw, template) : null;
      if (repairedParsed) {
        const repairedEvaluation = getSprintSheetComposite(repairedParsed, targetWords);
        if (repairedEvaluation.composite > evaluation.composite) {
          activeRaw = repairedRaw;
          activeParsed = repairedParsed;
          evaluation = repairedEvaluation;
        }
      }
    }

    if (evaluation.weak && attempt < 2) {
      const depthRepair = await runCompletionWithOperation({
        operation: 'blogGeneration',
        companyId: input.company_id,
        model: 'gpt-4o',
        temperature: 0.2,
        response_format: { type: 'json_object' },
        max_tokens: targetWords >= 1600 ? 3000 : 2400,
        messages: [
          { role: 'system', content: 'You are deepening a sprint sheet action-letter newsletter. Return only valid JSON for the requested repair fields.' },
          { role: 'user', content: buildSprintSheetDepthRepairPrompt(input, targetWords, activeRaw, retryReason || 'depth is still too weak') },
        ],
      });

      const depthRepairRaw = depthRepair.output ? JSON.parse(depthRepair.output) : null;
      const merged = mergeSprintSheetRepair(activeRaw, depthRepairRaw, template);
      if (merged) {
        const repairedEvaluation = getSprintSheetComposite(merged.mergedParsed, targetWords);
        if (repairedEvaluation.composite > evaluation.composite) {
          activeRaw = merged.mergedRaw;
          activeParsed = merged.mergedParsed;
          evaluation = repairedEvaluation;
        }
      }
    }

    if (evaluation.weak && evaluation.score.meta.wordCount < Math.round(targetWords * 0.85) && attempt < 2) {
      const expansion = await runCompletionWithOperation({
        operation: 'blogGeneration',
        companyId: input.company_id,
        model: 'gpt-4o',
        temperature: 0.25,
        response_format: { type: 'json_object' },
        max_tokens: targetWords >= 1600 ? 4000 : 3200,
        messages: [
          { role: 'system', content: 'You are expanding a sprint sheet action-letter newsletter. Return only valid JSON for the requested fields and add real depth.' },
          { role: 'user', content: buildSprintSheetExpansionPrompt(input, targetWords, activeRaw, retryReason || 'word count and depth are still too weak') },
        ],
      });

      const expansionRaw = expansion.output ? JSON.parse(expansion.output) : null;
      const merged = mergeSprintSheetExpansion(activeRaw, expansionRaw, template);
      if (merged) {
        const repairedEvaluation = getSprintSheetComposite(merged.mergedParsed, targetWords);
        if (repairedEvaluation.composite > evaluation.composite) {
          activeRaw = merged.mergedRaw;
          activeParsed = merged.mergedParsed;
          evaluation = repairedEvaluation;
        }
      }
    }

    const { score, analysis, weak, composite } = evaluation;
    if (composite > bestScore) { bestScore = composite; best = activeParsed; }
    if (!weak) {
      return { needs_clarification: false, mode: 'full', confidence: 'high', template_used: true, hook_assessment: { strength: 'moderate', note: 'Newsletter-owned sprint sheet generation path used.' }, result: activeParsed };
    }

    retryReason = [
      `depth too weak (${score.breakdown.depth}/20)`,
      `seo too weak (${score.breakdown.seo}/15)`,
      score.meta.wordCount < Math.round(targetWords * 0.85) ? `draft far below target length (${score.meta.wordCount}/${targetWords} words)` : '',
      analysis.avgParagraphWords < 65 ? `average paragraph depth too light (${analysis.avgParagraphWords} words)` : '',
      analysis.sprintStepCount < 3 ? `not enough sprint steps (${analysis.sprintStepCount})` : '',
      analysis.sprintStepAvgWords < 8 ? `sprint steps too generic (${analysis.sprintStepAvgWords} words avg)` : '',
      analysis.breakdownAvgWords < 90 ? `step breakdowns too thin (${analysis.breakdownAvgWords} words avg)` : '',
      analysis.mistakesCount < 3 ? `not enough realistic mistakes (${analysis.mistakesCount})` : '',
      analysis.mistakesAvgWords < 11 ? `mistakes are too generic (${analysis.mistakesAvgWords} words avg)` : '',
      analysis.ctaWords < 42 ? `CTA too thin (${analysis.ctaWords} words)` : '',
      !activeParsed.excerpt || activeParsed.excerpt.trim().length < 80 ? `excerpt too weak (${activeParsed.excerpt?.trim().length || 0} chars)` : '',
      !activeParsed.seo_meta_title || activeParsed.seo_meta_title.trim().length < 35 ? `seo title too weak (${activeParsed.seo_meta_title?.trim().length || 0} chars)` : '',
      !activeParsed.seo_meta_description || activeParsed.seo_meta_description.trim().length < 110 ? `seo description too weak (${activeParsed.seo_meta_description?.trim().length || 0} chars)` : '',
    ].filter(Boolean).join('; ');
  }

  if (best) {
    return { needs_clarification: false, mode: 'full', confidence: 'medium', template_used: true, hook_assessment: { strength: 'moderate', note: 'Newsletter-owned sprint sheet generation path used.' }, result: best };
  }
  throw new Error('Failed to generate Sprint Sheet newsletter');
}
