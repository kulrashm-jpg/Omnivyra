import { runCompletionWithOperation } from '../../backend/services/aiGateway';
import { flattenBlocks } from './blockUtils';
import type { ContentBlock } from './blockTypes';
import type { BlogGenerationInput } from './blogGenerationEngine';

type EditorialDraft = {
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

type ImageBlueprint = {
  index: number;
  heading: string;
  hint: string;
};

type QuoteBlueprint = {
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
        case 'quote':
          return [`${block.text ?? ''} ${block.author ?? ''}`.trim()];
        case 'image':
          return [`${block.alt ?? ''} ${block.caption ?? ''}`.trim()];
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

function collectEditorialBlueprints(blocks: ContentBlock[]) {
  const paragraphs: ParagraphBlueprint[] = [];
  const images: ImageBlueprint[] = [];
  const quotes: QuoteBlueprint[] = [];

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
      if (block.type === 'image') {
        images.push({
          index: images.length + 1,
          heading,
          hint: String(block.hint ?? '').trim(),
        });
      }
      if (block.type === 'quote') {
        quotes.push({
          index: quotes.length + 1,
          heading,
          hint: String(block.hint ?? '').trim(),
        });
      }
    }
  };

  walk(blocks, '');
  return { paragraphs, images, quotes };
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

function applyEditorialDraft(
  blocks: ContentBlock[],
  repair: {
    key_insights?: unknown;
    paragraphs?: unknown;
    images?: unknown;
    quotes?: unknown;
    callout_body?: unknown;
    summary_body?: unknown;
    references?: unknown;
  },
): ContentBlock[] {
  const paragraphEntries = Array.isArray(repair.paragraphs) ? repair.paragraphs : [];
  const imageEntries = Array.isArray(repair.images) ? repair.images : [];
  const quoteEntries = Array.isArray(repair.quotes) ? repair.quotes : [];
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
  let imageCursor = 0;
  let quoteCursor = 0;

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

    if (block.type === 'image') {
      const nextImage = imageEntries[imageCursor++];
      const alt = String(nextImage?.alt ?? '').trim();
      const caption = String(nextImage?.caption ?? '').trim();
      return (alt || caption)
        ? { ...block, alt: alt || block.alt || block.hint || '', caption: caption || block.caption }
        : block;
    }

    if (block.type === 'quote') {
      const nextQuote = quoteEntries[quoteCursor++];
      const text = String(nextQuote?.text ?? '').trim();
      const author = String(nextQuote?.author ?? '').trim();
      const source = String(nextQuote?.source ?? '').trim();
      return text ? { ...block, text, author, source } : block;
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
      case 'quote':
        return sum + `${block.text ?? ''} ${block.author ?? ''} ${block.source ?? ''}`.trim().split(/\s+/).filter(Boolean).length;
      case 'image':
        return sum + `${block.alt ?? ''} ${block.caption ?? ''}`.trim().split(/\s+/).filter(Boolean).length;
      case 'references':
        return sum + block.items.map((item) => `${item.title} ${item.url}`).join(' ').split(/\s+/).filter(Boolean).length;
      default:
        return sum;
    }
  }, 0);
}

export async function runEditorialBlogGeneration(args: {
  companyId: string;
  cacheVersion?: string;
  topic: string;
  templateBlocks: ContentBlock[];
  generationInput: BlogGenerationInput;
  targetWords: number;
  angleLabel?: string;
  templateLabel: 'Visual Feature' | 'Magazine';
}): Promise<EditorialDraft | null> {
  const { paragraphs, images, quotes } = collectEditorialBlueprints(args.templateBlocks);
  const paragraphTarget = Math.max(
    args.targetWords >= 1600 ? 165 : args.targetWords >= 1200 ? 145 : 125,
    Math.round((args.targetWords * 0.78) / Math.max(1, paragraphs.length)),
  );
  const summaryTarget = Math.max(90, Math.round(args.targetWords * 0.1));
  const minAcceptable = Math.round(args.targetWords * 0.82);

  const completion = await runCompletionWithOperation({
    operation: 'blogGeneration',
    companyId: args.companyId,
    cache_version: `${args.cacheVersion ?? ''}:${args.templateLabel.toLowerCase().replace(/\s+/g, '-')}:dedicated`,
    model: 'gpt-4o',
    temperature: 0.4,
    response_format: { type: 'json_object' },
    max_tokens: Math.min(16384, Math.max(4096, Math.round(args.targetWords * 6))),
    messages: [
      {
        role: 'system',
        content:
          `You are writing a ${args.templateLabel} blog article.\n` +
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
          `  "images": [{ "alt": "...", "caption": "..." }],\n` +
          `  "quotes": [{ "text": "...", "author": "...", "source": "..." }],\n` +
          `  "callout_body": "string",\n` +
          `  "summary_body": "string",\n` +
          `  "references": [{ "title": "...", "url": "..." }]\n` +
          `}\n` +
          `Rules:\n` +
          `- Return exactly ${paragraphs.length} paragraph entries in order.\n` +
          `- Return exactly ${images.length} image entries in order.\n` +
          `- Return exactly ${quotes.length} quote entries in order.\n` +
          `- Each paragraph entry must use valid HTML with 2-3 <p> tags and contain at least ${paragraphTarget} words.\n` +
          `- Fill every image alt and caption with concrete, relevant editorial text.\n` +
          `- Fill every quote with a real editorial-quality line; do not leave quotes blank.\n` +
          `- The article must reach at least ${minAcceptable} words and aim for ${args.targetWords} words.\n` +
          `- references must contain at least 3 credible entries with real titles and URLs whenever possible.\n` +
          `- summary_body must contain at least ${summaryTarget} words.\n`,
      },
      {
        role: 'user',
        content:
          `Topic: ${args.topic}\n` +
          `Angle: ${args.angleLabel || args.generationInput.selected_angle?.label || 'Analytical'}\n` +
          `Working title: ${args.generationInput.selected_angle?.title || args.topic}\n` +
          `${args.generationInput.unifiedPromptContext ? `\nAdditional context:\n${args.generationInput.unifiedPromptContext}\n` : ''}` +
          `\nParagraph slots to fill in order:\n` +
          `${paragraphs.map((item) => `- Paragraph ${item.index}: section "${item.heading || args.templateLabel}" :: ${item.hint || 'Write a full editorial section.'}`).join('\n')}\n\n` +
          `Image slots to fill in order:\n` +
          `${images.map((item) => `- Image ${item.index}: section "${item.heading || args.templateLabel}" :: ${item.hint || 'Write specific alt text and caption.'}`).join('\n')}\n\n` +
          `Quote slots to fill in order:\n` +
          `${quotes.map((item) => `- Quote ${item.index}: section "${item.heading || args.templateLabel}" :: ${item.hint || 'Write a sharp quote.'}`).join('\n')}\n\n` +
          `Write the full article now.`,
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

  let contentBlocks = applyEditorialDraft(args.templateBlocks, raw);

  const refsCount = flattenBlocks(contentBlocks).reduce((count, block) => {
    if (block.type !== 'references') return count;
    return count + block.items.filter((item) => item.title.trim() || item.url.trim()).length;
  }, 0);
  const thinParagraphs = flattenBlocks(contentBlocks)
    .filter((block): block is Extract<ContentBlock, { type: 'paragraph' }> => block.type === 'paragraph')
    .filter((block) => stripHtml(block.html).split(/\s+/).filter(Boolean).length < Math.max(75, Math.round(paragraphTarget * 0.55)))
    .length;
  const imagesMissingAlt = flattenBlocks(contentBlocks)
    .filter((block): block is Extract<ContentBlock, { type: 'image' }> => block.type === 'image')
    .filter((block) => !String(block.alt ?? '').trim())
    .length;
  const emptyQuotes = flattenBlocks(contentBlocks)
    .filter((block): block is Extract<ContentBlock, { type: 'quote' }> => block.type === 'quote')
    .filter((block) => !String(block.text ?? '').trim())
    .length;

  if (countWords(contentBlocks) < minAcceptable || refsCount < 3 || thinParagraphs > 0 || imagesMissingAlt > 0 || emptyQuotes > 0) {
    const repairedParagraphs: Array<{ html: string }> = [];
    const repairedImages: Array<{ alt: string; caption: string }> = [];
    const repairedQuotes: Array<{ text: string; author: string; source: string }> = [];

    for (const blueprint of paragraphs) {
      const sectionResult = await runCompletionWithOperation({
        operation: 'blogGeneration',
        companyId: args.companyId,
        cache_version: `${args.cacheVersion ?? ''}:${args.templateLabel.toLowerCase().replace(/\s+/g, '-')}:section:${blueprint.index}`,
        model: 'gpt-4o',
        temperature: 0.35,
        response_format: { type: 'json_object' },
        max_tokens: 1400,
        messages: [
          {
            role: 'system',
            content:
              `Return JSON only: { "html": "<p>...</p><p>...</p>" }\n` +
              `Write one substantial ${args.templateLabel} section with at least ${paragraphTarget} words.\n` +
              `Use 2-3 <p> tags, include analysis and examples, and do not output headings or bullets.\n`,
          },
          {
            role: 'user',
            content:
              `Topic: ${args.topic}\n` +
              `Section heading: ${blueprint.heading || args.templateLabel}\n` +
              `Section brief: ${blueprint.hint || 'Write a full editorial section.'}\n`,
          },
        ],
      });

      try {
        const sectionRaw = sectionResult.output ? JSON.parse(sectionResult.output) : null;
        repairedParagraphs.push({ html: String(sectionRaw?.html ?? '').trim() });
      } catch {
        repairedParagraphs.push({ html: '' });
      }
    }

    for (const blueprint of images) {
      const imageResult = await runCompletionWithOperation({
        operation: 'blogGeneration',
        companyId: args.companyId,
        cache_version: `${args.cacheVersion ?? ''}:${args.templateLabel.toLowerCase().replace(/\s+/g, '-')}:image:${blueprint.index}`,
        model: 'gpt-4o',
        temperature: 0.25,
        response_format: { type: 'json_object' },
        max_tokens: 500,
        messages: [
          {
            role: 'system',
            content: `Return JSON only: { "alt": "string", "caption": "string" }. Write specific, accessible, relevant image metadata.`,
          },
          {
            role: 'user',
            content:
              `Topic: ${args.topic}\n` +
              `Image section: ${blueprint.heading || args.templateLabel}\n` +
              `Image brief: ${blueprint.hint || 'Editorial image for the article.'}\n`,
          },
        ],
      });

      try {
        const imageRaw = imageResult.output ? JSON.parse(imageResult.output) : null;
        repairedImages.push({
          alt: String(imageRaw?.alt ?? '').trim(),
          caption: String(imageRaw?.caption ?? '').trim(),
        });
      } catch {
        repairedImages.push({ alt: '', caption: '' });
      }
    }

    for (const blueprint of quotes) {
      const quoteResult = await runCompletionWithOperation({
        operation: 'blogGeneration',
        companyId: args.companyId,
        cache_version: `${args.cacheVersion ?? ''}:${args.templateLabel.toLowerCase().replace(/\s+/g, '-')}:quote:${blueprint.index}`,
        model: 'gpt-4o',
        temperature: 0.35,
        response_format: { type: 'json_object' },
        max_tokens: 500,
        messages: [
          {
            role: 'system',
            content: `Return JSON only: { "text": "string", "author": "string", "source": "string" }. Write a specific editorial pull quote, not a placeholder.`,
          },
          {
            role: 'user',
            content:
              `Topic: ${args.topic}\n` +
              `Quote section: ${blueprint.heading || args.templateLabel}\n` +
              `Quote brief: ${blueprint.hint || 'Sharp editorial quote.'}\n`,
          },
        ],
      });

      try {
        const quoteRaw = quoteResult.output ? JSON.parse(quoteResult.output) : null;
        repairedQuotes.push({
          text: String(quoteRaw?.text ?? '').trim(),
          author: String(quoteRaw?.author ?? '').trim(),
          source: String(quoteRaw?.source ?? '').trim(),
        });
      } catch {
        repairedQuotes.push({ text: '', author: '', source: '' });
      }
    }

    const supportResult = await runCompletionWithOperation({
      operation: 'blogGeneration',
      companyId: args.companyId,
      cache_version: `${args.cacheVersion ?? ''}:${args.templateLabel.toLowerCase().replace(/\s+/g, '-')}:support`,
      model: 'gpt-4o',
      temperature: 0.3,
      response_format: { type: 'json_object' },
      max_tokens: 2000,
      messages: [
        {
          role: 'system',
          content:
            `Return JSON only with keys excerpt, seo_meta_description, key_insights, callout_body, summary_body, references.\n` +
            `summary_body must be at least ${summaryTarget} words. references must include at least 3 credible entries.\n`,
        },
        {
          role: 'user',
          content: `Topic: ${args.topic}\nWrite the support blocks for a ${args.templateLabel} article so it feels complete, polished, and reference-backed.`,
        },
      ],
    });

    let supportRaw: any = null;
    try {
      supportRaw = supportResult.output ? JSON.parse(supportResult.output) : null;
    } catch {
      supportRaw = null;
    }

    contentBlocks = applyEditorialDraft(contentBlocks, {
      key_insights: supportRaw?.key_insights,
      paragraphs: repairedParagraphs,
      images: repairedImages,
      quotes: repairedQuotes,
      callout_body: supportRaw?.callout_body,
      summary_body: supportRaw?.summary_body,
      references: supportRaw?.references,
    });

    const repairedExcerpt = typeof supportRaw?.excerpt === 'string' && supportRaw.excerpt.trim()
      ? supportRaw.excerpt.trim()
      : buildExcerptFromBlocks(contentBlocks);

    return {
      title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : (args.generationInput.selected_angle?.title || args.topic),
      excerpt: repairedExcerpt,
      seo_meta_title: typeof raw.seo_meta_title === 'string' && raw.seo_meta_title.trim() ? raw.seo_meta_title.trim() : (typeof raw.title === 'string' ? raw.title.trim() : args.topic).slice(0, 60),
      seo_meta_description: typeof supportRaw?.seo_meta_description === 'string' && supportRaw.seo_meta_description.trim()
        ? supportRaw.seo_meta_description.trim()
        : repairedExcerpt,
      tags: Array.isArray(raw.tags) ? raw.tags.map((tag: unknown) => String(tag ?? '').trim()).filter(Boolean) : [],
      category: typeof raw.category === 'string' ? raw.category.trim() : '',
      key_insights: Array.isArray(supportRaw?.key_insights)
        ? supportRaw.key_insights.map((item: unknown) => String(item ?? '').trim()).filter(Boolean)
        : Array.isArray(raw.key_insights) ? raw.key_insights.map((item: unknown) => String(item ?? '').trim()).filter(Boolean) : [],
      content_blocks: contentBlocks,
    };
  }

  const excerpt = typeof raw.excerpt === 'string' && raw.excerpt.trim()
    ? raw.excerpt.trim()
    : buildExcerptFromBlocks(contentBlocks);

  return {
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
