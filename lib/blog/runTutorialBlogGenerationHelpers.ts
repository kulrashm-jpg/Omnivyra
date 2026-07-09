/** Part of runTutorialBlogGeneration (Agent-B split — main module keeps the original path). */
import { runCompletionWithOperation } from '../../backend/services/aiGateway';
import { flattenBlocks } from './blockUtils';
import type { ContentBlock } from './blockTypes';
import type { BlogGenerationInput } from './blogGenerationEngine';
import { calculateContentQualityScore } from '../content/qualityScoringCore';
import { buildSectionEnforcementPrompt, type CompanyIdentity } from '../content/companyContextBlock';


export type TutorialDraft = {
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

export type ListBlueprint = {
  index: number;
  heading: string;
  hint: string;
  slotCount: number;
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

export function collectTutorialBlueprints(blocks: ContentBlock[]) {
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

export function applyTutorialDraft(
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
      case 'list':
        return sum + block.items.map((item) => item.text).join(' ').split(/\s+/).filter(Boolean).length;
      case 'references':
        return sum + block.items.map((item) => `${item.title} ${item.url}`).join(' ').split(/\s+/).filter(Boolean).length;
      default:
        return sum;
    }
  }, 0);
}

