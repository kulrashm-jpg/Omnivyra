/** Part of runBlogGenerationPureHelpers (Agent-B split — barrel keeps the original path). */
import { uuid, stripHtmlForWordCount } from './runBlogGenerationPureHelpersText';
/**
 * Pure helper functions extracted from runBlogGeneration.ts.
 * No external I/O, no supabase, no AI calls — safe to unit-test in isolation.
 */

import { flattenBlocks } from './blockUtils';
import type { ContentBlock } from './blockTypes';
import type { BlogGenerationOutput } from './blogGenerationEngine';
import { getBlogTemplateDepthGuidance } from './blogTemplateGuidance';
import { getNewsletterTemplateDepthGuidance } from '../newsletter/newsletterTemplateGuidance';
import { calculateContentQualityScore } from '../content/qualityScoringCore';
import type { BlogFormatType, ArticleFormatType, WhitepaperFormatType, NewsletterFormatType, StoryFormatType, GuideFormatType } from './blogStructureTemplates';

// ── Block repair helpers ──────────────────────────────────────────────────────

export function mergeClassicShortParagraphBlocks(
  blocks: ContentBlock[],
  targetWords: number,
): ContentBlock[] {
  if (targetWords >= 1200) return blocks;

  const merged: ContentBlock[] = [];

  for (const block of blocks) {
    const previous = merged[merged.length - 1];
    if (block.type === 'paragraph' && previous?.type === 'paragraph') {
      const previousWords = stripHtmlForWordCount(previous.html).split(/\s+/).filter(Boolean).length;
      const currentWords = stripHtmlForWordCount(block.html).split(/\s+/).filter(Boolean).length;
      if (previousWords < 55 || currentWords < 55) {
        merged[merged.length - 1] = {
          ...previous,
          html: `${previous.html}${block.html}`,
        };
        continue;
      }
    }
    merged.push(block);
  }

  return merged;
}

/** Plain text of a content block, for duplication comparison. */
export function blockPlainText(block: ContentBlock | null | undefined): string {
  if (!block) return '';
  const b = block as unknown as Record<string, unknown>;
  if (block.type === 'paragraph') return stripHtmlForWordCount(String(b.html ?? ''));
  if (typeof b.body === 'string') return stripHtmlForWordCount(b.body);
  if (typeof b.text === 'string') return stripHtmlForWordCount(b.text);
  if (typeof b.html === 'string') return stripHtmlForWordCount(b.html);
  return '';
}

/** Normalize text for a tolerant duplication comparison (case/punctuation-insensitive). */
export function normalizeForCompare(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * True when `candidate` would merely echo text already present in one of the
 * existing blocks (exact match, or one fully contains the other). Used to keep
 * a synthesized summary from duplicating the body — the source of the trailing
 * duplication.
 */
export function echoesExistingBlock(candidate: string, blocks: ContentBlock[]): boolean {
  const c = normalizeForCompare(candidate);
  if (c.length < 12) return false; // too short to compare meaningfully
  for (const block of blocks) {
    const t = normalizeForCompare(blockPlainText(block));
    if (!t) continue;
    if (t === c || t.includes(c) || c.includes(t)) return true;
  }
  return false;
}

export function ensureClassicSummaryBlock(
  blocks: ContentBlock[],
  excerpt: string,
): ContentBlock[] {
  if (blocks.some((block) => block.type === 'summary' && block.body.trim().length > 0)) {
    return blocks;
  }

  // Only the excerpt may seed the synthesized summary. The previous fallback
  // copied the LAST paragraph/callout verbatim, which appended the blog's own
  // conclusion a second time as a "summary" — the trailing duplication. We
  // never copy a body block verbatim now.
  const summaryBody = excerpt.trim();
  if (!summaryBody) return blocks;

  // Even the excerpt must not echo existing body text — no duplication at the
  // end. When it would, we simply omit the summary (a redundant summary is
  // worse than none).
  if (echoesExistingBlock(summaryBody, blocks)) return blocks;

  const summaryBlock: ContentBlock = {
    id: uuid(),
    type: 'summary',
    body: summaryBody,
  };

  const referencesIndex = blocks.findIndex((block) => block.type === 'references');
  if (referencesIndex >= 0) {
    return [
      ...blocks.slice(0, referencesIndex),
      summaryBlock,
      ...blocks.slice(referencesIndex),
    ];
  }

  return [...blocks, summaryBlock];
}

export function buildExcerptFromHtml(html: string): string {
  const text = stripHtmlForWordCount(html);
  if (!text) return '';
  if (text.length <= 150) return text;
  const clipped = text.slice(0, 157).trim();
  return `${clipped.replace(/[,:;.\-–—\s]+$/g, '')}...`;
}

export function ensureGeneratedMetadata(generated: BlogGenerationOutput): BlogGenerationOutput {
  const excerpt = generated.excerpt.trim() || buildExcerptFromHtml(generated.content_html);
  const seoMetaTitle = generated.seo_meta_title.trim() || generated.title.trim().slice(0, 60);
  const seoMetaDescription = generated.seo_meta_description.trim() || excerpt;

  return {
    ...generated,
    excerpt,
    seo_meta_title: seoMetaTitle,
    seo_meta_description: seoMetaDescription,
  };
}

export function buildExcerptFromBlocks(blocks: ContentBlock[]): string {
  const text = flattenBlocks(blocks)
    .flatMap((block) => {
      switch (block.type) {
        case 'paragraph':
          return [stripHtmlForWordCount(block.html)];
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
  const clipped = text.slice(0, 157).trim();
  return `${clipped.replace(/[,:;.\-–—\s]+$/g, '')}...`;
}

export function applyClassicStructuredRepair(
  blocks: ContentBlock[],
  repair: {
    excerpt?: string;
    seo_meta_description?: string;
    key_insights?: unknown;
    paragraphs?: unknown;
    summary_body?: string;
    references?: unknown;
  } | null | undefined,
): { blocks: ContentBlock[]; excerpt: string; seoMetaDescription: string; keyInsights: string[] } {
  if (!repair || typeof repair !== 'object') {
    return { blocks, excerpt: '', seoMetaDescription: '', keyInsights: [] };
  }

  const paragraphEntries = Array.isArray(repair.paragraphs) ? repair.paragraphs : [];
  let paragraphCursor = 0;
  const repairedItems = Array.isArray(repair.key_insights)
    ? repair.key_insights.map((item) => String(item ?? '').trim()).filter(Boolean)
    : [];

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
        typeof nextEntry === 'string' ? nextEntry :
        typeof nextEntry?.html === 'string' ? nextEntry.html :
        '';
      if (html.trim()) return { ...block, html };
    }

    if (block.type === 'key_insights') {
      if (repairedItems.length > 0) {
        return { ...block, items: block.items.map((_, index) => repairedItems[index] ?? '') };
      }
    }

    if (block.type === 'summary') {
      const summaryBody = typeof repair.summary_body === 'string' ? repair.summary_body.trim() : '';
      if (summaryBody) return { ...block, body: summaryBody };
    }

    if (block.type === 'references') {
      const refs = Array.isArray(repair.references)
        ? repair.references
            .map((ref) => ({
              id: uuid(),
              title: typeof ref === 'string' ? ref.trim() : String(ref?.title ?? ref?.text ?? '').trim(),
              url: typeof ref === 'string' ? '' : String(ref?.url ?? ref?.href ?? '').trim(),
            }))
            .filter((ref) => ref.title || ref.url)
        : [];
      if (refs.length > 0) {
        return {
          ...block,
          items: block.items.map((_, index) => refs[index] ?? { id: uuid(), title: '', url: '' }),
        };
      }
    }

    return block;
  });

  const repairedBlocks = mapBlocks(blocks);

  return {
    blocks: repairedBlocks,
    excerpt: typeof repair.excerpt === 'string' ? repair.excerpt.trim() : '',
    seoMetaDescription: typeof repair.seo_meta_description === 'string' ? repair.seo_meta_description.trim() : '',
    keyInsights: Array.isArray(repair.key_insights)
      ? repair.key_insights.map((item) => String(item ?? '').trim()).filter(Boolean)
      : [],
  };
}

export function applyTemplateStructuredRepair(
  blocks: ContentBlock[],
  repair: {
    excerpt?: string;
    seo_meta_description?: string;
    paragraphs?: unknown;
    lists?: unknown;
    summary_body?: string;
    references?: unknown;
  } | null | undefined,
): { blocks: ContentBlock[]; excerpt: string; seoMetaDescription: string } {
  if (!repair || typeof repair !== 'object') {
    return { blocks, excerpt: '', seoMetaDescription: '' };
  }

  const paragraphEntries = Array.isArray(repair.paragraphs) ? repair.paragraphs : [];
  const listEntries = Array.isArray(repair.lists) ? repair.lists : [];
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
        typeof nextEntry === 'string' ? nextEntry :
        typeof nextEntry?.html === 'string' ? nextEntry.html :
        '';
      if (html.trim()) return { ...block, html };
    }

    if (block.type === 'list') {
      const nextList = listEntries[listCursor++];
      const repairedItems = Array.isArray(nextList)
        ? nextList.map((item) => String(item ?? '').trim()).filter(Boolean)
        : Array.isArray(nextList?.items)
        ? nextList.items.map((item: any) => String(typeof item === 'string' ? item : item?.text ?? '').trim()).filter(Boolean)
        : [];
      if (repairedItems.length > 0) {
        return {
          ...block,
          items: block.items.map((existing, index) => ({
            ...existing,
            text: repairedItems[index] ?? existing.text,
          })),
        };
      }
    }

    if (block.type === 'summary') {
      const summaryBody = typeof repair.summary_body === 'string' ? repair.summary_body.trim() : '';
      if (summaryBody) return { ...block, body: summaryBody };
    }

    if (block.type === 'references') {
      const refs = Array.isArray(repair.references)
        ? repair.references
            .map((ref) => ({
              id: uuid(),
              title: typeof ref === 'string' ? ref.trim() : String(ref?.title ?? ref?.text ?? '').trim(),
              url: typeof ref === 'string' ? '' : String(ref?.url ?? ref?.href ?? '').trim(),
            }))
            .filter((ref) => ref.title || ref.url)
        : [];
      if (refs.length > 0) {
        return {
          ...block,
          items: block.items.map((_, index) => refs[index] ?? { id: uuid(), title: '', url: '' }),
        };
      }
    }

    return block;
  });

  const repairedBlocks = mapBlocks(blocks);

  return {
    blocks: repairedBlocks,
    excerpt: typeof repair.excerpt === 'string' ? repair.excerpt.trim() : '',
    seoMetaDescription: typeof repair.seo_meta_description === 'string' ? repair.seo_meta_description.trim() : '',
  };
}

// ── Paragraph targets ─────────────────────────────────────────────────────────

export type ParagraphTarget = {
  headingContext: string;
  hint: string;
  currentHtml: string;
  currentWords: number;
};

export function collectParagraphTargets(blocks: ContentBlock[]): ParagraphTarget[] {
  const targets: ParagraphTarget[] = [];

  const walk = (input: ContentBlock[], currentHeading: string) => {
    let headingContext = currentHeading;

    for (const block of input) {
      if (block.type === 'heading') {
        const nextHeading = String(block.text || block.hint || '').trim();
        if (nextHeading) headingContext = nextHeading;
        continue;
      }

      if (block.type === 'columns') {
        for (const column of block.columns) {
          walk(column.blocks, headingContext);
        }
        continue;
      }

      if (block.type === 'paragraph') {
        const currentHtml = String(block.html ?? '');
        const currentWords = stripHtmlForWordCount(currentHtml).split(/\s+/).filter(Boolean).length;
        targets.push({
          headingContext,
          hint: String(block.hint ?? '').trim(),
          currentHtml,
          currentWords,
        });
      }
    }
  };

  walk(blocks, '');
  return targets;
}

// ── Quality scoring ───────────────────────────────────────────────────────────

export function assessBlogQualityScore(
  blocks: ContentBlock[],
  meta: {
    title: string;
    excerpt: string;
    seo_meta_title: string;
    seo_meta_description: string;
    tags: string[];
    target_word_count: number;
    format_type?: BlogFormatType;
  },
) {
  return calculateContentQualityScore(blocks, {
    title: meta.title,
    excerpt: meta.excerpt,
    seo_meta_title: meta.seo_meta_title,
    seo_meta_description: meta.seo_meta_description,
    tags: meta.tags,
    target_word_count: meta.target_word_count,
    format_type: meta.format_type,
    content_type: 'blog',
  });
}
