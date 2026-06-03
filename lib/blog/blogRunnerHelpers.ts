/**
 * blogRunnerHelpers.ts
 *
 * Utility helpers for runBlogGeneration: word counting, HTML stripping,
 * block analysis, excerpt building, repair application, and template depth.
 * Extracted from runBlogGeneration.ts to keep that file under 500 lines.
 */

import { flattenBlocks } from './blockUtils';
import { runCompletionWithOperation } from '../../backend/services/aiGateway';
import { getBlogTemplateDepthGuidance } from './blogTemplateGuidance';
import { getNewsletterTemplateDepthGuidance } from '../newsletter/newsletterTemplateGuidance';
import { calculateContentQualityScore } from '../content/qualityScoringCore';
import type { ContentBlock, InternalLinkBlock } from './blockTypes';
import type { BlogGenerationOutput } from './blogGenerationEngine';
import type { BlogFormatType } from './blogStructureTemplates';
import type { BlogGenerationRequest } from './blogRunnerTypes';
import { supabase } from '../../backend/db/supabaseClient';

// ── Text utilities ────────────────────────────────────────────────────────────

export function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

export function stripHtmlForWordCount(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function countListWords(
  items: Array<{ text?: string; children?: Array<{ text?: string; children?: any[] }> }> = [],
): number {
  let total = 0;
  for (const item of items) {
    total += String(item?.text ?? '').trim().split(/\s+/).filter(Boolean).length;
    if (Array.isArray(item?.children) && item.children.length > 0) {
      total += countListWords(item.children as Array<{ text?: string; children?: Array<{ text?: string; children?: any[] }> }>);
    }
  }
  return total;
}

export function buildExcerptFromHtml(html: string): string {
  const text = stripHtmlForWordCount(html);
  if (!text) return '';
  if (text.length <= 150) return text;
  const clipped = text.slice(0, 157).trim();
  return `${clipped.replace(/[,:;.\-–—\s]+$/g, '')}...`;
}

export function buildExcerptFromBlocks(blocks: ContentBlock[]): string {
  const text = flattenBlocks(blocks)
    .flatMap((block) => {
      switch (block.type) {
        case 'paragraph':  return [stripHtmlForWordCount(block.html)];
        case 'summary':    return [block.body.trim()];
        case 'key_insights': return [block.items.join(' ').trim()];
        case 'callout':    return [`${block.title ?? ''} ${block.body ?? ''}`.trim()];
        default:           return [];
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

export function ensureGeneratedMetadata(generated: BlogGenerationOutput): BlogGenerationOutput {
  const excerpt = generated.excerpt.trim() || buildExcerptFromHtml(generated.content_html);
  const seoMetaTitle = generated.seo_meta_title.trim() || generated.title.trim().slice(0, 60);
  const seoMetaDescription = generated.seo_meta_description.trim() || excerpt;
  return { ...generated, excerpt, seo_meta_title: seoMetaTitle, seo_meta_description: seoMetaDescription };
}

// ── Template helpers ──────────────────────────────────────────────────────────

export function normalizeTemplateName(templateName: string | undefined): string {
  return typeof templateName === 'string' ? templateName.trim().toLowerCase() : '';
}

export function deriveTemplateDepthGuidance(
  contentType: BlogGenerationRequest['contentType'],
  templateName: string | undefined,
  formatType: BlogGenerationRequest['formatType'],
  targetWords: number,
): { uniquenessRule: string; mustIncludePoints: string[]; retryFocus: string[] } | null {
  const normalized = normalizeTemplateName(templateName);

  if (contentType === 'blog') {
    const guidance = getBlogTemplateDepthGuidance(templateName, typeof formatType === 'string' ? formatType : undefined, targetWords);
    if (guidance) return guidance;
  }

  if (contentType === 'newsletter') {
    const guidance = getNewsletterTemplateDepthGuidance(templateName, typeof formatType === 'string' ? formatType : undefined, targetWords);
    if (guidance) return guidance;
  }

  if (normalized) {
    return {
      uniquenessRule: targetWords >= 1600
        ? 'Honor the selected custom template layout, but fill it like a publication-ready deep dive: every substantive block should contribute real standalone value, layered explanation, and practical meaning.'
        : 'Honor the selected custom template layout, but do not let structure become an excuse for shallow writing; each substantive block must feel complete.',
      mustIncludePoints: [
        'Fill every substantive block fully and preserve the layout without returning skeletal content',
        'If the template uses columns, callouts, or special blocks, each one should add meaningful standalone value',
        'Use examples, implications, and reader-useful detail to create real depth across the whole template',
      ],
      retryFocus: [
        'Keep the layout, but make every substantive block more complete and informative',
        'Replace outline-like writing with explanation, examples, and practical meaning',
      ],
    };
  }

  return null;
}

// ── Block analysis ────────────────────────────────────────────────────────────

export function analyzeTemplateContentBlocks(blocks: ContentBlock[]): {
  wordCount: number;
  paragraphCount: number;
  averageParagraphWords: number;
  h2Count: number;
  emptyParagraphs: number;
  emptyHeadings: number;
  emptySummaries: number;
  emptyKeyInsights: number;
  emptyLists: number;
  weakLists: number;
  thinListItems: number;
  emptyCallouts: number;
  thinCallouts: number;
  emptyQuotes: number;
  thinQuotes: number;
  weakReferences: number;
  refsCount: number;
  imagesMissingAlt: number;
  substantiveEmptyBlocks: number;
  thinParagraphs: number;
  thinSummaries: number;
  weakKeyInsights: number;
} {
  const flat = flattenBlocks(blocks);
  let wordCount = 0, emptyParagraphs = 0, emptyHeadings = 0, emptySummaries = 0;
  let emptyKeyInsights = 0, emptyLists = 0, weakLists = 0, thinListItems = 0;
  let emptyCallouts = 0, thinCallouts = 0, emptyQuotes = 0, thinQuotes = 0;
  let weakReferences = 0, refsCount = 0, imagesMissingAlt = 0;
  let thinParagraphs = 0, thinSummaries = 0, weakKeyInsights = 0;
  let paragraphCount = 0, paragraphWordTotal = 0, h2Count = 0;

  for (const block of flat) {
    switch (block.type) {
      case 'paragraph': {
        const wc = stripHtmlForWordCount(block.html).split(/\s+/).filter(Boolean).length;
        wordCount += wc; paragraphCount++; paragraphWordTotal += wc;
        if (wc === 0) emptyParagraphs++;
        else if (wc < 70) thinParagraphs++;
        break;
      }
      case 'heading': {
        const wc = block.text.trim().split(/\s+/).filter(Boolean).length;
        wordCount += wc;
        if (block.level === 2 && wc > 0) h2Count++;
        if (wc === 0) emptyHeadings++;
        break;
      }
      case 'key_insights': {
        const filled = block.items.map((i) => i.trim()).filter(Boolean);
        wordCount += filled.join(' ').split(/\s+/).filter(Boolean).length;
        if (filled.length === 0) emptyKeyInsights++;
        else if (filled.length < 3) weakKeyInsights++;
        break;
      }
      case 'summary': {
        const wc = block.body.trim().split(/\s+/).filter(Boolean).length;
        wordCount += wc;
        if (wc === 0) emptySummaries++;
        else if (wc < 50) thinSummaries++;
        break;
      }
      case 'callout': {
        const wc = `${block.title ?? ''} ${block.body ?? ''}`.trim().split(/\s+/).filter(Boolean).length;
        wordCount += wc;
        if (wc === 0) emptyCallouts++;
        else if (wc < 18) thinCallouts++;
        break;
      }
      case 'quote': {
        const wc = `${block.text ?? ''} ${block.author ?? ''} ${block.source ?? ''}`.trim().split(/\s+/).filter(Boolean).length;
        wordCount += wc;
        if (wc === 0) emptyQuotes++;
        else if (wc < 12) thinQuotes++;
        break;
      }
      case 'list': {
        const itemTexts = (block.items as Array<{ text?: string; children?: Array<{ text?: string; children?: any[] }> }>)
          .map((i) => String(i?.text ?? '').trim()).filter(Boolean);
        const wc = countListWords(block.items as Array<{ text?: string; children?: Array<{ text?: string; children?: any[] }> }>);
        wordCount += wc;
        if (wc === 0) emptyLists++;
        else {
          const shortItems = itemTexts.filter((t) => t.split(/\s+/).filter(Boolean).length < 5).length;
          thinListItems += shortItems;
          if (itemTexts.length === 0 || wc < itemTexts.length * 8 || shortItems >= Math.ceil(itemTexts.length / 2)) weakLists++;
        }
        break;
      }
      case 'references': {
        const filledRefs = block.items.filter((r) => String(r.title ?? '').trim() || String(r.url ?? '').trim());
        refsCount += filledRefs.length;
        wordCount += filledRefs.map((r) => `${r.title ?? ''} ${r.url ?? ''}`.trim()).join(' ').split(/\s+/).filter(Boolean).length;
        if (filledRefs.length === 0 || (filledRefs.length > 0 && filledRefs.length < Math.min(2, block.items.length))) weakReferences++;
        break;
      }
      case 'image':
        if (!String(block.alt ?? '').trim()) imagesMissingAlt++;
        wordCount += `${block.alt ?? ''} ${block.caption ?? ''}`.trim().split(/\s+/).filter(Boolean).length;
        break;
      case 'internal_link':
        wordCount += `${block.title ?? ''} ${block.excerpt ?? ''}`.trim().split(/\s+/).filter(Boolean).length;
        break;
      default:
        break;
    }
  }

  const substantiveEmptyBlocks = emptyParagraphs + emptyHeadings + emptySummaries + emptyKeyInsights + emptyLists + emptyCallouts;
  return {
    wordCount, paragraphCount,
    averageParagraphWords: paragraphCount > 0 ? Math.round(paragraphWordTotal / paragraphCount) : 0,
    h2Count, emptyParagraphs, emptyHeadings, emptySummaries, emptyKeyInsights,
    emptyLists, weakLists, thinListItems, emptyCallouts, thinCallouts,
    emptyQuotes, thinQuotes, weakReferences, refsCount, imagesMissingAlt,
    substantiveEmptyBlocks, thinParagraphs, thinSummaries, weakKeyInsights,
  };
}

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

// ── Classic repair helpers ────────────────────────────────────────────────────

export function mergeClassicShortParagraphBlocks(
  blocks: ContentBlock[],
  targetWords: number,
): ContentBlock[] {
  if (targetWords >= 1200) return blocks;
  const merged: ContentBlock[] = [];
  for (const block of blocks) {
    const previous = merged[merged.length - 1];
    if (block.type === 'paragraph' && previous?.type === 'paragraph') {
      const prevWords = stripHtmlForWordCount(previous.html).split(/\s+/).filter(Boolean).length;
      const curWords  = stripHtmlForWordCount(block.html).split(/\s+/).filter(Boolean).length;
      if (prevWords < 55 || curWords < 55) {
        merged[merged.length - 1] = { ...previous, html: `${previous.html}${block.html}` };
        continue;
      }
    }
    merged.push(block);
  }
  return merged;
}

/** Plain text of a content block, for duplication comparison. */
function blockPlainTextForSummary(block: ContentBlock | null | undefined): string {
  if (!block) return '';
  const b = block as unknown as Record<string, unknown>;
  if (block.type === 'paragraph') return stripHtmlForWordCount(String(b.html ?? ''));
  if (typeof b.body === 'string') return stripHtmlForWordCount(b.body);
  if (typeof b.text === 'string') return stripHtmlForWordCount(b.text);
  if (typeof b.html === 'string') return stripHtmlForWordCount(b.html);
  return '';
}

function normalizeForSummaryCompare(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** True when `candidate` would merely echo text already present in a block. */
function summaryEchoesExisting(candidate: string, blocks: ContentBlock[]): boolean {
  const c = normalizeForSummaryCompare(candidate);
  if (c.length < 12) return false;
  for (const block of blocks) {
    const t = normalizeForSummaryCompare(blockPlainTextForSummary(block));
    if (!t) continue;
    if (t === c || t.includes(c) || c.includes(t)) return true;
  }
  return false;
}

export function ensureClassicSummaryBlock(
  blocks: ContentBlock[],
  excerpt: string,
): ContentBlock[] {
  if (blocks.some((b) => b.type === 'summary' && (b as any).body.trim().length > 0)) return blocks;

  // Only the excerpt seeds the synthesized summary — never copy a body block
  // verbatim (that produced the trailing duplication), and skip it entirely
  // when it would echo existing body text.
  const summaryBody = excerpt.trim();
  if (!summaryBody) return blocks;
  if (summaryEchoesExisting(summaryBody, blocks)) return blocks;

  const summaryBlock: ContentBlock = { id: uuid(), type: 'summary', body: summaryBody } as any;
  const refsIdx = blocks.findIndex((b) => b.type === 'references');
  if (refsIdx >= 0) return [...blocks.slice(0, refsIdx), summaryBlock, ...blocks.slice(refsIdx)];
  return [...blocks, summaryBlock];
}

// ── Repair applications ───────────────────────────────────────────────────────

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
      return { ...block, columns: block.columns.map((c) => ({ ...c, blocks: mapBlocks(c.blocks) })) };
    }
    if (block.type === 'paragraph') {
      const nextEntry = paragraphEntries[paragraphCursor++];
      const html = typeof nextEntry === 'string' ? nextEntry : typeof nextEntry?.html === 'string' ? nextEntry.html : '';
      if (html.trim()) return { ...block, html };
    }
    if (block.type === 'key_insights' && repairedItems.length > 0) {
      return { ...block, items: block.items.map((_, i) => repairedItems[i] ?? '') };
    }
    if (block.type === 'summary') {
      const sb = typeof repair.summary_body === 'string' ? repair.summary_body.trim() : '';
      if (sb) return { ...block, body: sb };
    }
    if (block.type === 'references') {
      const refs = Array.isArray(repair.references)
        ? repair.references.map((r) => ({
            id: uuid(),
            title: typeof r === 'string' ? r.trim() : String(r?.title ?? r?.text ?? '').trim(),
            url: typeof r === 'string' ? '' : String(r?.url ?? r?.href ?? '').trim(),
          })).filter((r) => r.title || r.url)
        : [];
      if (refs.length > 0) return { ...block, items: block.items.map((_, i) => refs[i] ?? { id: uuid(), title: '', url: '' }) };
    }
    return block;
  });

  return {
    blocks: mapBlocks(blocks),
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
  if (!repair || typeof repair !== 'object') return { blocks, excerpt: '', seoMetaDescription: '' };

  const paragraphEntries = Array.isArray(repair.paragraphs) ? repair.paragraphs : [];
  const listEntries = Array.isArray(repair.lists) ? repair.lists : [];
  let paragraphCursor = 0;
  let listCursor = 0;

  const mapBlocks = (input: ContentBlock[]): ContentBlock[] => input.map((block) => {
    if (block.type === 'columns') {
      return { ...block, columns: block.columns.map((c) => ({ ...c, blocks: mapBlocks(c.blocks) })) };
    }
    if (block.type === 'paragraph') {
      const nextEntry = paragraphEntries[paragraphCursor++];
      const html = typeof nextEntry === 'string' ? nextEntry : typeof nextEntry?.html === 'string' ? nextEntry.html : '';
      if (html.trim()) return { ...block, html };
    }
    if (block.type === 'list') {
      const nextList = listEntries[listCursor++];
      const items = Array.isArray(nextList)
        ? nextList.map((i) => String(i ?? '').trim()).filter(Boolean)
        : Array.isArray(nextList?.items)
        ? nextList.items.map((i: any) => String(typeof i === 'string' ? i : i?.text ?? '').trim()).filter(Boolean)
        : [];
      if (items.length > 0) {
        return { ...block, items: block.items.map((ex, idx) => ({ ...ex, text: items[idx] ?? ex.text })) };
      }
    }
    if (block.type === 'summary') {
      const sb = typeof repair.summary_body === 'string' ? repair.summary_body.trim() : '';
      if (sb) return { ...block, body: sb };
    }
    if (block.type === 'references') {
      const refs = Array.isArray(repair.references)
        ? repair.references.map((r) => ({
            id: uuid(),
            title: typeof r === 'string' ? r.trim() : String(r?.title ?? r?.text ?? '').trim(),
            url: typeof r === 'string' ? '' : String(r?.url ?? r?.href ?? '').trim(),
          })).filter((r) => r.title || r.url)
        : [];
      if (refs.length > 0) return { ...block, items: block.items.map((_, i) => refs[i] ?? { id: uuid(), title: '', url: '' }) };
    }
    return block;
  });

  return {
    blocks: mapBlocks(blocks),
    excerpt: typeof repair.excerpt === 'string' ? repair.excerpt.trim() : '',
    seoMetaDescription: typeof repair.seo_meta_description === 'string' ? repair.seo_meta_description.trim() : '',
  };
}

// ── Paragraph deepening ───────────────────────────────────────────────────────

type ParagraphTarget = { headingContext: string; hint: string; currentHtml: string; currentWords: number };

export function collectParagraphTargets(blocks: ContentBlock[]): ParagraphTarget[] {
  const targets: ParagraphTarget[] = [];

  const walk = (input: ContentBlock[], currentHeading: string) => {
    let headingContext = currentHeading;
    for (const block of input) {
      if (block.type === 'heading') {
        const h = String((block as any).text || (block as any).hint || '').trim();
        if (h) headingContext = h;
        continue;
      }
      if (block.type === 'columns') {
        for (const column of block.columns) walk(column.blocks, headingContext);
        continue;
      }
      if (block.type === 'paragraph') {
        const currentHtml = String((block as any).html ?? '');
        const currentWords = stripHtmlForWordCount(currentHtml).split(/\s+/).filter(Boolean).length;
        targets.push({ headingContext, hint: String((block as any).hint ?? '').trim(), currentHtml, currentWords });
      }
    }
  };

  walk(blocks, '');
  return targets;
}

export async function deepenTemplateParagraphsIndividually(args: {
  blocks: ContentBlock[];
  companyId: string;
  cacheVersion?: string;
  topic: string;
  templateLabel: string;
  targetWords: number;
  minAcceptable: number;
  minParagraphWords: number;
  useClassicRepair?: boolean;
}): Promise<{ blocks: ContentBlock[]; analysis: ReturnType<typeof analyzeTemplateContentBlocks> }> {
  const paragraphTargets = collectParagraphTargets(args.blocks);
  if (paragraphTargets.length === 0) {
    return { blocks: args.blocks, analysis: analyzeTemplateContentBlocks(args.blocks) };
  }

  const repairedParagraphs: Array<{ html: string }> = [];

  for (const target of paragraphTargets) {
    const result = await runCompletionWithOperation({
      operation: 'blogGeneration',
      companyId: args.companyId,
      cache_version: args.cacheVersion,
      model: 'gpt-4o',
      temperature: 0.35,
      response_format: { type: 'json_object' },
      max_tokens: 1200,
      messages: [
        {
          role: 'system',
          content:
            `You are expanding one paragraph block inside a ${args.templateLabel} blog article.\n` +
            `Return JSON only: { "html": "<p>...</p><p>...</p>" }\n` +
            `Rules:\n- Write valid HTML using 2-3 <p> tags\n` +
            `- Write at least ${args.minParagraphWords} words\n` +
            `- Add real explanation, examples, implications, and practical detail\n` +
            `- Do not write bullets, headings, or placeholders\n`,
        },
        {
          role: 'user',
          content:
            `Topic: ${args.topic}\nTemplate: ${args.templateLabel}\n` +
            `Target article length: ${args.targetWords} words (minimum acceptable ${args.minAcceptable})\n` +
            `Section heading: ${target.headingContext || 'Body section'}\n` +
            `Block hint: ${target.hint || 'Expand the current paragraph block into a complete body section.'}\n` +
            `Current paragraph depth: ${target.currentWords} words\n` +
            `Current block text:\n${stripHtmlForWordCount(target.currentHtml).trim() || '[empty]'}\n\n` +
            `Rewrite this block so it becomes a complete long-form section for the article.`,
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
    repairedParagraphs.push({ html: html || target.currentHtml });
  }

  const repaired = args.useClassicRepair
    ? applyClassicStructuredRepair(args.blocks, { paragraphs: repairedParagraphs }).blocks
    : applyTemplateStructuredRepair(args.blocks, { paragraphs: repairedParagraphs }).blocks;

  return { blocks: repaired, analysis: analyzeTemplateContentBlocks(repaired) };
}

// ── Internal link injection ───────────────────────────────────────────────────

export async function injectInternalLinks(
  blocks:    ContentBlock[],
  topic:     string,
  companyId: string,
  blogTable: 'blogs' | 'public_blogs',
  excludeTitles: string[] = [],
): Promise<ContentBlock[]> {
  try {
    const STOP_WORDS = new Set([
      'the','and','for','are','but','not','you','all','can','her','was','one',
      'our','out','has','have','from','with','they','been','this','that','will',
      'each','make','like','into','them','than','its','over','such','what','how',
      'why','most','about','which','when','your','does','more',
    ]);
    const keywords = topic.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter(w => w.length >= 3 && !STOP_WORDS.has(w));

    if (keywords.length === 0) return blocks;

    const query = supabase.from(blogTable).select('slug, title, excerpt').eq('status', 'published').not('slug', 'is', null);
    if (blogTable === 'blogs') query.eq('company_id', companyId);
    const { data } = await query.limit(50);
    if (!data || data.length === 0) return blocks;

    const excludeSet = new Set(excludeTitles.map(t => t.toLowerCase()));
    const publishedBlogs = (data as Array<{ slug: string; title: string; excerpt: string | null }>)
      .filter(b => b.slug && b.title && !excludeSet.has(b.title.toLowerCase()))
      .map((b) => ({ ...b, titleLow: b.title.toLowerCase() }));

    const scored = publishedBlogs
      .map(b => ({ ...b, score: keywords.filter(kw => b.titleLow.includes(kw)).length }))
      .filter(b => b.score > 0).sort((a, b) => b.score - a.score).slice(0, 2);

    const fallbackRelated = publishedBlogs
      .filter((b) => !scored.some((s) => s.slug === b.slug))
      .slice(0, Math.max(0, 2 - scored.length))
      .map(({ titleLow: _t, ...rest }) => ({ ...rest, score: 0 }));

    const chosenLinks = [...scored, ...fallbackRelated].slice(0, 2);
    if (chosenLinks.length === 0) return blocks;

    const linkBlocks: InternalLinkBlock[] = chosenLinks.map(b => ({
      id: uuid(), type: 'internal_link' as const,
      slug: b.slug, title: b.title, excerpt: b.excerpt || undefined,
    }));

    const h2Indices: number[] = [];
    for (let i = 0; i < blocks.length; i++) {
      const blk = blocks[i];
      if (blk.type === 'heading' && blk.level === 2) {
        const text = blk.text.toLowerCase().replace(/[^a-z]/g, '');
        if (!['summary','conclusion','references','sources'].includes(text)) h2Indices.push(i);
      }
    }

    const result = [...blocks];
    const targetH2Positions = linkBlocks.length >= 2
      ? [Math.min(1, h2Indices.length - 1), Math.min(3, h2Indices.length - 1)]
      : [Math.min(1, h2Indices.length - 1)];

    for (let li = linkBlocks.length - 1; li >= 0; li--) {
      const h2Pos = targetH2Positions[li] ?? 0;
      if (h2Pos < 0 || h2Pos >= h2Indices.length) continue;
      const h2BlockIdx = h2Indices[h2Pos];
      let insertAt = result.length;
      for (let i = h2BlockIdx + 1; i < result.length; i++) {
        const blk = result[i];
        if ((blk.type === 'heading' && blk.level === 2) || blk.type === 'summary' || blk.type === 'references') {
          insertAt = i; break;
        }
      }
      result.splice(insertAt, 0, linkBlocks[li]);
    }

    return result;
  } catch {
    return blocks;
  }
}
