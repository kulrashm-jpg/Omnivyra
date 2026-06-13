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
import { evaluatePhase1QualityGates, type Phase1GateTrigger } from '../../backend/services/longForm/phase1QualityGates';

// ── Types ─────────────────────────────────────────────────────────────────────

export type Severity = 'error' | 'warning';

export interface ValidationIssue {
  severity: Severity;
  // 'publishing' carries Phase 1 false-positive gate failures (leaked planner
  // artifacts, placeholders, undelivered frameworks, broken title promises).
  category: 'structure' | 'seo' | 'geo' | 'depth' | 'linking' | 'publishing';
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
  /**
   * Phase 1 false-positive prevention gates that fired (publishing artifacts,
   * placeholders, undelivered frameworks, unfulfilled title promises). Optional
   * + empty for a clean article and for scorers that do not run the gates.
   * Each fired gate is ALSO an `error` issue (category 'publishing') so the
   * editor and publish validation surface it without extra wiring.
   */
  gates?: Phase1GateTrigger[];
  /** The cap applied to `total` by the gates (min of fired caps), or null. */
  scoreCap?: number | null;
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

/**
 * Reconstruct a representative HTML string from content blocks so the shared
 * Phase 1 gate (which operates on title + HTML) can run against the SAME content
 * the user is scoring. Lists / key-insights / references become <li> so the
 * framework-delivery detector sees enumerated structure; all text-bearing blocks
 * are included so placeholder / planner-artifact scans cover the whole draft.
 */
function buildGateContentHtml(flat: ContentBlock[]): string {
  const parts: string[] = [];
  for (const b of flat) {
    switch (b.type) {
      case 'heading':      parts.push(`<h${b.level}>${b.text}</h${b.level}>`); break;
      case 'paragraph':    parts.push(b.html); break;
      case 'callout':      parts.push(`<p>${b.body}</p>`); break;
      case 'quote':        parts.push(`<blockquote>${b.text}</blockquote>`); break;
      case 'summary':      parts.push(`<p>${b.body}</p>`); break;
      // key_insights / references are structural boilerplate blocks — they must
      // NOT count as framework delivery or promise fulfillment. Mark them so the
      // shared gate excludes them (same outcome as a "References"/"Key Insights"
      // heading in raw generated HTML). `list` stays unmarked = real content.
      case 'key_insights': parts.push(`<ul data-omni-boilerplate="key_insights">${b.items.map((i) => `<li>${i}</li>`).join('')}</ul>`); break;
      case 'list':         parts.push(`<ul>${b.items.map((i) => `<li>${i.text}</li>`).join('')}</ul>`); break;
      case 'references':   parts.push(`<ul data-omni-boilerplate="references">${b.items.map((r) => `<li>${r.title} ${r.url}</li>`).join('')}</ul>`); break;
    }
  }
  return parts.join('\n');
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
  const isStoryContent = form.content_type === 'story';
  const minH2 = overrides?.min_h2 ?? 3;
  const needsSummary    = isStoryContent ? false : overrides ? overrides.requires_summary     : true;
  const needsReferences = isStoryContent ? false : overrides ? overrides.requires_references  : true;
  const needsKeyInsights = isStoryContent ? false : overrides ? overrides.requires_key_insights : true;

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

  const storyStructure = Math.min(25, (h2Count >= 3 ? 15 : h2Count >= 2 ? 12 : h2Count >= 1 ? 6 : 0) + (titleLen >= 20 ? 5 : 0) + (excerptLen >= 60 ? 5 : 0));
  const storyDepth = totalWords >= targetWords * 0.6
    ? 25
    : totalWords >= targetWords * 0.45
      ? 20
      : totalWords >= targetWords * 0.3
        ? 14
        : totalWords >= 150
          ? 8
          : 0;
  const storySeo = Math.min(20, (titleLen >= 20 ? 8 : titleLen >= 10 ? 4 : 0) + (excerptLen >= 80 ? 8 : excerptLen >= 40 ? 5 : 0) + (form.tags?.length ? 4 : 0));
  const storyGeo = Math.min(30, (h2Count >= 3 ? 10 : h2Count >= 2 ? 8 : h2Count >= 1 ? 4 : 0) + (totalWords >= targetWords * 0.45 ? 8 : totalWords >= 250 ? 4 : 0) + (excerptLen >= 80 ? 6 : 0) + (shortParaCount <= 6 ? 6 : shortParaCount <= 10 ? 3 : 0));
  const finalStructure = isStory ? storyStructure : structure;
  const finalDepth     = isStory ? storyDepth : (isWhitepaper || isGuide || isCaseStudy) ? Math.min(30, Math.round(depth * 1.2)) : isArticle ? Math.min(35, Math.round(depth * 1.4)) : isNewsletter ? Math.min(20, Math.round(depth * 0.8)) : depth;
  const finalSeo       = isStory ? storySeo : (isArticle || isCaseStudy || isWhitepaper || isNewsletter || isGuide) ? Math.min(15, Math.round(seo * 0.6)) : seo;
  const finalGeo       = isStory ? storyGeo : isNewsletter ? Math.min(20, Math.round(geo * 1.33)) : geo;
  const finalLinking   = (isArticle || isCaseStudy || isWhitepaper || isStory || isGuide) ? 0 : linking;
  const hasSubstantiveBody = totalWords >= 20 || hasKeyInsights || hasSummary || refsCount > 0;
  const guardedStructure = hasSubstantiveBody ? finalStructure : Math.min(finalStructure, 4);
  const guardedDepth = hasSubstantiveBody ? finalDepth : 0;
  const guardedSeo = hasSubstantiveBody ? finalSeo : 0;
  const guardedGeo = hasSubstantiveBody ? finalGeo : 0;
  const guardedLinking = hasSubstantiveBody ? finalLinking : 0;

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
  if (internalLinks === 0 && form.content_type !== 'article' && form.content_type !== 'case-study' && form.content_type !== 'whitepaper' && form.content_type !== 'guide' && form.content_type !== 'story')
    issues.push({ severity: 'warning', category: 'linking', message: 'Add internal links to related Omnivyra articles' });
  if (refsCount < 3 && form.content_type !== 'story')
    issues.push({ severity: 'warning', category: 'geo', message: `Add ${3 - refsCount} more reference${3 - refsCount > 1 ? 's' : ''} for GEO authority (found ${refsCount})` });

  const maxScore = (isWhitepaper || isGuide || isCaseStudy) ? 85 : (isArticle || isNewsletter) ? 90 : 100;
  const baseTotal = Math.min(maxScore, guardedStructure + guardedDepth + guardedSeo + guardedGeo + guardedLinking);

  // ── Phase 1 false-positive prevention gates ───────────────────────────────
  // Same shared implementation used by the generation validator (System #1).
  // Category scoring above is UNCHANGED; gates only (a) cap the final `total`
  // after it is computed and (b) add explanatory `error` issues so the editor
  // and publish validation surface the defect. A clean draft is unaffected.
  const gateReport = evaluatePhase1QualityGates({
    title: form.title,
    contentHtml: buildGateContentHtml(flat),
  });
  for (const gate of gateReport.triggered) {
    issues.push({ severity: 'error', category: 'publishing', message: gate.issue });
  }
  const total = gateReport.scoreCap !== null ? Math.min(baseTotal, gateReport.scoreCap) : baseTotal;

  return {
    total,
    breakdown: { structure: guardedStructure, depth: guardedDepth, seo: guardedSeo, geo: guardedGeo, linking: guardedLinking },
    issues,
    gates: gateReport.triggered,
    scoreCap: gateReport.scoreCap,
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

/**
 * Hard errors that prevent publishing. This includes Phase 1 gate failures
 * (category 'publishing') because `calculateQualityScore` records each fired
 * gate as an `error` issue — so a placeholder, leaked planner artifact,
 * undelivered framework, or broken title promise blocks publication through the
 * exact same path as structural errors. No separate gate call is needed here:
 * the single source of truth is `evaluatePhase1QualityGates`, run once during
 * scoring.
 */
export function getPublishBlockers(score: QualityScore): ValidationIssue[] {
  return score.issues.filter((i) => i.severity === 'error');
}
