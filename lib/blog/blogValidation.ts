/**
 * Blog quality validation and scoring system.
 *
 * calculateQualityScore()  — full 0-100 score with breakdown
 * getPublishBlockers()     — hard errors that prevent publishing
 */

import type { ContentBlock } from './blockTypes';
import { flattenBlocks } from './blockUtils';
import type { BlogFormatType, FormatValidationOverrides } from './blogStructureTemplates';
import { getStructureRules } from './blogStructureTemplates';

// ── Types ─────────────────────────────────────────────────────────────────────

export type Severity = 'error' | 'warning';

export interface ValidationIssue {
  severity: Severity;
  category: 'structure' | 'seo' | 'geo' | 'depth' | 'linking';
  message: string;
}

export interface ScoreBreakdown {
  structure: number; // max 25
  depth:     number; // max 25
  seo:       number; // max 25
  geo:       number; // max 15
  linking:   number; // max 10
}

export interface QualityScore {
  total:     number; // 0-100
  breakdown: ScoreBreakdown;
  issues:    ValidationIssue[];
  meta: {
    h2Count:          number;
    h3Count:          number;
    wordCount:        number;
    imagesMissingAlt: number;
    refsCount:        number;
    internalLinks:    number;
    hasKeyInsights:   boolean;
    hasSummary:       boolean;
    hasReferences:    boolean;
    shortParaCount:   number; // paragraphs < 50 words
    targetWordCount:  number; // user-selected target (800/1200/1600/2000)
  };
}

export type FormMeta = {
  title:                string;
  excerpt:              string;
  seo_meta_title:       string;
  seo_meta_description: string;
  tags:                 string[];
  /** User-selected word count target from the generation modal (800/1200/1600/2000). Defaults to 800. */
  target_word_count?:   number;
  /** Format type — adjusts structural validation rules. Accepts blog, newsletter, article, etc. format values. */
  format_type?:         string;
  /** Content type — articles/whitepapers get reduced SEO/linking weight, increased depth weight. */
  content_type?:        'blog' | 'article' | 'whitepaper' | 'newsletter' | 'story' | 'guide' | 'case-study';
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// ── Core scoring ──────────────────────────────────────────────────────────────

export function calculateQualityScore(
  blocks: ContentBlock[],
  form: FormMeta,
): QualityScore {
  const targetWords = form.target_word_count && form.target_word_count >= 300 ? form.target_word_count : 800;
  const formatType = (form.format_type || 'standard') as BlogFormatType;

  // Get format-specific validation overrides (null for 'standard')
  const formatRules = getStructureRules(formatType, targetWords);
  const overrides: FormatValidationOverrides | null = formatRules?.validation_overrides ?? null;

  // Flatten column blocks so nested content is analysed
  const flat = flattenBlocks(blocks);

  // ── Analyse blocks ────────────────────────────────────────────────────────
  let h2Count = 0;
  let h3Count = 0;
  let hasKeyInsights = false;
  let hasSummary = false;
  let hasReferences = false;
  let refsCount = 0;
  let imagesMissingAlt = 0;
  let internalLinks = 0;
  let totalWords = 0;
  let shortParaCount = 0;

  for (const block of flat) {
    switch (block.type) {
      case 'heading':
        // Only count headings that have actual text content
        if (block.text.trim().length > 0) {
          if (block.level === 2) h2Count++;
          if (block.level === 3) h3Count++;
        }
        break;

      case 'key_insights': {
        const filled = block.items.filter((s) => s.trim().length > 0);
        if (filled.length >= 1) hasKeyInsights = true;
        break;
      }

      case 'summary':
        if (block.body.trim().length > 0) hasSummary = true;
        break;

      case 'references': {
        const valid = block.items.filter((r) => r.title.trim() || r.url.trim());
        refsCount = valid.length;
        if (refsCount >= 1) hasReferences = true;
        break;
      }

      case 'image':
        if (!block.alt?.trim()) imagesMissingAlt++;
        break;

      case 'internal_link':
        if (block.slug?.trim()) internalLinks++;
        break;

      case 'paragraph': {
        const wc = wordCount(stripHtml(block.html));
        totalWords += wc;
        // Only count as "short" if the paragraph has some content but not enough
        if (wc > 0 && wc < 50) shortParaCount++;
        break;
      }

      case 'callout':
        totalWords += wordCount(block.body);
        break;

      case 'quote':
        totalWords += wordCount(block.text);
        break;

      case 'list':
        block.items.forEach((item) => { totalWords += wordCount(item.text); });
        break;
    }
  }

  // Also count key_insights items and summary body
  blocks.forEach((b) => {
    if (b.type === 'key_insights') totalWords += wordCount(b.items.join(' '));
    if (b.type === 'summary') totalWords += wordCount(b.body);
  });

  // ── Structure score (0–25) ────────────────────────────────────────────────
  const minH2 = overrides?.min_h2 ?? 3;
  const needsSummary    = overrides ? overrides.requires_summary     : true;
  const needsReferences = overrides ? overrides.requires_references  : true;
  const needsKeyInsights = overrides ? overrides.requires_key_insights : true;

  let structure = 0;
  if (h2Count >= minH2)       structure += 10;
  else if (h2Count >= Math.max(1, minH2 - 1)) structure += 6;
  else if (h2Count >= 1)      structure += 3;
  if (needsKeyInsights ? hasKeyInsights : true) structure += 5;
  if (needsSummary ? hasSummary : true)         structure += 5;
  if (needsReferences ? hasReferences : true)   structure += 5;

  // ── Depth score (0–25) ────────────────────────────────────────────────────
  let depth = 0;
  // Only award depth points if there is actual content
  if (totalWords > 0) {
    if (totalWords >= targetWords)            depth += 15;
    else if (totalWords >= targetWords * 0.7) depth += 12;
    else if (totalWords >= targetWords * 0.5) depth += 8;
    else if (totalWords >= targetWords * 0.3) depth += 4;
    else if (totalWords >= 150)               depth += 2;

    if (shortParaCount === 0)    depth += 5;
    else if (shortParaCount <= 1) depth += 3;
    else if (shortParaCount <= 3) depth += 1;

    const avgWords = blocks.filter(b => b.type === 'paragraph').length > 0
      ? totalWords / blocks.filter(b => b.type === 'paragraph').length
      : 0;
    if (avgWords >= 120)          depth += 5;
    else if (avgWords >= 80)      depth += 3;
    else if (avgWords >= 50)      depth += 1;
  }

  // ── SEO score (0–25) ──────────────────────────────────────────────────────
  let seo = 0;
  const titleLen = form.title.trim().length;
  if (titleLen >= 20 && titleLen <= 70) seo += 5;
  else if (titleLen >= 10)              seo += 2;

  const excerptLen = form.excerpt.trim().length;
  if (excerptLen >= 80)                 seo += 5;
  else if (excerptLen >= 40)            seo += 3;
  else if (excerptLen >= 1)             seo += 1;

  if (form.seo_meta_title?.trim())      seo += 5;
  if (form.seo_meta_description?.trim()) seo += 5;

  if (h2Count >= 3)                     seo += 5;
  else if (h2Count >= 2)                seo += 3;
  else if (h2Count >= 1)                seo += 1;

  // ── GEO score (0–15) ─────────────────────────────────────────────────────
  let geo = 0;
  if (hasSummary)                       geo += 4;
  if (hasKeyInsights)                   geo += 4;
  if (h2Count >= 3)                     geo += 3;
  if (refsCount >= 3)                   geo += 4;
  else if (refsCount >= 1)              geo += 2;

  // ── Linking score (0–10) — not applicable for articles or whitepapers ──────
  let linking = 0;
  if (form.content_type !== 'article' && form.content_type !== 'whitepaper' && form.content_type !== 'guide' && form.content_type !== 'case-study') {
    if (internalLinks >= 2)               linking += 10;
    else if (internalLinks === 1)         linking += 5;
  }

  // ── Content-type weight rescaling ─────────────────────────────────────────
  // Blog:       Structure 25 + Depth 25 + SEO 25 + GEO 15 + Linking 10 = 100
  // Article:    Structure 25 + Depth 35 + SEO 15 + GEO 15 + Linking  0 =  90
  // Whitepaper: Structure 25 + Depth 30 + SEO 15 + GEO 15 + Linking  0 =  85
  // Guide:      Structure 25 + Depth 30 + SEO 15 + GEO 15 + Linking  0 =  85
  // Newsletter: Structure 25 + Depth 20 + SEO 15 + GEO 20 + Linking 10 =  90
  // Story:      Structure 20 + Depth 30 + SEO 10 + GEO 20 + Linking  0 =  80
  const isArticle    = form.content_type === 'article';
  const isCaseStudy  = form.content_type === 'case-study';
  const isWhitepaper = form.content_type === 'whitepaper';
  const isNewsletter = form.content_type === 'newsletter';
  const isStory      = form.content_type === 'story';
  const isGuide      = form.content_type === 'guide';

  const finalStructure = isStory ? Math.min(20, Math.round(structure * 0.8)) : structure;
  const finalDepth     = (isWhitepaper || isGuide || isCaseStudy) ? Math.min(30, Math.round(depth * 1.2)) : isArticle ? Math.min(35, Math.round(depth * 1.4)) : isStory ? Math.min(30, Math.round(depth * 1.2)) : isNewsletter ? Math.min(20, Math.round(depth * 0.8)) : depth;
  const finalSeo       = isStory ? Math.min(10, Math.round(seo * 0.4)) : (isArticle || isCaseStudy || isWhitepaper || isNewsletter || isGuide) ? Math.min(15, Math.round(seo * 0.6)) : seo;
  const finalGeo       = (isNewsletter || isStory) ? Math.min(20, Math.round(geo * 1.33)) : geo;
  const finalLinking   = (isArticle || isCaseStudy || isWhitepaper || isStory || isGuide) ? 0 : linking;

  // ── Issues ───────────────────────────────────────────────────────────────
  const issues: ValidationIssue[] = [];

  // Hard errors (block publish) — format-aware
  if (h2Count < minH2)
    issues.push({ severity: 'error', category: 'structure', message: `At least ${minH2} H2 sections required (found ${h2Count})` });
  if (needsKeyInsights && !hasKeyInsights)
    issues.push({ severity: 'error', category: 'structure', message: 'Key Insights block must have at least 1 filled item' });
  if (needsSummary && !hasSummary)
    issues.push({ severity: 'error', category: 'structure', message: 'Summary block must be filled in' });
  if (needsReferences && !hasReferences)
    issues.push({ severity: 'error', category: 'structure', message: 'References block must have at least 1 entry' });
  if (imagesMissingAlt > 0)
    issues.push({ severity: 'error', category: 'seo', message: `${imagesMissingAlt} image${imagesMissingAlt > 1 ? 's' : ''} missing alt text` });

  // Warnings
  if (!form.excerpt.trim())
    issues.push({ severity: 'warning', category: 'seo', message: 'Add an excerpt — used in listings and SEO snippets' });
  if (!form.seo_meta_title?.trim())
    issues.push({ severity: 'warning', category: 'seo', message: 'Add a custom meta title for better search ranking' });
  if (!form.seo_meta_description?.trim())
    issues.push({ severity: 'warning', category: 'seo', message: 'Add a meta description for search engines' });
  if (totalWords < targetWords * 0.6)
    issues.push({ severity: 'warning', category: 'depth', message: `Content is short (${totalWords} words) — aim for ${targetWords}+` });
  if (shortParaCount > 2)
    issues.push({ severity: 'warning', category: 'depth', message: `${shortParaCount} sections under 50 words — add supporting detail` });
  if (internalLinks === 0 && form.content_type !== 'article' && form.content_type !== 'case-study' && form.content_type !== 'whitepaper' && form.content_type !== 'guide')
    issues.push({ severity: 'warning', category: 'linking', message: 'Add internal links to related Omnivyra articles' });
  if (refsCount < 3)
    issues.push({ severity: 'warning', category: 'geo', message: `Add ${3 - refsCount} more reference${3 - refsCount > 1 ? 's' : ''} for GEO authority (found ${refsCount})` });

  const maxScore = (isWhitepaper || isGuide || isCaseStudy) ? 85 : isStory ? 80 : (isArticle || isNewsletter) ? 90 : 100;
  const total = Math.min(maxScore, finalStructure + finalDepth + finalSeo + finalGeo + finalLinking);

  return {
    total,
    breakdown: { structure: finalStructure, depth: finalDepth, seo: finalSeo, geo: finalGeo, linking: finalLinking },
    issues,
    meta: {
      h2Count,
      h3Count,
      wordCount: totalWords,
      imagesMissingAlt,
      refsCount,
      internalLinks,
      hasKeyInsights,
      hasSummary,
      hasReferences,
      shortParaCount,
      targetWordCount: targetWords,
    },
  };
}

/** Hard errors that prevent publishing. */
export function getPublishBlockers(score: QualityScore): ValidationIssue[] {
  return score.issues.filter((i) => i.severity === 'error');
}
