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
  ListBlock,
} from '../content/blockTypes';
import { flattenBlocks } from '../content/blockUtils';

function getTargetWords(input: NewsletterGenerationRequest): number {
  const raw = input.answers?.target_word_count;
  return raw ? parseInt(String(raw), 10) || 1200 : 1200;
}

function getOperatorPlaybookTemplate(input: NewsletterGenerationRequest): ContentBlock[] {
  if (Array.isArray(input.template_blocks) && input.template_blocks.length > 0) {
    return input.template_blocks as ContentBlock[];
  }
  const template = getDefaultNewsletterTemplates().find((item) => item.name.toLowerCase() === 'operator playbook');
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

function buildOperatorPlaybookPrompt(
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
Write a high-quality "Operator Playbook" action letter. It should feel like a practical operator guide: concrete, executable, and specific enough to use immediately.

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
  "framework_steps": ["string"],
  "breakdown_sections": [{ "title": "string", "body": "string with <p> tags" }],
  "mistakes": ["string"],
  "cta_html": "string with <p> tags",
  "summary_body": "string",
  "references": [{ "title": "string", "url": "string" }]
}

ACTION RULES:
- problem_html should identify a real execution bottleneck, not a vague theme
- outcome_html should define a practical result and what success looks like
- framework_steps must be concrete operating moves, not generic labels
- every breakdown section must explain what to do, why it matters, and how to tell if it worked
- mistakes must feel like real execution failures, not obvious filler
- cta_html should tell the reader exactly what to do first
- excerpt should sound specific and high-signal, not generic
- seo_meta_title should be concise, compelling, and closely aligned to the topic
- seo_meta_description should clearly preview the operating lesson and practical outcome
- problem_html, outcome_html, framework_intro_html, and cta_html should each be 2 substantial paragraphs, not one short note
- each breakdown_sections.body should be at least 2 substantial paragraphs with real execution detail
- return only valid JSON`;
}

function buildOperatorPlaybookRepairPrompt(
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
Rewrite this Operator Playbook so it becomes deeper, more specific, and more search-friendly without changing the overall template shape.

FAILED BECAUSE:
${retryReason}

RETURN JSON WITH THE EXACT SAME FIELDS AS THE CURRENT DRAFT.

REPAIR RULES:
- strengthen excerpt, seo_meta_title, and seo_meta_description so they are specific, keyword-aligned, and useful as previews
- framework_steps must read like real operator moves, not labels
- every breakdown section must become more substantive by covering action, rationale, signal of success, and common failure mode
- mistakes must sound like realistic team failures under execution pressure
- cta_html must tell the reader what to do in the next 24-48 hours
- keep references credible and relevant
- return only valid JSON`;
}

function buildOperatorPlaybookDepthRepairPrompt(
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
Deepen only the execution-heavy parts of this Operator Playbook. Do not rewrite the whole draft. Make it feel like a sharper operator guide with more substance, better judgment, and clearer execution detail.

RETURN JSON WITH EXACTLY THESE FIELDS:
{
  "framework_intro_html": "string with <p> tags",
  "framework_steps": ["string"],
  "breakdown_sections": [{ "title": "string", "body": "string with <p> tags" }],
  "mistakes": ["string"],
  "cta_html": "string with <p> tags",
  "summary_body": "string"
}

DEPTH RULES:
- framework_intro_html should explain why the sequence works and what failure pattern it prevents
- framework_steps should be concrete operator moves with enough specificity to act on
- each breakdown body should explain action, reasoning, success signal, and common failure mode
- mistakes should sound like real team failures under execution pressure
- cta_html should tell the reader what to do first and what proof point to look for next
- summary_body should capture the operating standard, not just restate the title
- framework_intro_html, cta_html, and each breakdown body should use fuller paragraphs, not compressed notes
- return only valid JSON`;
}

function buildOperatorPlaybookExpansionPrompt(
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
Expand the long-form body of this Operator Playbook so it gets much closer to the target word count while staying concrete and useful. Do not shorten anything. Add depth through reasoning, execution detail, success checks, failure patterns, and examples.

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
- add meaningful substance, not fluff
- problem_html should show the real bottleneck, symptoms, and why teams misdiagnose it
- outcome_html should explain the practical change and visible signs of success
- framework_intro_html should explain why the sequence works
- each breakdown body should be materially longer and include action, rationale, success signal, and failure mode
- cta_html should tell the reader what to do first, this week, and what early proof to look for
- summary_body should capture the whole operating standard clearly
- use multi-paragraph development in the long-form fields so the average paragraph depth rises materially
- return only valid JSON`;
}

function buildOperatorPlaybookFocusedBodyPrompt(
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
Rewrite only the long-form execution body so this Operator Playbook reads like a serious operator memo, not a short checklist. Keep the same shape and thesis, but make the execution logic fuller and more actionable.

RETURN JSON WITH EXACTLY THESE FIELDS:
{
  "problem_html": "string with <p> tags",
  "outcome_html": "string with <p> tags",
  "framework_intro_html": "string with <p> tags",
  "breakdown_sections": [{ "title": "string", "body": "string with <p> tags" }],
  "cta_html": "string with <p> tags",
  "summary_body": "string"
}

STRICT RULES:
- problem_html should be at least ${targetWords >= 1600 ? '140' : targetWords >= 1200 ? '110' : '85'} words
- outcome_html should be at least ${targetWords >= 1600 ? '120' : targetWords >= 1200 ? '95' : '75'} words
- framework_intro_html should be at least ${targetWords >= 1600 ? '150' : targetWords >= 1200 ? '120' : '90'} words
- each breakdown body should be at least ${targetWords >= 1600 ? '165' : targetWords >= 1200 ? '130' : '100'} words and include action, rationale, success signal, and failure mode
- cta_html should be at least ${targetWords >= 1600 ? '90' : targetWords >= 1200 ? '70' : '50'} words
- summary_body should be a strong 2-3 sentence operating standard
- return only valid JSON`;
}

function parseOperatorPlaybookOutput(raw: any, template: ContentBlock[]) {
  if (!raw || typeof raw !== 'object') return null;

  const paragraphFields = [
    raw.problem_html,
    raw.outcome_html,
    raw.framework_intro_html,
    ...(Array.isArray(raw.breakdown_sections) ? raw.breakdown_sections.map((item: any) => item?.body) : []),
    raw.cta_html,
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
        body: typeof raw.operator_note === 'string' ? raw.operator_note.trim() : '',
      } as CalloutBlock;
    }
    if (block.type === 'paragraph') {
      return {
        ...block,
        html: normalizeParagraphHtml(paragraphFields[paragraphIndex++]),
      } as ParagraphBlock;
    }
    if (block.type === 'list' && block.listType === 'numbered') {
      return {
        ...block,
        items: Array.isArray(raw.framework_steps)
          ? raw.framework_steps.map((item: unknown, index: number) => ({
              id: block.items[index]?.id ?? `framework-${index}`,
              text: String(item ?? '').trim(),
            }))
          : block.items,
      } as ListBlock;
    }
    if (block.type === 'list' && block.listType === 'bullet') {
      return {
        ...block,
        items: Array.isArray(raw.mistakes)
          ? raw.mistakes.map((item: unknown, index: number) => ({
              id: block.items[index]?.id ?? `mistake-${index}`,
              text: String(item ?? '').trim(),
            }))
          : block.items,
      } as ListBlock;
    }
    if (block.type === 'summary') {
      return { ...block, body: typeof raw.summary_body === 'string' ? raw.summary_body.trim() : '' } as SummaryBlock;
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

function analyzeOperatorPlaybookDraft(blocks: ContentBlock[]) {
  const flat = flattenBlocks(blocks);
  const paragraphs = flat.filter((block): block is ParagraphBlock => block.type === 'paragraph');
  const paragraphWordCounts = paragraphs.map((block) => block.html.replace(/<[^>]+>/g, ' ').trim().split(/\s+/).filter(Boolean).length);
  const numberedItems = flat.filter((block): block is ListBlock => block.type === 'list' && block.listType === 'numbered').flatMap((block) => block.items.map((item) => item.text.trim().split(/\s+/).filter(Boolean).length));
  const bulletItems = flat.filter((block): block is ListBlock => block.type === 'list' && block.listType === 'bullet').flatMap((block) => block.items.map((item) => item.text.trim().split(/\s+/).filter(Boolean).length));
  const breakdownParagraphs = paragraphWordCounts.slice(3, Math.max(3, paragraphWordCounts.length - 1));

  return {
    avgParagraphWords: paragraphWordCounts.length ? Math.round(paragraphWordCounts.reduce((sum, count) => sum + count, 0) / paragraphWordCounts.length) : 0,
    frameworkCount: numberedItems.length,
    frameworkAvgWords: numberedItems.length ? Math.round(numberedItems.reduce((sum, count) => sum + count, 0) / numberedItems.length) : 0,
    mistakesCount: bulletItems.length,
    mistakesAvgWords: bulletItems.length ? Math.round(bulletItems.reduce((sum, count) => sum + count, 0) / bulletItems.length) : 0,
    breakdownAvgWords: breakdownParagraphs.length ? Math.round(breakdownParagraphs.reduce((sum, count) => sum + count, 0) / breakdownParagraphs.length) : 0,
    ctaWords: paragraphWordCounts[paragraphWordCounts.length - 1] ?? 0,
  };
}

function getOperatorPlaybookComposite(
  parsed: NonNullable<ReturnType<typeof parseOperatorPlaybookOutput>>,
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
  const analysis = analyzeOperatorPlaybookDraft(parsed.content_blocks);
  const weak = score.breakdown.depth < 16
    || score.breakdown.seo < 11
    || score.meta.wordCount < Math.round(targetWords * 0.85)
    || score.issues.some((issue) => issue.category === 'depth' || issue.category === 'seo')
    || analysis.avgParagraphWords < 65
    || analysis.frameworkCount < 3
    || analysis.frameworkAvgWords < 9
    || analysis.breakdownAvgWords < 95
    || analysis.mistakesCount < 3
    || analysis.mistakesAvgWords < 11
    || analysis.ctaWords < 45;

  const composite = score.breakdown.structure * 3
    + score.breakdown.depth * 4
    + score.breakdown.geo * 2
    + score.breakdown.seo * 2;

  return { score, analysis, weak, composite };
}

function mergeOperatorPlaybookRepair(
  baseRaw: any,
  repairRaw: any,
  template: ContentBlock[],
) {
  if (!repairRaw || typeof repairRaw !== 'object') return null;
  const mergedRaw = {
    ...baseRaw,
    framework_intro_html: repairRaw.framework_intro_html ?? baseRaw.framework_intro_html,
    framework_steps: Array.isArray(repairRaw.framework_steps) ? repairRaw.framework_steps : baseRaw.framework_steps,
    breakdown_sections: Array.isArray(repairRaw.breakdown_sections) ? repairRaw.breakdown_sections : baseRaw.breakdown_sections,
    mistakes: Array.isArray(repairRaw.mistakes) ? repairRaw.mistakes : baseRaw.mistakes,
    cta_html: repairRaw.cta_html ?? baseRaw.cta_html,
    summary_body: repairRaw.summary_body ?? baseRaw.summary_body,
  };
  const mergedParsed = parseOperatorPlaybookOutput(mergedRaw, template);
  if (!mergedParsed) return null;
  return { mergedRaw, mergedParsed };
}

function mergeOperatorPlaybookExpansion(
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
  const mergedParsed = parseOperatorPlaybookOutput(mergedRaw, template);
  if (!mergedParsed) return null;
  return { mergedRaw, mergedParsed };
}

export async function runOperatorPlaybookGeneration(input: NewsletterGenerationRequest): Promise<NewsletterGenerationResult> {
  const template = getOperatorPlaybookTemplate(input);
  const targetWords = getTargetWords(input);
  let retryReason: string | undefined;
  let best: ReturnType<typeof parseOperatorPlaybookOutput> | null = null;
  let bestScore = -1;

  const enhancedPlaybookSystemPrompt = await enhanceSystemPromptForNewsletter(
    'You are an operator writing an action-letter newsletter. Return only valid JSON. Focus on executable steps, realistic mistakes, and immediate action clarity.',
    input.company_id, input.companyContext,
  );

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const completion = await runCompletionWithOperation({
      operation: 'newsletterGeneration',
      companyId: input.company_id,
      cache_version: `${input.cache_version ?? 'newsletter'}:operator-playbook:v1:attempt:${attempt}`,
      model: 'gpt-4o',
      temperature: 0.25,
      response_format: { type: 'json_object' },
      max_tokens: targetWords >= 1600 ? 4600 : 3600,
      messages: [
        { role: 'system', content: enhancedPlaybookSystemPrompt },
        { role: 'user', content: buildOperatorPlaybookPrompt(input, targetWords, retryReason) },
      ],
    });

    const raw = completion.output ? JSON.parse(completion.output) : null;
    const parsed = raw ? parseOperatorPlaybookOutput(raw, template) : null;
    if (!parsed) {
      retryReason = 'output was not valid structured operator playbook JSON';
      continue;
    }
    if (parsed.title.trim().length > 0 && parsed.title.trim().length < 20) {
      parsed.title = `${parsed.title.trim()}: Operator Playbook`;
      if (!parsed.seo_meta_title?.trim()) {
        parsed.seo_meta_title = parsed.title.trim();
      }
    }
    if (!parsed.excerpt?.trim() || parsed.excerpt.trim().length < 70) {
      const fallbackExcerpt = [
        raw.summary_body,
        raw.framework_intro_html,
        raw.outcome_html,
        parsed.title,
      ].find((value) => typeof value === 'string' && value.trim().length > 0);
      if (typeof fallbackExcerpt === 'string' && fallbackExcerpt.trim()) {
        parsed.excerpt = fallbackExcerpt.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 155);
      }
    }
    if (!parsed.seo_meta_description?.trim() || parsed.seo_meta_description.trim().length < 70) {
      parsed.seo_meta_description = (parsed.excerpt || parsed.title).slice(0, 155).trim();
    }

    let activeRaw = raw;
    let activeParsed = parsed;
    let evaluation = getOperatorPlaybookComposite(activeParsed, targetWords);

    if (evaluation.weak && attempt < 2) {
      const repair = await runCompletionWithOperation({
        operation: 'newsletterGeneration',
        companyId: input.company_id,
        cache_version: `${input.cache_version ?? 'newsletter'}:operator-playbook-repair:v1:attempt:${attempt}`,
        model: 'gpt-4o',
        temperature: 0.2,
        response_format: { type: 'json_object' },
        max_tokens: targetWords >= 1600 ? 4800 : 3800,
        messages: [
          { role: 'system', content: 'You are repairing an operator action-letter newsletter. Return only valid JSON and make it deeper, more concrete, and more search-friendly.' },
          { role: 'user', content: buildOperatorPlaybookRepairPrompt(input, targetWords, activeRaw, retryReason || 'depth and SEO are too weak') },
        ],
      });

      const repairedRaw = repair.output ? JSON.parse(repair.output) : null;
      const repairedParsed = repairedRaw ? parseOperatorPlaybookOutput(repairedRaw, template) : null;
      if (repairedParsed) {
        const repairedEvaluation = getOperatorPlaybookComposite(repairedParsed, targetWords);
        if (repairedEvaluation.composite > evaluation.composite) {
          activeRaw = repairedRaw;
          activeParsed = repairedParsed;
          evaluation = repairedEvaluation;
        }
      }
    }

    if (evaluation.weak && attempt < 2) {
      const depthRepair = await runCompletionWithOperation({
        operation: 'newsletterGeneration',
        companyId: input.company_id,
        cache_version: `${input.cache_version ?? 'newsletter'}:operator-playbook-depth:v1:attempt:${attempt}`,
        model: 'gpt-4o',
        temperature: 0.2,
        response_format: { type: 'json_object' },
        max_tokens: targetWords >= 1600 ? 3200 : 2600,
        messages: [
          { role: 'system', content: 'You are deepening an operator playbook. Return only valid JSON for the requested repair fields.' },
          { role: 'user', content: buildOperatorPlaybookDepthRepairPrompt(input, targetWords, activeRaw, retryReason || 'depth is still too weak') },
        ],
      });

      const depthRepairRaw = depthRepair.output ? JSON.parse(depthRepair.output) : null;
      const merged = mergeOperatorPlaybookRepair(activeRaw, depthRepairRaw, template);
      if (merged) {
        const repairedEvaluation = getOperatorPlaybookComposite(merged.mergedParsed, targetWords);
        if (repairedEvaluation.composite > evaluation.composite) {
          activeRaw = merged.mergedRaw;
          activeParsed = merged.mergedParsed;
          evaluation = repairedEvaluation;
        }
      }
    }

    if (evaluation.weak && evaluation.score.meta.wordCount < Math.round(targetWords * 0.9) && attempt < 2) {
      const expansion = await runCompletionWithOperation({
        operation: 'newsletterGeneration',
        companyId: input.company_id,
        cache_version: `${input.cache_version ?? 'newsletter'}:operator-playbook-expansion:v1:attempt:${attempt}`,
        model: 'gpt-4o',
        temperature: 0.25,
        response_format: { type: 'json_object' },
        max_tokens: targetWords >= 1600 ? 4200 : 3400,
        messages: [
          { role: 'system', content: 'You are expanding an operator playbook action-letter newsletter. Return only valid JSON for the requested fields and add real depth.' },
          { role: 'user', content: buildOperatorPlaybookExpansionPrompt(input, targetWords, activeRaw, retryReason || 'word count and depth are still too weak') },
        ],
      });

      const expansionRaw = expansion.output ? JSON.parse(expansion.output) : null;
      const merged = mergeOperatorPlaybookExpansion(activeRaw, expansionRaw, template);
      if (merged) {
        const repairedEvaluation = getOperatorPlaybookComposite(merged.mergedParsed, targetWords);
        if (repairedEvaluation.composite > evaluation.composite) {
          activeRaw = merged.mergedRaw;
          activeParsed = merged.mergedParsed;
          evaluation = repairedEvaluation;
        }
      }
    }

    if (evaluation.weak && targetWords >= 1600 && evaluation.score.meta.wordCount < Math.round(targetWords * 0.95) && attempt < 2) {
      const focusedExpansion = await runCompletionWithOperation({
        operation: 'newsletterGeneration',
        companyId: input.company_id,
        cache_version: `${input.cache_version ?? 'newsletter'}:operator-playbook-focused:v2:attempt:${attempt}`,
        model: 'gpt-4o',
        temperature: 0.1,
        response_format: { type: 'json_object' },
        max_tokens: 4600,
        messages: [
          { role: 'system', content: 'You are rewriting the long-form execution body of an operator playbook for a 1600-word target. Return only valid JSON. Materially expand the body, make the framework steps more specific, and deepen the breakdown reasoning.' },
          { role: 'user', content: buildOperatorPlaybookFocusedBodyPrompt(input, targetWords, activeRaw, retryReason || `draft is still materially below target length (${evaluation.score.meta.wordCount}/${targetWords} words)`) },
        ],
      });

      const focusedRaw = focusedExpansion.output ? JSON.parse(focusedExpansion.output) : null;
      const merged = mergeOperatorPlaybookExpansion(activeRaw, focusedRaw, template);
      if (merged) {
        const repairedEvaluation = getOperatorPlaybookComposite(merged.mergedParsed, targetWords);
        if (repairedEvaluation.composite > evaluation.composite) {
          activeRaw = merged.mergedRaw;
          activeParsed = merged.mergedParsed;
          evaluation = repairedEvaluation;
        }
      }
    }

    if (evaluation.weak && attempt < 2) {
      const focused = await runCompletionWithOperation({
        operation: 'newsletterGeneration',
        companyId: input.company_id,
        cache_version: `${input.cache_version ?? 'newsletter'}:operator-playbook-focused:v1:attempt:${attempt}`,
        model: 'gpt-4o',
        temperature: 0.15,
        response_format: { type: 'json_object' },
        max_tokens: targetWords >= 1600 ? 4200 : 3200,
        messages: [
          { role: 'system', content: 'You are rewriting only the long-form execution body of an operator playbook. Return only valid JSON. Make it denser, clearer, and more action-ready.' },
          { role: 'user', content: buildOperatorPlaybookFocusedBodyPrompt(input, targetWords, activeRaw, retryReason || 'depth is still too weak') },
        ],
      });

      const focusedRaw = focused.output ? JSON.parse(focused.output) : null;
      const merged = mergeOperatorPlaybookExpansion(activeRaw, focusedRaw, template);
      if (merged) {
        const repairedEvaluation = getOperatorPlaybookComposite(merged.mergedParsed, targetWords);
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
      return { needs_clarification: false, mode: 'full', confidence: 'high', template_used: true, hook_assessment: { strength: 'moderate', note: 'Newsletter-owned operator playbook generation path used.' }, result: activeParsed, governance: buildGovernanceExplainabilityMetadata(null) };
    }

    retryReason = [
      `depth too weak (${score.breakdown.depth}/20)`,
      `seo too weak (${score.breakdown.seo}/15)`,
      score.meta.wordCount < Math.round(targetWords * 0.85) ? `draft far below target length (${score.meta.wordCount}/${targetWords} words)` : '',
      analysis.avgParagraphWords < 65 ? `average paragraph depth too light (${analysis.avgParagraphWords} words)` : '',
      analysis.frameworkCount < 3 ? `not enough framework steps (${analysis.frameworkCount})` : '',
      analysis.frameworkAvgWords < 9 ? `framework steps too generic (${analysis.frameworkAvgWords} words avg)` : '',
      analysis.breakdownAvgWords < 95 ? `step breakdowns too thin (${analysis.breakdownAvgWords} words avg)` : '',
      analysis.mistakesCount < 3 ? `not enough realistic mistakes (${analysis.mistakesCount})` : '',
      analysis.mistakesAvgWords < 11 ? `mistakes are too generic (${analysis.mistakesAvgWords} words avg)` : '',
      analysis.ctaWords < 45 ? `CTA too thin (${analysis.ctaWords} words)` : '',
      !activeParsed.excerpt || activeParsed.excerpt.trim().length < 80 ? `excerpt too weak (${activeParsed.excerpt?.trim().length || 0} chars)` : '',
      !activeParsed.seo_meta_title || activeParsed.seo_meta_title.trim().length < 35 ? `seo title too weak (${activeParsed.seo_meta_title?.trim().length || 0} chars)` : '',
      !activeParsed.seo_meta_description || activeParsed.seo_meta_description.trim().length < 110 ? `seo description too weak (${activeParsed.seo_meta_description?.trim().length || 0} chars)` : '',
    ].filter(Boolean).join('; ');

    if (composite > bestScore) { bestScore = composite; best = activeParsed; }
  }

  if (best) {
    return { needs_clarification: false, mode: 'full', confidence: 'medium', template_used: true, hook_assessment: { strength: 'moderate', note: 'Newsletter-owned operator playbook generation path used.' }, result: best, governance: buildGovernanceExplainabilityMetadata(null) };
  }
  throw new Error('Failed to generate Operator Playbook newsletter');
}
