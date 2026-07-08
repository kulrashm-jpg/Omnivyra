/** Part of runBlogGenerationPureHelpers (Agent-B split — barrel keeps the original path). */
import { stripHtmlForWordCount, countListWords } from './runBlogGenerationPureHelpersText';
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
  let wordCount = 0;
  let emptyParagraphs = 0;
  let emptyHeadings = 0;
  let emptySummaries = 0;
  let emptyKeyInsights = 0;
  let emptyLists = 0;
  let weakLists = 0;
  let thinListItems = 0;
  let emptyCallouts = 0;
  let thinCallouts = 0;
  let emptyQuotes = 0;
  let thinQuotes = 0;
  let weakReferences = 0;
  let refsCount = 0;
  let imagesMissingAlt = 0;
  let thinParagraphs = 0;
  let thinSummaries = 0;
  let weakKeyInsights = 0;
  let paragraphCount = 0;
  let paragraphWordTotal = 0;
  let h2Count = 0;

  for (const block of flat) {
    switch (block.type) {
      case 'paragraph': {
        const wc = stripHtmlForWordCount(block.html).split(/\s+/).filter(Boolean).length;
        wordCount += wc;
        paragraphCount += 1;
        paragraphWordTotal += wc;
        if (wc === 0) emptyParagraphs += 1;
        else if (wc < 70) thinParagraphs += 1;
        break;
      }
      case 'heading': {
        const wc = block.text.trim().split(/\s+/).filter(Boolean).length;
        wordCount += wc;
        if (block.level === 2 && wc > 0) h2Count += 1;
        if (wc === 0) emptyHeadings += 1;
        break;
      }
      case 'key_insights': {
        const filled = block.items.map((item) => item.trim()).filter(Boolean);
        wordCount += filled.join(' ').split(/\s+/).filter(Boolean).length;
        if (filled.length === 0) emptyKeyInsights += 1;
        else if (filled.length < 3) weakKeyInsights += 1;
        break;
      }
      case 'summary': {
        const wc = block.body.trim().split(/\s+/).filter(Boolean).length;
        wordCount += wc;
        if (wc === 0) emptySummaries += 1;
        else if (wc < 50) thinSummaries += 1;
        break;
      }
      case 'callout':
        {
          const wc = `${block.title ?? ''} ${block.body ?? ''}`.trim().split(/\s+/).filter(Boolean).length;
          wordCount += wc;
          if (wc === 0) emptyCallouts += 1;
          else if (wc < 18) thinCallouts += 1;
        }
        break;
      case 'quote':
        {
          const wc = `${block.text ?? ''} ${block.author ?? ''} ${block.source ?? ''}`.trim().split(/\s+/).filter(Boolean).length;
          wordCount += wc;
          if (wc === 0) emptyQuotes += 1;
          else if (wc < 12) thinQuotes += 1;
        }
        break;
      case 'list': {
        const itemTexts = (block.items as Array<{ text?: string; children?: Array<{ text?: string; children?: any[] }> }>)
          .map((item) => String(item?.text ?? '').trim())
          .filter(Boolean);
        const wc = countListWords(block.items as Array<{ text?: string; children?: Array<{ text?: string; children?: any[] }> }>);
        wordCount += wc;
        if (wc === 0) emptyLists += 1;
        else {
          const shortItems = itemTexts.filter((text) => text.split(/\s+/).filter(Boolean).length < 5).length;
          thinListItems += shortItems;
          if (itemTexts.length === 0 || wc < itemTexts.length * 8 || shortItems >= Math.ceil(itemTexts.length / 2)) {
            weakLists += 1;
          }
        }
        break;
      }
      case 'references':
        {
          const filledRefs = block.items.filter((ref) => String(ref.title ?? '').trim() || String(ref.url ?? '').trim());
          refsCount += filledRefs.length;
          wordCount += filledRefs
            .map((ref) => `${ref.title ?? ''} ${ref.url ?? ''}`.trim())
            .join(' ')
            .split(/\s+/)
            .filter(Boolean).length;
          if (filledRefs.length === 0 || (filledRefs.length > 0 && filledRefs.length < Math.min(2, block.items.length))) weakReferences += 1;
        }
        break;
      case 'image':
        if (!String(block.alt ?? '').trim()) imagesMissingAlt += 1;
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
    wordCount,
    paragraphCount,
    averageParagraphWords: paragraphCount > 0 ? Math.round(paragraphWordTotal / paragraphCount) : 0,
    h2Count,
    emptyParagraphs,
    emptyHeadings,
    emptySummaries,
    emptyKeyInsights,
    emptyLists,
    weakLists,
    thinListItems,
    emptyCallouts,
    thinCallouts,
    emptyQuotes,
    thinQuotes,
    weakReferences,
    refsCount,
    imagesMissingAlt,
    substantiveEmptyBlocks,
    thinParagraphs,
    thinSummaries,
    weakKeyInsights,
  };
}

// ── Template guidance ─────────────────────────────────────────────────────────

export function deriveTemplateDepthGuidance(
  contentType: 'blog' | 'article' | 'whitepaper' | 'newsletter' | 'story' | 'guide' | undefined,
  templateName: string | undefined,
  formatType: BlogFormatType | ArticleFormatType | WhitepaperFormatType | NewsletterFormatType | StoryFormatType | GuideFormatType | undefined,
  targetWords: number,
): { uniquenessRule: string; mustIncludePoints: string[]; retryFocus: string[] } | null {
  const normalized = typeof templateName === 'string' ? templateName.trim().toLowerCase() : '';

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

export function normalizeTemplateName(templateName: string | undefined): string {
  return typeof templateName === 'string' ? templateName.trim().toLowerCase() : '';
}

