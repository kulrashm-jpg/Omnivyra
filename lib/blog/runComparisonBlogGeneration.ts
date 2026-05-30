import { runCompletionWithOperation } from '../../backend/services/aiGateway';
import { flattenBlocks } from './blockUtils';
import type { ContentBlock } from './blockTypes';
import type { BlogGenerationInput } from './blogGenerationEngine';
import { buildSectionEnforcementPrompt, type CompanyIdentity } from '../content/companyContextBlock';

type ComparisonDraft = {
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

type ListBlueprint = {
  index: number;
  heading: string;
  hint: string;
  slotCount: number;
};

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
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
        return sum + `${block.title ?? ''} ${block.body ?? ''}`.split(/\s+/).filter(Boolean).length;
      case 'list':
        return sum + block.items.map((item) => item.text).join(' ').split(/\s+/).filter(Boolean).length;
      default:
        return sum;
    }
  }, 0);
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
        case 'list':
          return [block.items.map((item) => item.text).join(' ').trim()];
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

function collectComparisonBlueprints(blocks: ContentBlock[]) {
  const paragraphs: ParagraphBlueprint[] = [];
  const lists: ListBlueprint[] = [];

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
        paragraphs.push({
          index: paragraphs.length + 1,
          heading,
          hint: String(block.hint ?? '').trim(),
        });
      }
      if (block.type === 'list') {
        lists.push({
          index: lists.length + 1,
          heading,
          hint: String(block.hint ?? '').trim(),
          slotCount: block.items.length,
        });
      }
    }
  };

  walk(blocks, '');
  return { paragraphs, lists };
}

function applyComparisonDraft(
  blocks: ContentBlock[],
  repair: {
    key_insights?: unknown;
    paragraphs?: unknown;
    lists?: unknown;
    callout_body?: unknown;
    summary_body?: unknown;
    references?: unknown;
  },
): ContentBlock[] {
  const paragraphEntries = Array.isArray(repair.paragraphs) ? repair.paragraphs : [];
  const listEntries = Array.isArray(repair.lists) ? repair.lists : [];
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
  const repairedCallout = typeof repair.callout_body === 'string' ? repair.callout_body.trim() : '';

  let paragraphCursor = 0;
  let listCursor = 0;

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

    if (block.type === 'heading' && !String(block.text ?? '').trim() && String(block.hint ?? '').trim()) {
      return {
        ...block,
        text: String(block.hint).trim(),
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

    if (block.type === 'list') {
      const nextList = listEntries[listCursor++];
      const items = Array.isArray(nextList)
        ? nextList.map((item) => String(item ?? '').trim()).filter(Boolean)
        : Array.isArray(nextList?.items)
        ? nextList.items.map((item: any) => String(typeof item === 'string' ? item : item?.text ?? '').trim()).filter(Boolean)
        : [];
      return items.length > 0
        ? { ...block, items: block.items.map((existing, index) => ({ ...existing, text: items[index] ?? existing.text })) }
        : block;
    }

    if (block.type === 'key_insights' && repairedInsights.length > 0) {
      return { ...block, items: block.items.map((_, index) => repairedInsights[index] ?? '') };
    }

    if (block.type === 'callout' && repairedCallout) {
      return { ...block, body: repairedCallout };
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

  return mapBlocks(blocks);
}

export async function runComparisonBlogGeneration(args: {
  companyId: string;
  cacheVersion?: string;
  topic: string;
  templateBlocks: ContentBlock[];
  generationInput: BlogGenerationInput;
  targetWords: number;
  angleLabel?: string;
  /** Blog Governance Parity — optional governance prompt context. */
  governance?: import('../../backend/services/creator/strategyGovernancePromptContext').GovernancePromptContext | null;
}): Promise<ComparisonDraft | null> {
  // Blog Governance Parity — lazy-imported shared helper.
  const { applyGovernancePreambleToSystemPrompt } =
    await import('../../backend/services/creator/strategyGovernancePromptContext');
  const govPreamble = (base: string) =>
    applyGovernancePreambleToSystemPrompt(base, args.governance ?? null);
  // ── Company context injection ──
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

  const _sectionIdentity: CompanyIdentity = {
    companyName: a.companyName || undefined,
    targetAudience: a.audience || a.target_audience || undefined,
    coreProblem: a.campaign_objective || undefined,
    painPoints: a.must_include_points
      ? a.must_include_points.split(';').map(s => s.trim()).filter(s => s.length > 10).slice(0, 4)
      : undefined,
    uniqueValue: a.uniqueness_directive || undefined,
  };

  const { paragraphs, lists } = collectComparisonBlueprints(args.templateBlocks);
  const paragraphTarget = Math.max(
    args.targetWords >= 1600 ? 160 : args.targetWords >= 1200 ? 140 : 120,
    Math.round((args.targetWords * 0.82) / Math.max(1, paragraphs.length)),
  );
  const summaryTarget = Math.max(90, Math.round(args.targetWords * 0.1));
  const listItemTarget = args.targetWords >= 1600 ? 5 : 4;
  const minAcceptable = Math.round(args.targetWords * 0.85);

  const completion = await runCompletionWithOperation({
    operation: 'blogGeneration',
    companyId: args.companyId,
    cache_version: `${args.cacheVersion ?? ''}:comparison-dedicated`,
    model: 'gpt-4o',
    temperature: 0.35,
    response_format: { type: 'json_object' },
    max_tokens: Math.min(16384, Math.max(4096, Math.round(args.targetWords * 6))),
    messages: [
      {
        role: 'system',
        content: govPreamble(
          `You are writing a comparison-style B2B blog article.\n` +
          (companyContextBlock ? `\nCOMPANY CONTEXT:\n${companyContextBlock}\n\n` : '') +
          `CONTENT QUALITY RULES (MANDATORY):\n` +
          `- Every section MUST reference the company context above. Do NOT write generic content.\n` +
          `- Use specific scenarios, workflows, or real-world situations — not abstract statements.\n` +
          `- Include at least one contrarian insight or non-obvious observation per major section.\n` +
          `- Replace buzzwords with concrete examples.\n` +
          `- The article must read as if written BY this specific company, not ABOUT a generic topic.\n\n` +
          `Return JSON only with this exact shape:\n` +
          `{\n` +
          `  "title": "string",\n` +
          `  "excerpt": "string",\n` +
          `  "seo_meta_title": "string",\n` +
          `  "seo_meta_description": "string",\n` +
          `  "tags": ["string"],\n` +
          `  "category": "string",\n` +
          `  "key_insights": ["...", "...", "..."],\n` +
          `  "paragraphs": [{ "html": "<p>...</p><p>...</p>" }],\n` +
          `  "lists": [["...", "..."]],\n` +
          `  "callout_body": "string",\n` +
          `  "summary_body": "string",\n` +
          `  "references": [{ "title": "...", "url": "..." }]\n` +
          `}\n` +
          `Rules:\n` +
          `- Return exactly ${paragraphs.length} paragraph entries in order.\n` +
          `- Return exactly ${lists.length} list entries in order.\n` +
          `- Each paragraph entry must use valid HTML with 2-3 <p> tags and contain at least ${paragraphTarget} words.\n` +
          `- Each list should contain at least ${listItemTarget} filled items unless the source block has fewer slots.\n` +
          `- Every section must be decision-useful: explain strengths, tradeoffs, ideal use cases, and recommendation logic.\n` +
          `- callout_body must state a clear verdict or decision framing.\n` +
          `- summary_body must contain at least ${summaryTarget} words.\n` +
          `- references must contain at least 3 credible entries with real titles and URLs whenever possible.\n`,
        ),
      },
      {
        role: 'user',
        content:
          `Topic: ${args.topic}\n` +
          `Angle: ${args.angleLabel || args.generationInput.selected_angle?.label || 'Analytical'}\n` +
          `Working title: ${args.generationInput.selected_angle?.title || args.topic}\n` +
          (companyContextBlock ? `\nCOMPANY CONTEXT:\n${companyContextBlock}\n` : '') +
          `${args.generationInput.unifiedPromptContext ? `\nMARKET INTELLIGENCE:\n${args.generationInput.unifiedPromptContext}\n` : ''}` +
          `\nParagraph slots to fill in order:\n` +
          `${paragraphs.map((item) => `- Paragraph ${item.index}: section "${item.heading || 'Comparison section'}" :: ${item.hint || 'Write a full comparison section.'}`).join('\n')}\n\n` +
          `List slots to fill in order:\n` +
          `${lists.map((item) => `- List ${item.index}: section "${item.heading || 'Comparison list'}" :: ${item.hint || 'Write concrete comparison bullets.'} :: ${item.slotCount} slots`).join('\n')}\n\n` +
          `Write the full comparison article now.`,
      },
    ],
  });

  let raw: any = null;
  try {
    raw = completion.output ? JSON.parse(completion.output) : null;
  } catch {
    raw = null;
  }
  if (!raw || typeof raw !== 'object') return null;

  let draft: ComparisonDraft = {
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : (args.generationInput.selected_angle?.title || args.topic),
    excerpt: typeof raw.excerpt === 'string' && raw.excerpt.trim()
      ? raw.excerpt.trim()
      : buildExcerptFromBlocks(applyComparisonDraft(args.templateBlocks, raw)),
    seo_meta_title: typeof raw.seo_meta_title === 'string' && raw.seo_meta_title.trim() ? raw.seo_meta_title.trim() : (typeof raw.title === 'string' ? raw.title.trim() : args.topic).slice(0, 60),
    seo_meta_description: typeof raw.seo_meta_description === 'string' && raw.seo_meta_description.trim() ? raw.seo_meta_description.trim() : '',
    tags: Array.isArray(raw.tags) ? raw.tags.map((tag: unknown) => String(tag ?? '').trim()).filter(Boolean) : [],
    category: typeof raw.category === 'string' ? raw.category.trim() : '',
    key_insights: Array.isArray(raw.key_insights) ? raw.key_insights.map((item: unknown) => String(item ?? '').trim()).filter(Boolean) : [],
    content_blocks: applyComparisonDraft(args.templateBlocks, raw),
  };
  draft.seo_meta_description = draft.seo_meta_description || draft.excerpt;

  const currentWordCount = countWords(draft.content_blocks);
  const refsCount = flattenBlocks(draft.content_blocks).reduce((count, block) => {
    if (block.type !== 'references') return count;
    return count + block.items.filter((item) => item.title.trim() || item.url.trim()).length;
  }, 0);
  const thinParagraphs = flattenBlocks(draft.content_blocks)
    .filter((block): block is Extract<ContentBlock, { type: 'paragraph' }> => block.type === 'paragraph')
    .filter((block) => stripHtml(block.html).split(/\s+/).filter(Boolean).length < Math.max(75, Math.round(paragraphTarget * 0.55)))
    .length;

  if (currentWordCount < minAcceptable || refsCount < 3 || thinParagraphs > 0) {
    const repairedParagraphs: Array<{ html: string }> = [];
    const repairedLists: string[][] = [];

    for (const blueprint of paragraphs) {
      const sectionResult = await runCompletionWithOperation({
        operation: 'blogGeneration',
        companyId: args.companyId,
        cache_version: `${args.cacheVersion ?? ''}:comparison-section:${blueprint.index}`,
        model: 'gpt-4o',
        temperature: 0.35,
        response_format: { type: 'json_object' },
        max_tokens: 1200,
        messages: [
          {
            role: 'system',
            content: govPreamble(
              `Return JSON only: { "html": "<p>...</p><p>...</p>" }\n` +
              `Write one decision-grade comparison section with at least ${paragraphTarget} words.\n` +
              `Use 2-3 <p> tags, cover strengths, tradeoffs, and scenario fit, and do not output headings or bullets.\n` +
              (companyContextBlock ? `Reference this company context throughout:\n${companyContextBlock}\n` : '') +
              buildSectionEnforcementPrompt(_sectionIdentity, blueprint.index - 1),
            ),
          },
          {
            role: 'user',
            content:
              `Topic: ${args.topic}\n` +
              `Section heading: ${blueprint.heading || 'Comparison section'}\n` +
              `Section brief: ${blueprint.hint || 'Write a full comparison section.'}\n`,
          },
        ],
      });

      let html = '';
      try {
        const sectionRaw = sectionResult.output ? JSON.parse(sectionResult.output) : null;
        html = typeof sectionRaw?.html === 'string' ? sectionRaw.html.trim() : '';
      } catch {
        html = '';
      }
      repairedParagraphs.push({ html });
    }

    for (const blueprint of lists) {
      const listResult = await runCompletionWithOperation({
        operation: 'blogGeneration',
        companyId: args.companyId,
        cache_version: `${args.cacheVersion ?? ''}:comparison-list:${blueprint.index}`,
        model: 'gpt-4o',
        temperature: 0.3,
        response_format: { type: 'json_object' },
        max_tokens: 800,
        messages: [
          {
            role: 'system',
            content: govPreamble(
              `Return JSON only: { "items": ["...", "..."] }\n` +
              `Write a concrete comparison list with at least ${Math.min(listItemTarget, blueprint.slotCount)} items.\n`,
            ),
          },
          {
            role: 'user',
            content:
              `Topic: ${args.topic}\n` +
              `List heading: ${blueprint.heading || 'Comparison list'}\n` +
              `List brief: ${blueprint.hint || 'Write comparison criteria bullets.'}\n`,
          },
        ],
      });

      let items: string[] = [];
      try {
        const listRaw = listResult.output ? JSON.parse(listResult.output) : null;
        items = Array.isArray(listRaw?.items) ? listRaw.items.map((item: unknown) => String(item ?? '').trim()).filter(Boolean) : [];
      } catch {
        items = [];
      }
      repairedLists.push(items);
    }

    const supportResult = await runCompletionWithOperation({
      operation: 'blogGeneration',
      companyId: args.companyId,
      cache_version: `${args.cacheVersion ?? ''}:comparison-support`,
      model: 'gpt-4o',
      temperature: 0.3,
      response_format: { type: 'json_object' },
      max_tokens: 1800,
      messages: [
        {
          role: 'system',
          content: govPreamble(
            `Return JSON only with keys excerpt, seo_meta_description, key_insights, callout_body, summary_body, references.\n` +
            `callout_body must state a clear verdict. summary_body must be at least ${summaryTarget} words. references must include at least 3 credible entries.\n`,
          ),
        },
        {
          role: 'user',
          content: `Topic: ${args.topic}\nWrite the support blocks for a decision-grade comparison article so it feels complete and reference-backed.`,
        },
      ],
    });

    let supportRaw: any = null;
    try {
      supportRaw = supportResult.output ? JSON.parse(supportResult.output) : null;
    } catch {
      supportRaw = null;
    }

    const rebuiltBlocks = applyComparisonDraft(draft.content_blocks, {
      key_insights: supportRaw?.key_insights,
      paragraphs: repairedParagraphs,
      lists: repairedLists,
      callout_body: supportRaw?.callout_body,
      summary_body: supportRaw?.summary_body,
      references: supportRaw?.references,
    });
    const rebuiltExcerpt = typeof supportRaw?.excerpt === 'string' && supportRaw.excerpt.trim()
      ? supportRaw.excerpt.trim()
      : buildExcerptFromBlocks(rebuiltBlocks);

    draft = {
      ...draft,
      excerpt: rebuiltExcerpt,
      seo_meta_description: typeof supportRaw?.seo_meta_description === 'string' && supportRaw.seo_meta_description.trim()
        ? supportRaw.seo_meta_description.trim()
        : rebuiltExcerpt,
      key_insights: Array.isArray(supportRaw?.key_insights)
        ? supportRaw.key_insights.map((item: unknown) => String(item ?? '').trim()).filter(Boolean)
        : draft.key_insights,
      content_blocks: rebuiltBlocks,
    };
  }

  return draft;
}
