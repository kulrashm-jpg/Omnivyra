import { runCompletionWithOperation } from '../../content/engine/generator';
import { flattenBlocks } from './blockUtils';
import type { ContentBlock } from './blockTypes';
import type { BlogGenerationInput } from '../../content/engine/generator';
import { buildSectionEnforcementPrompt, type CompanyIdentity } from '../content/companyContextBlock';

type ClassicDraft = {
  title: string;
  excerpt: string;
  seo_meta_title: string;
  seo_meta_description: string;
  tags: string[];
  category: string;
  key_insights: string[];
  content_blocks: ContentBlock[];
};

type ParagraphBlueprint = {
  index: number;
  heading: string;
  hint: string;
};

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function buildExcerptFromBlocks(blocks: ContentBlock[]): string {
  const text = flattenBlocks(blocks)
    .flatMap((block) => {
      switch (block.type) {
        case 'paragraph':
          return [stripHtml(block.html)];
        case 'summary':
          return [block.body.trim()];
        case 'key_insights':
          return [block.items.join(' ').trim()];
        case 'callout':
          return [`${block.title ?? ''} ${block.body ?? ''}`.trim()];
        default:
          return [];
      }
    })
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) return '';
  if (text.length <= 150) return text;
  return `${text.slice(0, 157).trim().replace(/[,:;.\-\s]+$/g, '')}...`;
}

function collectParagraphBlueprints(blocks: ContentBlock[]): ParagraphBlueprint[] {
  const blueprints: ParagraphBlueprint[] = [];

  const walk = (input: ContentBlock[], currentHeading: string) => {
    let heading = currentHeading;
    for (const block of input) {
      if (block.type === 'heading') {
        heading = String(block.text || block.hint || '').trim() || heading;
        continue;
      }
      if (block.type === 'columns') {
        for (const column of block.columns) {
          walk(column.blocks, heading);
        }
        continue;
      }
      if (block.type === 'paragraph') {
        blueprints.push({
          index: blueprints.length + 1,
          heading,
          hint: String(block.hint ?? '').trim(),
        });
      }
    }
  };

  walk(blocks, '');
  return blueprints;
}

function materializeHeadingText(blocks: ContentBlock[]): ContentBlock[] {
  return blocks.map((block) => {
    if (block.type === 'columns') {
      return {
        ...block,
        columns: block.columns.map((column) => ({
          ...column,
          blocks: materializeHeadingText(column.blocks),
        })),
      };
    }

    if (block.type === 'heading' && !String(block.text ?? '').trim() && String(block.hint ?? '').trim()) {
      return {
        ...block,
        text: String(block.hint).trim(),
      };
    }

    return block;
  });
}

function analyzeClassicBlocks(blocks: ContentBlock[]) {
  const flat = flattenBlocks(blocks);
  const paragraphWordCounts = flat
    .filter((block): block is Extract<ContentBlock, { type: 'paragraph' }> => block.type === 'paragraph')
    .map((block) => stripHtml(block.html).split(/\s+/).filter(Boolean).length);
  const refsCount = flat.reduce((count, block) => {
    if (block.type !== 'references') return count;
    return count + block.items.filter((item) => item.title.trim() || item.url.trim()).length;
  }, 0);
  const emptyCallouts = flat.filter((block) => block.type === 'callout' && !String(block.body ?? '').trim()).length;
  return {
    wordCount: countWords(blocks),
    paragraphWordCounts,
    refsCount,
    emptyCallouts,
  };
}

function applyClassicDraft(
  blocks: ContentBlock[],
  repair: {
    key_insights?: unknown;
    paragraphs?: unknown;
    summary_body?: unknown;
    references?: unknown;
  },
): ContentBlock[] {
  const paragraphEntries = Array.isArray(repair.paragraphs) ? repair.paragraphs : [];
  const repairedInsights = Array.isArray(repair.key_insights)
    ? repair.key_insights.map((item) => String(item ?? '').trim()).filter(Boolean)
    : [];
  const repairedRefs = Array.isArray(repair.references)
    ? repair.references.map((ref: any) => ({
        title: String(typeof ref === 'string' ? ref : ref?.title ?? ref?.text ?? '').trim(),
        url: String(typeof ref === 'string' ? '' : ref?.url ?? ref?.href ?? '').trim(),
      })).filter((ref) => ref.title || ref.url)
    : [];
  const repairedSummary = typeof repair.summary_body === 'string' ? repair.summary_body.trim() : '';

  let paragraphCursor = 0;

  const mapBlocks = (input: ContentBlock[]): ContentBlock[] => input.map((block) => {
    if (block.type === 'columns') {
      return {
        ...block,
        columns: block.columns.map((column) => ({
          ...column,
          blocks: mapBlocks(column.blocks),
        })),
      };
    }

    if (block.type === 'paragraph') {
      const nextEntry = paragraphEntries[paragraphCursor++];
      const html =
        typeof nextEntry === 'string' ? nextEntry.trim() :
        typeof nextEntry?.html === 'string' ? nextEntry.html.trim() :
        '';
      return html ? { ...block, html } : block;
    }

    if (block.type === 'key_insights' && repairedInsights.length > 0) {
      return {
        ...block,
        items: block.items.map((_, index) => repairedInsights[index] ?? ''),
      };
    }

    if (block.type === 'summary' && repairedSummary) {
      return { ...block, body: repairedSummary };
    }

    if (block.type === 'references' && repairedRefs.length > 0) {
      return {
        ...block,
        items: block.items.map((existing, index) => ({
          ...existing,
          title: repairedRefs[index]?.title ?? '',
          url: repairedRefs[index]?.url ?? '',
        })),
      };
    }

    return block;
  });

  return materializeHeadingText(mapBlocks(blocks));
}

function countWords(blocks: ContentBlock[]): number {
  return flattenBlocks(blocks).reduce((sum, block) => {
    switch (block.type) {
      case 'paragraph':
        return sum + stripHtml(block.html).split(/\s+/).filter(Boolean).length;
      case 'summary':
        return sum + block.body.split(/\s+/).filter(Boolean).length;
      case 'key_insights':
        return sum + block.items.join(' ').split(/\s+/).filter(Boolean).length;
      case 'callout':
        return sum + `${block.title ?? ''} ${block.body ?? ''}`.trim().split(/\s+/).filter(Boolean).length;
      case 'references':
        return sum + block.items.map((item) => `${item.title} ${item.url}`).join(' ').split(/\s+/).filter(Boolean).length;
      default:
        return sum;
    }
  }, 0);
}

export async function runClassicBlogGeneration(args: {
  companyId: string;
  cacheVersion?: string;
  topic: string;
  templateBlocks: ContentBlock[];
  generationInput: BlogGenerationInput;
  targetWords: number;
  angleLabel?: string;
}): Promise<ClassicDraft | null> {
  const paragraphBlueprints = collectParagraphBlueprints(args.templateBlocks);
  const paragraphTarget = Math.max(
    args.targetWords >= 2000 ? 180 : args.targetWords >= 1200 ? 145 : 120,
    Math.round((args.targetWords * 0.82) / Math.max(1, paragraphBlueprints.length)),
  );
  const summaryTarget = Math.max(90, Math.round(args.targetWords * 0.1));
  const minAcceptable = Math.round(args.targetWords * 0.85);

  // Count template insight slots so AI generates the right number
  const insightSlotCount = args.templateBlocks
    .filter((b: any) => b.type === 'key_insights')
    .reduce((sum: number, b: any) => sum + (Array.isArray(b.items) ? b.items.length : 3), 0) || 3;

  // Build company context block from generationInput.answers
  const a = args.generationInput.answers || {};
  const companyContextBlock = [
    a.companyName ? `Company: ${a.companyName}` : null,
    a.industry ? `Industry: ${a.industry}` : null,
    a.audience || a.target_audience ? `Target audience: ${a.audience || a.target_audience}` : null,
    a.uniqueness_directive ? `Unique positioning: ${a.uniqueness_directive}` : null,
    a.must_include_points ? `Must-include points: ${a.must_include_points}` : null,
    a.campaign_objective ? `Campaign objective: ${a.campaign_objective}` : null,
    a.trend_context ? `Market context: ${a.trend_context}` : null,
  ].filter(Boolean).join('\n');

  // Build identity for section enforcement in repair prompts
  const _sectionIdentity: CompanyIdentity = {
    companyName: a.companyName || undefined,
    industry: a.industry || undefined,
    targetAudience: a.audience || a.target_audience || undefined,
    coreProblem: a.campaign_objective || undefined,
    painPoints: a.must_include_points
      ? a.must_include_points.split(';').map(s => s.trim()).filter(s => s.length > 10).slice(0, 4)
      : undefined,
    uniqueValue: a.uniqueness_directive || undefined,
    productsServices: undefined, // not available from answers
    desiredTransformation: undefined,
  };

  let best: ClassicDraft | null = null;
  let bestWordCount = 0;

  for (let attempt = 0; attempt < 2; attempt++) {
    const completion = await runCompletionWithOperation({
      operation: 'blogGeneration',
      companyId: args.companyId,
      cache_version: `${args.cacheVersion ?? ''}:classic-dedicated:${attempt}`,
      model: 'gpt-4o',
      temperature: attempt === 0 ? 0.35 : 0.45,
      response_format: { type: 'json_object' },
      max_tokens: Math.min(16384, Math.max(4096, Math.round(args.targetWords * 6))),
      messages: [
        {
          role: 'system',
          content:
            `You are writing a Classic long-form B2B blog article.\n` +
            `Return JSON only with this exact shape:\n` +
            `{\n` +
            `  "title": "string",\n` +
            `  "excerpt": "string",\n` +
            `  "seo_meta_title": "string",\n` +
            `  "seo_meta_description": "string",\n` +
            `  "tags": ["string"],\n` +
            `  "category": "string",\n` +
            `  "key_insights": [${Array.from({ length: insightSlotCount }, () => '"..."').join(', ')}],\n` +
            `  "paragraphs": [{ "html": "<p>...</p><p>...</p>" }],\n` +
            `  "summary_body": "string",\n` +
            `  "references": [{ "title": "...", "url": "..." }]\n` +
            `}\n` +
            `\nFORMAT RULES:\n` +
            `- Write a complete article, not a skeleton.\n` +
            `- Return exactly ${paragraphBlueprints.length} paragraph entries in order.\n` +
            `- Each paragraph entry must contain at least ${paragraphTarget} words of real editorial content.\n` +
            `- Use valid HTML with 2-3 <p> tags per paragraph entry.\n` +
            `- The full article must reach at least ${minAcceptable} words and aim for ${args.targetWords} words.\n` +
            `- key_insights must contain exactly ${insightSlotCount} specific standalone insights. Fill every slot.\n` +
            `- summary_body must contain at least ${summaryTarget} words.\n` +
            `- references must contain at least 3 credible entries with real titles and URLs whenever possible.\n` +
            `- Do not output placeholders, repeated headings, or block labels as paragraph content.\n` +
            `\nCONTENT QUALITY RULES (MANDATORY):\n` +
            `- Every section MUST reference the company context below. Do NOT write generic content.\n` +
            `- Use specific scenarios, workflows, or real-world situations — not abstract statements.\n` +
            `- Include at least one contrarian insight or non-obvious observation per major section.\n` +
            `- Replace buzzwords with concrete examples (e.g., instead of "optimize efficiency", describe a specific workflow improvement).\n` +
            `- The article must read as if written BY this specific company, not ABOUT a generic topic.\n` +
            (args.generationInput.writingStyleInstructions ? `\nWRITING STYLE:\n${args.generationInput.writingStyleInstructions}\n` : ''),
        },
        {
          role: 'user',
          content:
            `Topic: ${args.topic}\n` +
            `Angle: ${args.angleLabel || args.generationInput.selected_angle?.label || 'Analytical'}\n` +
            `Working title: ${args.generationInput.selected_angle?.title || args.topic}\n` +
            `Hook: ${args.generationInput.selected_angle?.hook || ''}\n` +
            `Audience: ${args.generationInput.answers?.target_audience || args.generationInput.answers?.audience || 'B2B operators and decision-makers'}\n` +
            `Intent: ${args.generationInput.intent || 'authority'}\n` +
            `Tone: ${args.generationInput.tone || 'expert'}\n` +
            (companyContextBlock ? `\nCOMPANY CONTEXT (use this throughout the article):\n${companyContextBlock}\n` : '') +
            `${args.generationInput.unifiedPromptContext ? `\nMARKET INTELLIGENCE:\n${args.generationInput.unifiedPromptContext}\n` : ''}` +
            `\nParagraph slots to fill in order:\n` +
            `${paragraphBlueprints.map((item) => `- Paragraph ${item.index}: section "${item.heading || 'Body'}" :: ${item.hint || 'Write full-bodied editorial content for this section.'}`).join('\n')}\n\n` +
            `Write the full Classic article now. Remember: reference the company context in every section.`,
        },
      ],
    });

    let raw: any = null;
    try {
      raw = completion.output ? JSON.parse(completion.output) : null;
    } catch {
      raw = null;
    }
    if (!raw || typeof raw !== 'object') continue;

    const contentBlocks = applyClassicDraft(args.templateBlocks, raw);
    const wordCount = countWords(contentBlocks);
    if (wordCount > bestWordCount) {
      bestWordCount = wordCount;
      const excerpt = typeof raw.excerpt === 'string' && raw.excerpt.trim()
        ? raw.excerpt.trim()
        : buildExcerptFromBlocks(contentBlocks);
      best = {
        title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : (args.generationInput.selected_angle?.title || args.topic),
        excerpt,
        seo_meta_title: typeof raw.seo_meta_title === 'string' && raw.seo_meta_title.trim() ? raw.seo_meta_title.trim() : (typeof raw.title === 'string' ? raw.title.trim() : args.topic).slice(0, 60),
        seo_meta_description: typeof raw.seo_meta_description === 'string' && raw.seo_meta_description.trim() ? raw.seo_meta_description.trim() : excerpt,
        tags: Array.isArray(raw.tags) ? raw.tags.map((tag: unknown) => String(tag ?? '').trim()).filter(Boolean) : [],
        category: typeof raw.category === 'string' ? raw.category.trim() : '',
        key_insights: Array.isArray(raw.key_insights) ? raw.key_insights.map((item: unknown) => String(item ?? '').trim()).filter(Boolean) : [],
        content_blocks: contentBlocks,
      };
    }
  }

  if (best) {
    const analysis = analyzeClassicBlocks(best.content_blocks);
    const needsSectionRepair =
      analysis.wordCount < minAcceptable ||
      analysis.refsCount < 3 ||
      analysis.emptyCallouts > 0 ||
      analysis.paragraphWordCounts.some((count) => count < Math.max(70, Math.round(paragraphTarget * 0.55)));

    if (needsSectionRepair) {
      const repairedParagraphs: Array<{ html: string }> = [];

      for (const blueprint of paragraphBlueprints) {
        const result = await runCompletionWithOperation({
          operation: 'blogGeneration',
          companyId: args.companyId,
          cache_version: `${args.cacheVersion ?? ''}:classic-section:${blueprint.index}`,
          model: 'gpt-4o',
          temperature: 0.35,
          response_format: { type: 'json_object' },
          max_tokens: 1200,
          messages: [
            {
              role: 'system',
              content:
                `You are writing one section of a Classic long-form B2B article.\n` +
                `Return JSON only: { "html": "<p>...</p><p>...</p>" }\n` +
                `Rules:\n` +
                `- Write valid HTML using 2-3 <p> tags\n` +
                `- Write at least ${paragraphTarget} words\n` +
                `- Add explanation, examples, implications, and practitioner-useful detail\n` +
                `- Reference the company context below — do not write generic content\n` +
                `- Include at least one specific scenario or real-world example\n` +
                `- Do not use bullets, headings, or placeholders\n` +
                buildSectionEnforcementPrompt(_sectionIdentity, blueprint.index - 1),
            },
            {
              role: 'user',
              content:
                `Topic: ${args.topic}\n` +
                `Section heading: ${blueprint.heading || 'Body section'}\n` +
                `Section brief: ${blueprint.hint || 'Write a full-bodied Classic article section.'}\n` +
                `Target article length: ${args.targetWords} words\n` +
                `Angle: ${args.angleLabel || args.generationInput.selected_angle?.label || 'Analytical'}\n` +
                (companyContextBlock ? `\nCompany context:\n${companyContextBlock}\n` : '') +
                `Write this section now.`,
            },
          ],
        });

        let html = '';
        try {
          const raw = result.output ? JSON.parse(result.output) : null;
          html = typeof raw?.html === 'string' ? raw.html.trim() : '';
        } catch {
          html = '';
        }

        repairedParagraphs.push({ html });
      }

      const supportResult = await runCompletionWithOperation({
        operation: 'blogGeneration',
        companyId: args.companyId,
        cache_version: `${args.cacheVersion ?? ''}:classic-support`,
        model: 'gpt-4o',
        temperature: 0.3,
        response_format: { type: 'json_object' },
        max_tokens: 1800,
        messages: [
          {
            role: 'system',
            content:
              `You are writing the support blocks for a Classic blog article.\n` +
              `Return JSON only:\n` +
              `{\n` +
              `  "excerpt": "string",\n` +
              `  "seo_meta_description": "string",\n` +
              `  "key_insights": ["...", "...", "..."],\n` +
              `  "callout_body": "string",\n` +
              `  "summary_body": "string",\n` +
              `  "references": [{ "title": "...", "url": "..." }]\n` +
              `}\n` +
              `Rules:\n` +
              `- key_insights must include at least 3 concrete, standalone takeaways\n` +
              `- callout_body must be a sharp strategic takeaway sentence or short paragraph\n` +
              `- summary_body must be at least ${summaryTarget} words\n` +
              `- references must include at least 3 credible sources with real titles and URLs whenever possible\n`,
          },
          {
            role: 'user',
            content:
              `Topic: ${args.topic}\n` +
              `Angle: ${args.angleLabel || args.generationInput.selected_angle?.label || 'Analytical'}\n` +
              `Write the support blocks for this Classic article so it feels complete and authoritative.`,
          },
        ],
      });

      let supportRaw: any = null;
      try {
        supportRaw = supportResult.output ? JSON.parse(supportResult.output) : null;
      } catch {
        supportRaw = null;
      }

      const rebuiltBlocks = applyClassicDraft(best.content_blocks, {
        key_insights: supportRaw?.key_insights,
        paragraphs: repairedParagraphs,
        summary_body: supportRaw?.summary_body,
        references: supportRaw?.references,
      }).map((block) => {
        if (block.type === 'callout') {
          const body = typeof supportRaw?.callout_body === 'string' ? supportRaw.callout_body.trim() : '';
          return body ? { ...block, body } : block;
        }
        return block;
      });

      const rebuiltExcerpt = typeof supportRaw?.excerpt === 'string' && supportRaw.excerpt.trim()
        ? supportRaw.excerpt.trim()
        : buildExcerptFromBlocks(rebuiltBlocks);

      best = {
        ...best,
        excerpt: rebuiltExcerpt,
        seo_meta_description: typeof supportRaw?.seo_meta_description === 'string' && supportRaw.seo_meta_description.trim()
          ? supportRaw.seo_meta_description.trim()
          : rebuiltExcerpt,
        key_insights: Array.isArray(supportRaw?.key_insights)
          ? supportRaw.key_insights.map((item: unknown) => String(item ?? '').trim()).filter(Boolean)
          : best.key_insights,
        content_blocks: rebuiltBlocks,
      };
    }
  }

  return best;
}


