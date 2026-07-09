/** Part of runEditorialBlogGeneration (Agent-B split — main module keeps the original path). */
import { runCompletionWithOperation } from '../../backend/services/aiGateway';
import { flattenBlocks } from './blockUtils';
import type { ContentBlock } from './blockTypes';
import type { BlogGenerationInput } from './blogGenerationEngine';
import { buildSectionEnforcementPrompt, type CompanyIdentity } from '../content/companyContextBlock';


export type EditorialDraft = {
  title: string;
  excerpt: string;
  seo_meta_title: string;
  seo_meta_description: string;
  tags: string[];
  category: string;
  key_insights: string[];
  content_blocks: ContentBlock[];
};

export type ParagraphBlueprint = {
  index: number;
  heading: string;
  hint: string;
};

export type ImageBlueprint = {
  index: number;
  heading: string;
  hint: string;
};

export type QuoteBlueprint = {
  index: number;
  heading: string;
  hint: string;
};

export function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function buildExcerptFromBlocks(blocks: ContentBlock[]): string {
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

export function collectEditorialBlueprints(blocks: ContentBlock[]) {
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

export function materializeHeadingText(blocks: ContentBlock[]): ContentBlock[] {
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

export function applyEditorialDraft(
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

export function countWords(blocks: ContentBlock[]): number {
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

