/**
 * runBlogGeneration
 *
 * Single source of truth for all blog generation logic.
 * Called by:
 *   - /api/admin/blog/generate  (Super Admin — public_blogs)
 *   - /api/blogs/generate       (Company Admin — blogs)
 *
 * API routes are responsible ONLY for:
 *   1. Auth / role enforcement
 *   2. Company context injection (placeholder per route)
 *   3. Calling runBlogGeneration(input)
 *   4. Returning res.status(200).json(result)
 *
 * No generation logic lives inside any API route file.
 *
 * PURE FUNCTION DESIGN
 * ─────────────────────
 * runBlogGeneration does NOT access req, res, cookies, headers, or session.
 * All external data access is injected via BlogGenerationRequest:
 *   - fetchAngleData   — overrideable for testing / mocking
 *   - fetchSeriesData  — overrideable for testing / mocking
 * Default implementations are module-level functions that use supabase.
 * Injectable overrides let callers eliminate all DB coupling in unit tests.
 */

import { supabase } from '../../backend/db/supabaseClient';
import { runCompletionWithOperation } from '../../backend/services/aiGateway';
import { getBlogTemplateDepthGuidance } from './blogTemplateGuidance';
import { extractBlogContext } from './blockExtractor';
import { flattenBlocks } from './blockUtils';
import { htmlToBlocks } from './htmlToBlocks';
import type { ContentBlock, InternalLinkBlock } from './blockTypes';
import {
  generateClarificationQuestions,
  type ThemeInput,
  type ClarificationQuestion,
} from './blogClarificationEngine';
import {
  buildAnglesSystemPrompt,
  buildAnglesUserPrompt,
  validateAnglesOutput,
  buildFallbackAngles,
  buildGenerationSystemPrompt,
  buildGenerationUserPrompt,
  validateGenerationOutput,
  buildGenerationFallback,
  type BlogAngle,
  type AngleType,
  type BlogGenerationInput,
  type BlogGenerationOutput,
  type SeriesSummary,
} from './blogGenerationEngine';
import {
  checkHookStrength,
  extractFirstParagraph,
  type HookAssessment,
} from './hookAssessment';
import {
  type AngleEffectivenessEntry,
} from './feedbackOptimizationEngine';
import { isValidBlogFormat, isValidArticleFormat, isValidWhitepaperFormat, isValidNewsletterFormat, isValidStoryFormat, isValidGuideFormat, type BlogFormatType, type ArticleFormatType, type WhitepaperFormatType, type NewsletterFormatType, type StoryFormatType, type GuideFormatType } from './blogStructureTemplates';
import { extractPrimaryKeyword, type SEOIntelligenceResult } from './seoIntelligenceEngine';
import { type TrendIntelligenceResult } from './trendIntelligenceEngine';
import {
  buildGenerationContext,
  buildUnifiedPromptContext,
  type OrchestratorResult,
} from '../content/contentGenerationOrchestrator';
import { getNewsletterTemplateDepthGuidance } from '../newsletter/newsletterTemplateGuidance';

// ── Injectable data-access signatures ────────────────────────────────────────

/**
 * Returns the most-used angle type for a company/table, or null if insufficient data.
 * Used as a frequency proxy for recommended_angle in mode='angles'.
 */
export type FetchAngleDataFn = (
  companyId: string,
  blogTable: 'blogs' | 'public_blogs',
) => Promise<AngleType | null>;

/**
 * Fetches series blog summaries by ID for mode='full' series continuation.
 * company_id is provided so the default implementation can scope the query.
 */
export type FetchSeriesDataFn = (
  ids:       string[],
  companyId: string,
  blogTable: 'blogs' | 'public_blogs',
) => Promise<SeriesSummary[]>;

// ── Default supabase implementations ─────────────────────────────────────────

/**
 * Default implementation — uses supabase directly.
 * Replace with an injectable in tests or edge cases.
 */
async function defaultFetchAngleData(
  companyId: string,
  blogTable:  'blogs' | 'public_blogs',
): Promise<AngleType | null> {
  const query = supabase
    .from(blogTable)
    .select('angle_type')
    .eq('status', 'published')
    .not('angle_type', 'is', null);

  if (blogTable === 'blogs') {
    query.eq('company_id', companyId);
  }

  const { data } = await query;
  if (!data || data.length === 0) return null;

  const counts: Record<string, number> = {};
  for (const b of data as Array<{ angle_type: string }>) {
    if (b.angle_type) counts[b.angle_type] = (counts[b.angle_type] ?? 0) + 1;
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const top    = sorted[0]?.[0];
  return (top && ['analytical', 'contrarian', 'strategic'].includes(top))
    ? (top as AngleType)
    : null;
}

/**
 * Default implementation — uses supabase directly.
 * Replace with an injectable in tests or edge cases.
 */
async function defaultFetchSeriesData(
  ids:       string[],
  companyId: string,
  blogTable: 'blogs' | 'public_blogs',
): Promise<SeriesSummary[]> {
  const query = supabase
    .from(blogTable)
    .select('title, content, content_blocks')
    .in('id', ids);

  // Company blogs: scope to company to prevent cross-company data access
  if (blogTable === 'blogs') {
    query.eq('company_id', companyId);
  }

  const { data } = await query;
  if (!data || data.length === 0) return [];

  return (data as Array<{ title: string; content: string; content_blocks: unknown }>).map(b => {
    const extracted = extractBlogContext(b.content_blocks);
    return {
      title:      b.title,
      headings:   extracted.h2_headings,
      key_points: extracted.key_insights,
      summary:    extracted.summary,
    };
  });
}

// ── Input ─────────────────────────────────────────────────────────────────────

/**
 * Company context forwarded from the API route after profile fetch.
 * Used by generation prompts to tailor tone, audience, and brand voice.
 * All fields optional — partial context is better than none.
 */
export interface CompanyContext {
  brand_voice?: string;
  audience?:    string;
  industry?:    string;
  // ── Additional profile fields for auto-enrichment ──
  companyName?:            string;
  uniqueValue?:            string;
  competitiveAdvantages?:  string;
  productsServices?:       string;
  contentThemes?:          string;
  campaignFocus?:          string;
  growthPriorities?:       string;
  coreProblemStatement?:   string;
  painSymptoms?:           string[];
  authorityDomains?:       string[];
  desiredTransformation?:  string;
  keyMessages?:            string;
  goals?:                  string;
  geography?:              string;
  /**
   * Pre-formatted writing style instructions block from WritingStyleEngine.
   * When present, this is injected as a WRITING STYLE GUIDE section in the
   * generation user prompt. Build with:
   *   buildFormattedStyleInstructions(profile) from lib/content/writingStyleEngine
   */
  writingStyleInstructions?: string;
}

export interface BlogGenerationRequest {
  company_id:       string;
  mode?:            'angles' | 'full';
  topic:            string;
  cluster?:         string;
  intent?:          string;
  related_blogs?:   string[];
  series_blog_ids?: string[];
  series_context?:  string;
  answers?:         Record<string, string>;
  selected_angle?:  BlogAngle;
  tone?:            string;
  goal_type?:       string;
  /**
   * Which table to look up series_blog_ids from.
   * - 'blogs'        → Company Admin (scoped by company_id)
   * - 'public_blogs' → Super Admin   (no company scope)
   */
  blogTable?: 'blogs' | 'public_blogs';
  /**
   * Company profile context injected by the API route.
   * Fetched by the route before calling runBlogGeneration.
   * Used to personalise generation prompts for brand voice, audience, industry.
   */
  companyContext?: CompanyContext;
  /**
   * Injectable data-access override for angle frequency lookup.
   * Defaults to defaultFetchAngleData (supabase).
   * Override in unit tests to eliminate DB coupling.
   */
  fetchAngleData?: FetchAngleDataFn;
  /**
   * Injectable data-access override for series blog summary fetch.
   * Defaults to defaultFetchSeriesData (supabase).
   * Override in unit tests to eliminate DB coupling.
   */
  fetchSeriesData?: FetchSeriesDataFn;
  /** 'blog' (default), 'article', 'whitepaper', 'newsletter', 'story', or 'guide' — controls prompt variants */
  contentType?: 'blog' | 'article' | 'whitepaper' | 'newsletter' | 'story' | 'guide';
  /** Format type — controls structural rules in generation prompt. */
  formatType?: BlogFormatType | ArticleFormatType | WhitepaperFormatType | NewsletterFormatType | StoryFormatType | GuideFormatType;
  /** Template blocks — when provided, AI fills this template structure directly instead of generating HTML. */
  template_blocks?: import('./blockTypes').ContentBlock[];
  template_name?: string;
}

// ── Output discriminated union ────────────────────────────────────────────────

export type BlogGenerationResult =
  | {
      needs_clarification: true;
      questions:           ClarificationQuestion[];
    }
  | {
      needs_clarification: false;
      mode:                'angles';
      angles:              BlogAngle[];
      recommended_angle:   AngleType | null;
      /** Per-angle effectiveness scores from feedback loop (empty if no data) */
      angle_effectiveness?: Partial<Record<AngleType, AngleEffectivenessEntry>>;
      /** Whether recommendation is effectiveness-based (true) or frequency-based (false/absent) */
      effectiveness_based?: boolean;
      /** SEO intelligence data for keyword display */
      seo_intelligence?: SEOIntelligenceResult;
      /** Relevant trend signals for display */
      trend_intelligence?: TrendIntelligenceResult;
    }
  | {
      needs_clarification: false;
      mode:                'full';
      confidence:          'high' | 'medium';
      result:              BlogGenerationOutput & { content_blocks: unknown[] };
      hook_assessment:     HookAssessment;
      /** Whether the template-aware generation path was used */
      template_used?:      boolean;
      /** SEO intelligence data for keyword persistence */
      seo_intelligence?: SEOIntelligenceResult;
      /** Relevant trend signals for reference */
      trend_intelligence?: TrendIntelligenceResult;
    };

// ── Internal link injection ──────────────────────────────────────────────────

function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function stripHtmlForWordCount(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function countListWords(
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

function analyzeTemplateContentBlocks(blocks: ContentBlock[]): {
  wordCount: number;
  paragraphCount: number;
  averageParagraphWords: number;
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
  let thinParagraphs = 0;
  let thinSummaries = 0;
  let weakKeyInsights = 0;
  let paragraphCount = 0;
  let paragraphWordTotal = 0;

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
          wordCount += filledRefs
            .map((ref) => `${ref.title ?? ''} ${ref.url ?? ''}`.trim())
            .join(' ')
            .split(/\s+/)
            .filter(Boolean).length;
          if (filledRefs.length > 0 && filledRefs.length < Math.min(2, block.items.length)) weakReferences += 1;
        }
        break;
      case 'image':
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
    substantiveEmptyBlocks,
    thinParagraphs,
    thinSummaries,
    weakKeyInsights,
  };
}

function deriveTemplateDepthGuidance(
  contentType: BlogGenerationRequest['contentType'],
  templateName: string | undefined,
  formatType: BlogGenerationRequest['formatType'],
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

/**
 * Fetches published blogs for the same company that are topically related to the
 * generated blog, then injects InternalLinkBlock entries into the content_blocks
 * array (placed after the 2nd and 4th H2 sections or last two H2 sections).
 *
 * Target: 2 internal links minimum. Matching is keyword-based (topic words appear
 * in the blog title). Falls back gracefully — if fewer than 2 related blogs are
 * found, injects whatever is available (may be 0 or 1).
 */
async function injectInternalLinks(
  blocks:    ContentBlock[],
  topic:     string,
  companyId: string,
  blogTable: 'blogs' | 'public_blogs',
  excludeTitles: string[] = [],
): Promise<ContentBlock[]> {
  try {
    // Extract meaningful keywords from the topic (3+ chars, not stop words)
    const STOP_WORDS = new Set([
      'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'her',
      'was', 'one', 'our', 'out', 'has', 'have', 'from', 'with', 'they',
      'been', 'this', 'that', 'will', 'each', 'make', 'like', 'into',
      'them', 'than', 'its', 'over', 'such', 'what', 'how', 'why', 'most',
      'about', 'which', 'when', 'your', 'does', 'more',
    ]);
    const keywords = topic
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 3 && !STOP_WORDS.has(w));

    if (keywords.length === 0) return blocks;

    // Fetch published blogs for this company
    const query = supabase
      .from(blogTable)
      .select('slug, title, excerpt')
      .eq('status', 'published')
      .not('slug', 'is', null);

    if (blogTable === 'blogs') {
      query.eq('company_id', companyId);
    }

    const { data } = await query.limit(50);
    if (!data || data.length === 0) return blocks;

    // Score each blog by keyword overlap with the topic
    const excludeSet = new Set(excludeTitles.map(t => t.toLowerCase()));
    const scored = (data as Array<{ slug: string; title: string; excerpt: string | null }>)
      .filter(b => b.slug && b.title && !excludeSet.has(b.title.toLowerCase()))
      .map(b => {
        const titleLow = b.title.toLowerCase();
        const score = keywords.filter(kw => titleLow.includes(kw)).length;
        return { ...b, score };
      })
      .filter(b => b.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2); // take top 2

    if (scored.length === 0) return blocks;

    // Build InternalLinkBlock entries
    const linkBlocks: InternalLinkBlock[] = scored.map(b => ({
      id:      uuid(),
      type:    'internal_link' as const,
      slug:    b.slug,
      title:   b.title,
      excerpt: b.excerpt || undefined,
    }));

    // Find H2 heading positions to insert after
    const h2Indices: number[] = [];
    for (let i = 0; i < blocks.length; i++) {
      const blk = blocks[i];
      if (blk.type === 'heading' && blk.level === 2) {
        // Skip Summary/References headings
        const text = blk.text.toLowerCase().replace(/[^a-z]/g, '');
        if (text !== 'summary' && text !== 'conclusion' && text !== 'references' && text !== 'sources') {
          h2Indices.push(i);
        }
      }
    }

    // Determine insertion indices: after 2nd H2 section and after 4th (or last substantive) H2 section
    // "After a section" means before the next H2 heading (or at the end of content sections)
    const result = [...blocks];
    let inserted = 0;

    // For each link, find the insertion point after the target H2 section
    const targetH2Positions = linkBlocks.length >= 2
      ? [Math.min(1, h2Indices.length - 1), Math.min(3, h2Indices.length - 1)]
      : [Math.min(1, h2Indices.length - 1)];

    for (let li = linkBlocks.length - 1; li >= 0; li--) {
      const h2Pos = targetH2Positions[li] ?? 0;
      if (h2Pos < 0 || h2Pos >= h2Indices.length) continue;

      const h2BlockIdx = h2Indices[h2Pos];
      // Find the next H2 after this one (or summary/references), insert just before it
      let insertAt = result.length; // default: end
      for (let i = h2BlockIdx + 1; i < result.length; i++) {
        const blk = result[i];
        if (blk.type === 'heading' && blk.level === 2) {
          insertAt = i;
          break;
        }
        if (blk.type === 'summary' || blk.type === 'references') {
          insertAt = i;
          break;
        }
      }

      result.splice(insertAt + inserted, 0, linkBlocks[li]);
      inserted++;
    }

    return result;
  } catch {
    // Internal link injection is best-effort — never block generation
    return blocks;
  }
}

// ── Main function ─────────────────────────────────────────────────────────────

export async function runBlogGeneration(
  req: BlogGenerationRequest,
): Promise<BlogGenerationResult> {
  const {
    company_id,
    mode = 'full',
    topic,
    cluster,
    intent,
    related_blogs,
    series_blog_ids,
    series_context,
    answers,
    selected_angle,
    tone,
    goal_type,
    blogTable       = 'blogs',
    fetchAngleData  = defaultFetchAngleData,
    fetchSeriesData = defaultFetchSeriesData,
    companyContext,
    contentType     = 'blog',
    formatType: rawFormatType,
    template_blocks,
    template_name,
  } = req;

  // Default format per content type
  const formatType = rawFormatType || (contentType === 'whitepaper' ? 'research' : contentType === 'guide' ? 'comprehensive' : contentType === 'newsletter' ? 'weekly-brief' : contentType === 'story' ? 'short_story' : contentType === 'article' ? 'narrative' : 'standard');

  const themeInput: ThemeInput = {
    topic:          topic.trim(),
    cluster:        typeof cluster        === 'string' ? cluster.trim()        : undefined,
    intent:         typeof intent         === 'string' ? intent.trim()         : undefined,
    related_blogs:  Array.isArray(related_blogs)
      ? related_blogs.filter((b: unknown) => typeof b === 'string')
      : undefined,
    series_context: typeof series_context === 'string' ? series_context.trim() : undefined,
  };

  const hasAnswers = (
    answers !== null &&
    answers !== undefined &&
    typeof answers === 'object' &&
    Object.keys(answers).length > 0
  );

  // ── Clarification check ─────────────────────────────────────────────────────
  if (!hasAnswers && !selected_angle) {
    const questions = generateClarificationQuestions(themeInput);
    if (questions.length > 0) {
      return { needs_clarification: true, questions };
    }
  }

  const confidence: 'high' | 'medium' = hasAnswers ? 'medium' : 'high';

  const contextualAnswers: Record<string, string> = {
    ...(hasAnswers ? (answers as Record<string, string>) : {}),
  };
  if (companyContext?.audience && !contextualAnswers.audience) {
    contextualAnswers.audience = companyContext.audience;
  }
  if (companyContext?.industry && !contextualAnswers.industry) {
    contextualAnswers.industry = companyContext.industry;
  }
  if (companyContext?.brand_voice && !contextualAnswers.tone) {
    contextualAnswers.tone = companyContext.brand_voice;
  }

  // ── Auto-enrich contextual fields from company profile ─────────────────────
  // These fields dramatically improve AI output depth. Only populate when the
  // user hasn't explicitly provided them, so manual overrides always win.

  if (!contextualAnswers.uniqueness_directive && companyContext) {
    const parts: string[] = [];
    if (companyContext.uniqueValue) parts.push(companyContext.uniqueValue);
    if (companyContext.competitiveAdvantages) parts.push(companyContext.competitiveAdvantages);
    if (parts.length > 0) {
      contextualAnswers.uniqueness_directive =
        `Differentiate by highlighting: ${parts.join('. ')}. Avoid generic advice — tie insights back to these unique strengths.`;
    }
  }

  if (!contextualAnswers.must_include_points && companyContext) {
    const twRaw = contextualAnswers.target_word_count ? parseInt(contextualAnswers.target_word_count, 10) : 0;
    // Tier: 800 = base, 1200+ = medium depth, 1600+ = deep, 2000+ = comprehensive
    const tier = twRaw >= 2000 ? 3 : twRaw >= 1600 ? 2 : twRaw >= 1200 ? 1 : 0;

    const points: string[] = [];
    if (companyContext.coreProblemStatement) points.push(`The core problem: ${companyContext.coreProblemStatement}`);
    if (companyContext.painSymptoms?.length) {
      const maxPains = tier >= 2 ? 5 : tier >= 1 ? 4 : 3;
      points.push(`Key pain points: ${companyContext.painSymptoms.slice(0, maxPains).join(', ')}`);
    }
    if (companyContext.desiredTransformation) points.push(`Transformation outcome: ${companyContext.desiredTransformation}`);
    if (companyContext.authorityDomains?.length) {
      const maxDomains = tier >= 2 ? 5 : tier >= 1 ? 4 : 3;
      points.push(`Authority areas: ${companyContext.authorityDomains.slice(0, maxDomains).join(', ')}`);
    }
    if (companyContext.keyMessages) points.push(`Key messages: ${companyContext.keyMessages}`);
    if (companyContext.productsServices) points.push(`Products/services to reference: ${companyContext.productsServices}`);

    // 1200+: add depth-enhancing directives so the AI has enough material
    if (tier >= 1) {
      points.push('Include real-world examples or data points for each major section');
      points.push('Address common mistakes or misconceptions the audience holds');
      if (companyContext.competitiveAdvantages) {
        points.push(`Weave in competitive differentiators: ${companyContext.competitiveAdvantages}`);
      }
    }

    // 1600+: add implementation guidance and brand references
    if (tier >= 2) {
      points.push('Provide actionable implementation steps or frameworks readers can apply');
      if (companyContext.companyName) {
        points.push(`Reference ${companyContext.companyName}'s perspective or expertise where natural`);
      }
    }

    // 2000+: add comprehensive depth requirements
    if (tier >= 3) {
      points.push('Include a before/after comparison or case study showing measurable impact');
      points.push('Add expert analysis or contrarian viewpoints to deepen each section');
      points.push('Provide a mini-framework, checklist, or decision matrix readers can use immediately');
    }

    if (points.length > 0) {
      contextualAnswers.must_include_points = points.join('; ');
    }
  }

  if (!contextualAnswers.campaign_objective && companyContext) {
    const objParts: string[] = [];
    if (companyContext.campaignFocus) objParts.push(companyContext.campaignFocus);
    else if (companyContext.growthPriorities) objParts.push(companyContext.growthPriorities);
    else if (companyContext.goals) objParts.push(companyContext.goals);
    if (intent) {
      const intentMap: Record<string, string> = {
        awareness:  'Build awareness and educate the audience',
        authority:  'Establish thought leadership and deep expertise',
        conversion: 'Drive readers toward a decision or action',
        retention:  'Deepen engagement with existing audience',
      };
      objParts.push(intentMap[intent] ?? intent);
    }
    if (objParts.length > 0) {
      contextualAnswers.campaign_objective = objParts.join('. ');
    }
  }

  if (!contextualAnswers.trend_context && companyContext) {
    const trendParts: string[] = [];
    if (companyContext.industry) trendParts.push(`Industry: ${companyContext.industry}`);
    if (companyContext.geography) trendParts.push(`Geography: ${companyContext.geography}`);
    if (companyContext.contentThemes) trendParts.push(`Key themes: ${companyContext.contentThemes}`);
    if (trendParts.length > 0) {
      contextualAnswers.trend_context = trendParts.join('. ') + '. Reference current industry trends and developments.';
    }
  }

  const twRaw = contextualAnswers.target_word_count ? parseInt(contextualAnswers.target_word_count, 10) : 0;
  const templateDepthGuidance = deriveTemplateDepthGuidance(contentType, template_name, formatType, twRaw);
  if (templateDepthGuidance) {
    contextualAnswers.uniqueness_directive = contextualAnswers.uniqueness_directive
      ? `${contextualAnswers.uniqueness_directive} ${templateDepthGuidance.uniquenessRule}`
      : templateDepthGuidance.uniquenessRule;

    contextualAnswers.must_include_points = contextualAnswers.must_include_points
      ? `${contextualAnswers.must_include_points}; ${templateDepthGuidance.mustIncludePoints.join('; ')}`
      : templateDepthGuidance.mustIncludePoints.join('; ');
  }

  const hasContextualAnswers = Object.keys(contextualAnswers).length > 0;

  const baseInput: BlogGenerationInput = {
    ...themeInput,
    answers:        hasContextualAnswers ? contextualAnswers : undefined,
    selected_angle: selected_angle as BlogAngle | undefined,
    tone:           typeof tone      === 'string' ? tone.trim()      : undefined,
    goal_type:      typeof goal_type === 'string' ? goal_type.trim() : undefined,
    writingStyleInstructions: companyContext?.writingStyleInstructions,
    contentType,
    formatType,
    templateName: typeof template_name === 'string' ? template_name : undefined,
    primaryKeyword: extractPrimaryKeyword(topic.trim()),
  };

  // ── Mode: angles ────────────────────────────────────────────────────────────
  if (mode === 'angles') {
    const [anglesResult, perfData, orchestratorResult] = await Promise.allSettled([

      // AI angle generation
      (async (): Promise<ReturnType<typeof validateAnglesOutput>> => {
        const aiResult = await runCompletionWithOperation({
          operation:       'blogGeneration',
          companyId:       company_id,
          model:           'gpt-4o-mini',
          temperature:     0.7,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: buildAnglesSystemPrompt(contentType) },
            { role: 'user',   content: buildAnglesUserPrompt(baseInput) },
          ],
        });
        const raw = aiResult.output ? JSON.parse(aiResult.output) : null;
        return raw ? validateAnglesOutput(raw) : null;
      })(),

      // Angle frequency proxy — fallback when feedback data is insufficient
      fetchAngleData(company_id, blogTable),

      // Orchestrator: SEO + feedback + trend intelligence (parallel internally)
      buildGenerationContext({ contentType, topic: topic.trim(), companyId: company_id, blogTable }),
    ]);

    const angles = (anglesResult.status === 'fulfilled' && anglesResult.value)
      ? anglesResult.value
      : buildFallbackAngles(topic.trim());

    // Extract orchestrator results (best-effort)
    const ctx: OrchestratorResult | null =
      orchestratorResult.status === 'fulfilled' ? orchestratorResult.value : null;

    // Prefer effectiveness-based recommendation; fall back to frequency
    const feedback = ctx?.feedback ?? null;

    let recommended_angle: AngleType | null = null;
    let effectiveness_based = false;

    if (feedback?.has_sufficient_data && feedback.recommended_angle_type) {
      recommended_angle = feedback.recommended_angle_type;
      effectiveness_based = true;
    } else {
      recommended_angle =
        (perfData.status === 'fulfilled' && perfData.value) ? perfData.value : null;
    }

    return {
      needs_clarification: false,
      mode:                'angles',
      angles,
      recommended_angle,
      angle_effectiveness: feedback?.angle_effectiveness ?? {},
      effectiveness_based,
      seo_intelligence:    ctx?.seo ?? undefined,
      trend_intelligence:  ctx?.trends ?? undefined,
    };
  }

  // ── Mode: full ──────────────────────────────────────────────────────────────

  // Orchestrator: all intelligence engines in parallel (non-blocking)
  const ctx = await buildGenerationContext({
    contentType, topic: topic.trim(), companyId: company_id, blogTable,
    formatType, targetWordCount: baseInput.answers?.target_word_count
      ? parseInt(String(baseInput.answers.target_word_count), 10) || 1200
      : 1200,
  }).catch((): OrchestratorResult => ({ seo: null, feedback: null, trends: null, structure: null }));

  const unifiedPromptContext = buildUnifiedPromptContext(ctx);

  // Series continuation: fetch prior blog summaries via injectable
  let series_summaries: SeriesSummary[] | undefined;

  if (Array.isArray(series_blog_ids) && series_blog_ids.length > 0) {
    const validIds = series_blog_ids.filter((id: unknown) => typeof id === 'string');

    if (validIds.length > 0) {
      const fetched = await fetchSeriesData(validIds, company_id, blogTable);
      if (fetched.length > 0) series_summaries = fetched;
    }
  }

  const generationInput: BlogGenerationInput = { ...baseInput, series_summaries, unifiedPromptContext };

  try {
    const targetWc = generationInput.answers?.target_word_count
      ? parseInt(String(generationInput.answers.target_word_count), 10) || undefined
      : undefined;

    // Scale max_tokens to word target.
    // Template-aware path outputs JSON with block structure, metadata, and nested objects
    // which requires ~5 tokens per target word. Standard HTML path needs ~2.5 tokens/word.
    const shouldBypassTemplatePath = typeof template_name === 'string' && template_name.trim().toLowerCase() === 'classic';
    const isTemplatePath = !shouldBypassTemplatePath && template_blocks && Array.isArray(template_blocks) && template_blocks.length > 0;
    const tokensPerWord = isTemplatePath ? 5 : 2.5;
    const maxTokens = targetWc && targetWc >= 800
      ? Math.min(16384, Math.max(4096, Math.round(targetWc * tokensPerWord)))
      : 4096;

    // ── Template-aware generation path ─────────────────────────────────────
    // When a template is provided, AI fills the block structure directly
    // instead of generating a monolithic HTML blob.
    if (!shouldBypassTemplatePath && template_blocks && Array.isArray(template_blocks) && template_blocks.length > 0) {
      const { buildTemplateAwareSystemPromptV2, buildTemplateAwareUserPrompt, parseTemplateOutput } =
        await import('./blogGenerationEngine');
      const normalizedTemplateName = typeof template_name === 'string' ? template_name.trim().toLowerCase() : '';
      const isNewsletterTemplate = contentType === 'newsletter';
      const isMinimalThesisTemplate = isNewsletterTemplate && normalizedTemplateName === 'minimal thesis';
      const isSplitScreenInsightTemplate = isNewsletterTemplate && normalizedTemplateName === 'split-screen insight';
      const isInsightLetterTemplate =
        isNewsletterTemplate &&
        (formatType === 'insight-letter' || normalizedTemplateName === 'minimal thesis' || normalizedTemplateName === 'split-screen insight');
      const isWeeklyBriefTemplate =
        isNewsletterTemplate &&
        (formatType === 'weekly-brief' || normalizedTemplateName === 'signal radar' || normalizedTemplateName === 'analyst board');
      const isStrategicLetterTemplate =
        isNewsletterTemplate &&
        (formatType === 'strategic-letter' || normalizedTemplateName === 'strategy memo' || normalizedTemplateName === 'market map');
      const isActionLetterTemplate =
        isNewsletterTemplate &&
        (formatType === 'action-letter' || normalizedTemplateName === 'operator playbook' || normalizedTemplateName === 'sprint sheet');

      const templateSystemPrompt = buildTemplateAwareSystemPromptV2(targetWc ?? 1200, contentType, template_blocks, template_name);
      const templateUserPrompt = buildTemplateAwareUserPrompt(generationInput, template_blocks);

      const parseTemplateResult = (rawOutput: string | null | undefined) => {
        let parsedRaw: any = null;
        try {
          let rawText = rawOutput || '';
          rawText = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
          parsedRaw = JSON.parse(rawText);
        } catch (jsonErr) {
          console.error('[template-gen] JSON parse failed:', jsonErr, 'raw output (first 500 chars):', rawOutput?.substring(0, 500));
        }

        return {
          raw: parsedRaw,
          parsed: parsedRaw ? parseTemplateOutput(parsedRaw, template_blocks) : null,
          blockCount: Array.isArray(parsedRaw?.blocks)
            ? parsedRaw.blocks.length
            : Array.isArray(parsedRaw?.template_blocks)
            ? parsedRaw.template_blocks.length
            : Array.isArray(parsedRaw?.filled_blocks)
            ? parsedRaw.filled_blocks.length
            : Array.isArray(parsedRaw?.content_blocks)
            ? parsedRaw.content_blocks.length
            : Array.isArray(parsedRaw?.content)
            ? parsedRaw.content.length
            : null,
        };
      };

      const tplResult = await runCompletionWithOperation({
        operation:       'blogGeneration',
        companyId:       company_id,
        model:           'gpt-4o',
        temperature:     0.5,
        response_format: { type: 'json_object' },
        max_tokens:      maxTokens,
        messages: [
          { role: 'system', content: templateSystemPrompt },
          { role: 'user',   content: templateUserPrompt },
        ],
      });

      let { raw: tplRaw, parsed: tplParsed, blockCount: tplBlockCount } = parseTemplateResult(tplResult.output);

      if (!tplParsed) {
        console.error('[template-gen] parseTemplateOutput returned null. AI keys:', tplRaw ? Object.keys(tplRaw) : 'null',
          'blocks type:', tplRaw?.blocks ? typeof tplRaw.blocks : 'missing',
          'blocks length:', Array.isArray(tplRaw?.blocks) ? tplRaw.blocks.length : 'N/A',
          'template length:', template_blocks.length);
      }

      if (targetWc && targetWc >= 300) {
        const minAcceptable = Math.round(targetWc * 0.85);
        const templateLength = template_blocks.length;
        const retryMaxTokens = Math.min(16384, Math.max(maxTokens, Math.round(targetWc * 6)));
        let bestRaw = tplRaw;
        let bestParsed = tplParsed;
        let bestBlockCount = tplBlockCount;
        let bestAnalysis = tplParsed ? analyzeTemplateContentBlocks(tplParsed.content_blocks) : null;

        const candidateScore = (
          analysis: typeof bestAnalysis,
          blockCount: number | null,
        ): number => {
          if (!analysis) return -100000;
          return (
            analysis.wordCount
            + analysis.averageParagraphWords * 3
            - analysis.substantiveEmptyBlocks * 350
            - analysis.thinParagraphs * 120
            - analysis.thinSummaries * 100
            - analysis.weakKeyInsights * 80
            - analysis.weakLists * 90
            - analysis.thinListItems * 12
            - analysis.thinCallouts * 70
            - analysis.thinQuotes * 50
            - analysis.weakReferences * 40
            - (blockCount !== templateLength ? Math.abs((blockCount ?? 0) - templateLength) * 250 : 0)
          );
        };

        const needsRetry = (analysis: typeof bestAnalysis, blockCount: number | null): boolean => {
          if (
            !analysis ||
            analysis.wordCount < minAcceptable ||
            analysis.substantiveEmptyBlocks > 0 ||
            analysis.thinParagraphs > 0 ||
            analysis.thinSummaries > 0 ||
            analysis.weakKeyInsights > 0 ||
            analysis.weakLists > 0 ||
            analysis.thinCallouts > 0 ||
            blockCount !== templateLength
          ) {
            return true;
          }

          if (isNewsletterTemplate) {
            if (analysis.emptyKeyInsights > 0 || analysis.emptySummaries > 0) return true;
            if (analysis.averageParagraphWords < (targetWc >= 1600 ? 80 : 68)) return true;
          }

          if (isInsightLetterTemplate) {
            if (analysis.averageParagraphWords < (targetWc >= 1600 ? 95 : 80)) return true;
            if (analysis.thinQuotes > 0 || analysis.emptyQuotes > 0) return true;
            if (analysis.paragraphCount < 6) return true;
            if (analysis.thinSummaries > 0 || analysis.emptySummaries > 0) return true;
          }

          if (isMinimalThesisTemplate) {
            if (analysis.wordCount < Math.round(targetWc * 0.9)) return true;
            if (analysis.averageParagraphWords < (targetWc >= 1600 ? 105 : 92)) return true;
            if (analysis.thinParagraphs > (targetWc >= 1600 ? 0 : 1)) return true;
            if (analysis.emptyCallouts > 0 || analysis.thinCallouts > 0) return true;
            if (analysis.thinQuotes > 0 || analysis.emptyQuotes > 0) return true;
            if (analysis.weakKeyInsights > 0 || analysis.emptyKeyInsights > 0) return true;
            if (analysis.paragraphCount < (targetWc >= 1600 ? 9 : 8)) return true;
          }

          if (isSplitScreenInsightTemplate) {
            if (analysis.emptyCallouts > 0 || analysis.thinCallouts > 0) return true;
            if (analysis.thinQuotes > 0 || analysis.emptyQuotes > 0) return true;
            if (analysis.averageParagraphWords < (targetWc >= 1600 ? 92 : 78)) return true;
            if (analysis.paragraphCount < 7) return true;
          }

          if (isWeeklyBriefTemplate) {
            if (analysis.weakReferences > 0) return true;
            if (analysis.thinListItems > 0) return true;
            if (analysis.paragraphCount < 5) return true;
          }

          if (isStrategicLetterTemplate) {
            if (analysis.weakReferences > 0) return true;
            if (analysis.averageParagraphWords < (targetWc >= 1600 ? 90 : 75)) return true;
            if (analysis.paragraphCount < 6) return true;
          }

          if (isActionLetterTemplate) {
            if (analysis.weakReferences > 0) return true;
            if (analysis.weakLists > 0 || analysis.thinListItems > 0) return true;
            if (analysis.paragraphCount < 5) return true;
          }

          return false;
        };

        if (needsRetry(bestAnalysis, bestBlockCount)) {
          try {
            for (const retryInstruction of [
              'Regenerate the COMPLETE template from scratch with full body depth in every substantive block.',
              'This is a second rejection. Return a fully written article, not a skeleton. Every paragraph block must contain real multi-paragraph content.',
            ]) {
              const retryIssues: string[] = [];
              if (!bestAnalysis) {
                retryIssues.push('template JSON could not be parsed into valid filled blocks');
              } else {
                if (bestAnalysis.wordCount < minAcceptable) retryIssues.push(`word count too low (${bestAnalysis.wordCount} words, minimum ${minAcceptable})`);
                if (bestAnalysis.emptyParagraphs > 0) retryIssues.push(`${bestAnalysis.emptyParagraphs} empty paragraph block(s)`);
                if (bestAnalysis.thinParagraphs > 0) retryIssues.push(`${bestAnalysis.thinParagraphs} thin paragraph block(s) under 70 words`);
                if (bestAnalysis.emptyHeadings > 0) retryIssues.push(`${bestAnalysis.emptyHeadings} empty heading block(s)`);
                if (bestAnalysis.emptySummaries > 0) retryIssues.push(`${bestAnalysis.emptySummaries} empty summary block(s)`);
                if (bestAnalysis.thinSummaries > 0) retryIssues.push(`${bestAnalysis.thinSummaries} thin summary block(s)`);
                if (bestAnalysis.emptyKeyInsights > 0) retryIssues.push(`${bestAnalysis.emptyKeyInsights} empty key-insight block(s)`);
                if (bestAnalysis.weakKeyInsights > 0) retryIssues.push(`${bestAnalysis.weakKeyInsights} weak key-insight block(s)`);
                if (bestAnalysis.emptyLists > 0) retryIssues.push(`${bestAnalysis.emptyLists} empty list block(s)`);
                if (bestAnalysis.weakLists > 0) retryIssues.push(`${bestAnalysis.weakLists} weak list block(s)`);
                if (bestAnalysis.thinListItems > 0) retryIssues.push(`${bestAnalysis.thinListItems} thin list item(s)`);
                if (bestAnalysis.emptyCallouts > 0) retryIssues.push(`${bestAnalysis.emptyCallouts} empty callout block(s)`);
                if (bestAnalysis.thinCallouts > 0) retryIssues.push(`${bestAnalysis.thinCallouts} thin callout block(s)`);
                if (bestAnalysis.emptyQuotes > 0) retryIssues.push(`${bestAnalysis.emptyQuotes} empty quote block(s)`);
                if (bestAnalysis.thinQuotes > 0) retryIssues.push(`${bestAnalysis.thinQuotes} thin quote block(s)`);
                if (bestAnalysis.weakReferences > 0) retryIssues.push(`${bestAnalysis.weakReferences} weak reference block(s)`);
                if (isNewsletterTemplate && bestAnalysis.emptyKeyInsights > 0) {
                  retryIssues.push('newsletter key insights block is still missing or empty');
                }
                if (isNewsletterTemplate && bestAnalysis.emptySummaries > 0) {
                  retryIssues.push('newsletter summary block is still missing or empty');
                }
                if (isInsightLetterTemplate && bestAnalysis.averageParagraphWords < (targetWc >= 1600 ? 95 : 80)) {
                  retryIssues.push(`newsletter reasoning is too thin on average (${bestAnalysis.averageParagraphWords} words per paragraph block)`);
                }
                if (isMinimalThesisTemplate && bestAnalysis.averageParagraphWords < (targetWc >= 1600 ? 105 : 92)) {
                  retryIssues.push('minimal thesis still reads too thin for a true idea-led letter');
                }
                if (isMinimalThesisTemplate && bestAnalysis.wordCount < Math.round(targetWc * 0.9)) {
                  retryIssues.push(`minimal thesis is still too short for its target (${bestAnalysis.wordCount} words for a ${targetWc}-word brief)`);
                }
                if (isMinimalThesisTemplate && (bestAnalysis.emptyCallouts > 0 || bestAnalysis.thinCallouts > 0)) {
                  retryIssues.push('minimal thesis still lacks a strong thesis or practical-shift callout');
                }
                if (isMinimalThesisTemplate && (bestAnalysis.emptyQuotes > 0 || bestAnalysis.thinQuotes > 0)) {
                  retryIssues.push('minimal thesis still lacks a strong extractable quote line');
                }
                if (isMinimalThesisTemplate && (bestAnalysis.weakKeyInsights > 0 || bestAnalysis.emptyKeyInsights > 0)) {
                  retryIssues.push('minimal thesis still lacks a dense key insights block with enough standalone takeaways');
                }
                if (isMinimalThesisTemplate && bestAnalysis.paragraphCount < (targetWc >= 1600 ? 9 : 8)) {
                  retryIssues.push('minimal thesis still lacks enough body paragraphs to feel like a complete insight letter');
                }
                if (isSplitScreenInsightTemplate && (bestAnalysis.emptyCallouts > 0 || bestAnalysis.thinCallouts > 0)) {
                  retryIssues.push('split-screen insight still lacks a strong framing callout');
                }
                if (isSplitScreenInsightTemplate && (bestAnalysis.emptyQuotes > 0 || bestAnalysis.thinQuotes > 0)) {
                  retryIssues.push('split-screen insight still lacks a strong extractable quote line');
                }
                if (isSplitScreenInsightTemplate && bestAnalysis.paragraphCount < 7) {
                  retryIssues.push('split-screen insight still lacks enough body depth across its sections');
                }
                if (isWeeklyBriefTemplate && bestAnalysis.weakReferences > 0) {
                  retryIssues.push('weekly brief still lacks grounded references or cited signals');
                }
                if (isStrategicLetterTemplate && bestAnalysis.weakReferences > 0) {
                  retryIssues.push('strategic letter still lacks enough evidence, signals, or references');
                }
                if (isActionLetterTemplate && bestAnalysis.weakReferences > 0) {
                  retryIssues.push('action letter still lacks enough supporting references, tools, or resources');
                }
              }
              if (bestBlockCount !== templateLength) {
                retryIssues.push(`blocks array length mismatch (${bestBlockCount ?? 0} returned, expected ${templateLength})`);
              }

              const retryResult = await runCompletionWithOperation({
                operation:       'blogGeneration',
                companyId:       company_id,
                model:           'gpt-4o',
                temperature:     0.45,
                response_format: { type: 'json_object' },
                max_tokens:      retryMaxTokens,
                messages: [
                  { role: 'system', content: templateSystemPrompt },
                  { role: 'user',   content: templateUserPrompt },
                  ...(bestRaw ? [{ role: 'assistant' as const, content: JSON.stringify(bestRaw) }] : []),
                  {
                    role: 'user',
                    content:
                      `REJECTED TEMPLATE FILL: ${retryIssues.join('; ')}.\n\n` +
                      `${retryInstruction}\n` +
                      `Requirements:\n` +
                      `- Reach at least ${minAcceptable} words for this ${targetWc}-word target\n` +
                      `- Return exactly ${templateLength} top-level block entries in the blocks array\n` +
                      `- Keep the exact same block order and structure\n` +
                      `- Fill every substantive block with real content, not placeholders or notes\n` +
                      `- Use multiple <p> tags inside paragraph blocks whenever needed to create real section depth\n` +
                      `- For columns blocks, fill each nested block inside every column\n` +
                      `- Add concrete examples, reasoning, practical implications, and action-ready detail instead of filler\n` +
                      (isNewsletterTemplate
                        ? `- Keep the newsletter fully extractable with filled Key Insights and Summary blocks, plus references wherever the format benefits from authority grounding\n`
                        : '') +
                      (isInsightLetterTemplate
                        ? `- For this insight letter, sharpen the thesis with first-principles reasoning, one reusable mental model, one grounded example or pattern, and a quotable synthesis\n`
                        : '') +
                      (isMinimalThesisTemplate
                        ? `- For Minimal Thesis, make every major paragraph denser and more idea-led. The Hook, Insight, Expansion, and Implication sections should each feel complete on their own\n- Keep the insight-letter structure visibly intact and fill both the thesis callout and the practical-shift callout with extractable standalone value\n`
                        : '') +
                      (isSplitScreenInsightTemplate
                        ? `- For Split-Screen Insight, make the surface story and deeper reality contrast unmistakably clear, and make the framing callout, quote, and summary highly extractable for GEO and AI answers\n- Add one grounded example or observed pattern that proves the deeper reality, so the body reads as a full argument rather than a thin contrast\n`
                        : '') +
                      (isInsightLetterTemplate
                        ? `- Ensure the finished draft clearly fulfills Hook, Context, Insight, Expansion, Implication, and Closing with real substance in each section\n`
                        : '') +
                      (templateDepthGuidance
                        ? `- ${templateDepthGuidance.retryFocus.join('\n- ')}\n`
                        : '') +
                      `Return the same JSON format only.`,
                  },
                ],
              });

              const retryState = parseTemplateResult(retryResult.output);
              const retryAnalysis = retryState.parsed ? analyzeTemplateContentBlocks(retryState.parsed.content_blocks) : null;
              if (candidateScore(retryAnalysis, retryState.blockCount) > candidateScore(bestAnalysis, bestBlockCount)) {
                bestRaw = retryState.raw;
                bestParsed = retryState.parsed;
                bestBlockCount = retryState.blockCount;
                bestAnalysis = retryAnalysis;
              }

              if (!needsRetry(bestAnalysis, bestBlockCount)) break;
            }
          } catch {
            // Best-effort retry only.
          }
        }

        tplRaw = bestRaw;
        tplParsed = bestParsed;
        tplBlockCount = bestBlockCount;
      }

      if (tplParsed) {
        // Inject internal links
        let content_blocks = await injectInternalLinks(
          tplParsed.content_blocks,
          topic.trim(),
          company_id,
          blogTable,
          [tplParsed.title],
        );

        const result: BlogGenerationOutput & { content_blocks: unknown[] } = {
          title:                tplParsed.title,
          excerpt:              tplParsed.excerpt,
          content_html:         '', // not used for template path
          tags:                 tplParsed.tags,
          category:             tplParsed.category,
          seo_meta_title:       tplParsed.seo_meta_title,
          seo_meta_description: tplParsed.seo_meta_description,
          key_insights:         tplParsed.key_insights,
          content_blocks,
        };

        let hook_assessment: HookAssessment = { strength: 'moderate', note: '' };
        try {
          const firstPara = content_blocks.find((b: any) => b.type === 'paragraph');
          if (firstPara && 'html' in firstPara) {
            hook_assessment = await checkHookStrength(firstPara.html as string, company_id);
          }
        } catch {}

        return {
          needs_clarification: false,
          mode:                'full',
          confidence,
          result,
          hook_assessment,
          template_used:       true,
          seo_intelligence:    ctx.seo ?? undefined,
          trend_intelligence:  ctx.trends ?? undefined,
        };
      }
      // If template parsing failed, fall through to standard generation
      console.warn('[template-gen] Template path failed — falling through to standard HTML generation');
    }

    const aiResult = await runCompletionWithOperation({
      operation:       'blogGeneration',
      companyId:       company_id,
      model:           'gpt-4o',
      temperature:     0.5,
      response_format: { type: 'json_object' },
      max_tokens:      maxTokens,
      messages: [
        { role: 'system', content: buildGenerationSystemPrompt(targetWc, contentType, formatType) },
        { role: 'user',   content: buildGenerationUserPrompt(generationInput) },
      ],
    });

    const raw       = aiResult.output ? JSON.parse(aiResult.output) : null;
    let generated = validateGenerationOutput(raw) ?? buildGenerationFallback(generationInput);

    // ── Word count/depth enforcement: retry once if the article is too short
    // or, for Classic, if it still reads too thin despite hitting length. ─────
    if (targetWc && targetWc >= 300) {
      const htmlText = generated.content_html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const actualWords = htmlText.split(/\s+/).filter(Boolean).length;
      const minAcceptable = Math.round(targetWc * 0.85);
      const isClassicTemplate = typeof template_name === 'string' && template_name.trim().toLowerCase() === 'classic';
      const initialBlocks = htmlToBlocks(generated.content_html);
      const flatBlocks = flattenBlocks(initialBlocks);
      const paragraphWordCounts = flatBlocks
        .filter((block): block is Extract<typeof block, { type: 'paragraph' }> => block.type === 'paragraph')
        .map((block) => stripHtmlForWordCount(block.html).split(/\s+/).filter(Boolean).length)
        .filter((count) => count > 0);
      const shortParagraphs = paragraphWordCounts.filter((count) => count < 55).length;
      const avgParagraphWords = paragraphWordCounts.length
        ? Math.round(paragraphWordCounts.reduce((sum, count) => sum + count, 0) / paragraphWordCounts.length)
        : 0;
      const h2Count = flatBlocks.filter((block) => block.type === 'heading' && block.level === 2 && block.text.trim().length > 0).length;
      const classicDepthWeak =
        isClassicTemplate && (
          (targetWc >= 2000 && (avgParagraphWords < 95 || shortParagraphs >= 3 || h2Count < 5)) ||
          (targetWc >= 1600 && targetWc < 2000 && (avgParagraphWords < 85 || shortParagraphs >= 3 || h2Count < 4)) ||
          (targetWc >= 1200 && targetWc < 1600 && (avgParagraphWords < 75 || shortParagraphs >= 2 || h2Count < 4)) ||
          (targetWc < 1200 && (avgParagraphWords < 65 || shortParagraphs >= 2 || h2Count < 3))
        );

      if (actualWords < minAcceptable || classicDepthWeak) {
        try {
          const retryReason = actualWords < minAcceptable
            ? `Your article is only ${actualWords} words but the target is ${targetWc} words (minimum ${minAcceptable}). This is ${Math.round((actualWords / targetWc) * 100)}% of the required length.`
            : `Your article reaches ${actualWords} words, but the depth is still too thin for Classic. Average paragraph length is ${avgParagraphWords} words, there are ${shortParagraphs} thin paragraph(s), and only ${h2Count} H2 section(s).`;
          const retryResult = await runCompletionWithOperation({
            operation:       'blogGeneration',
            companyId:       company_id,
            model:           'gpt-4o',
            temperature:     0.6,
            response_format: { type: 'json_object' },
            max_tokens:      maxTokens,
            messages: [
              { role: 'system', content: buildGenerationSystemPrompt(targetWc, contentType, formatType) },
              { role: 'user',   content: buildGenerationUserPrompt(generationInput) },
              { role: 'assistant', content: aiResult.output ?? '' },
              { role: 'user', content: `REJECTED: ${retryReason}\n\nRegenerate the COMPLETE article from scratch with:\n- ${targetWc} words minimum\n- Each H2 section must have 3–5 full paragraphs (60–120 words per paragraph)\n- Use concrete examples, data, practitioner implications, and actionable analysis to fill each section\n- Make every major section feel complete, not merely adequate\n- Do NOT pad with filler — add genuine depth and detail\n- Do NOT create more than 6 H2 sections — make each section deeper instead of adding more thin sections\n- End each H2 section with a clear takeaway sentence\n\nReturn the same JSON format. The full article must be ${targetWc}+ words and substantively deeper.` },
            ],
          });
          const retryRaw = retryResult.output ? JSON.parse(retryResult.output) : null;
          const retryGen = retryRaw ? validateGenerationOutput(retryRaw) : null;
          if (retryGen) {
            const retryText = retryGen.content_html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            const retryWords = retryText.split(/\s+/).filter(Boolean).length;
            const retryBlocks = htmlToBlocks(retryGen.content_html);
            const retryFlatBlocks = flattenBlocks(retryBlocks);
            const retryParagraphWordCounts = retryFlatBlocks
              .filter((block): block is Extract<typeof block, { type: 'paragraph' }> => block.type === 'paragraph')
              .map((block) => stripHtmlForWordCount(block.html).split(/\s+/).filter(Boolean).length)
              .filter((count) => count > 0);
            const retryShortParagraphs = retryParagraphWordCounts.filter((count) => count < 55).length;
            const retryAvgParagraphWords = retryParagraphWordCounts.length
              ? Math.round(retryParagraphWordCounts.reduce((sum, count) => sum + count, 0) / retryParagraphWordCounts.length)
              : 0;
            const retryH2Count = retryFlatBlocks.filter((block) => block.type === 'heading' && block.level === 2 && block.text.trim().length > 0).length;
            const currentDepthScore = actualWords + avgParagraphWords * 4 + h2Count * 40 - shortParagraphs * 80;
            const retryDepthScore = retryWords + retryAvgParagraphWords * 4 + retryH2Count * 40 - retryShortParagraphs * 80;
            if (retryDepthScore > currentDepthScore) {
              generated = retryGen;
            }
          }
        } catch { /* retry is best-effort — use original if it fails */ }
      }
    }

    let content_blocks = htmlToBlocks(generated.content_html);

    // Inject internal links (2+ related published blogs as link cards)
    content_blocks = await injectInternalLinks(
      content_blocks,
      topic.trim(),
      company_id,
      blogTable,
      [generated.title], // exclude the blog being generated
    );

    const result: BlogGenerationOutput & { content_blocks: unknown[] } = {
      ...generated,
      content_blocks,
    };

    // Hook strength check — non-blocking, failure returns moderate default
    let hook_assessment: HookAssessment = { strength: 'moderate', note: '' };
    try {
      const firstPara = extractFirstParagraph(generated.content_html);
      hook_assessment = await checkHookStrength(firstPara, company_id);
    } catch { /* keep default */ }

    return {
      needs_clarification: false,
      mode:                'full',
      confidence,
      result,
      hook_assessment,
      seo_intelligence:    ctx.seo ?? undefined,
      trend_intelligence:  ctx.trends ?? undefined,
    };

  } catch {
    const fallback       = buildGenerationFallback(generationInput);
    let content_blocks = htmlToBlocks(fallback.content_html);

    // Best-effort internal links even on fallback
    content_blocks = await injectInternalLinks(
      content_blocks,
      topic.trim(),
      company_id,
      blogTable,
    );

    return {
      needs_clarification: false,
      mode:                'full',
      confidence:          'medium',
      result:              { ...fallback, content_blocks },
      hook_assessment:     { strength: 'moderate', note: 'Review before publishing.' },
    };
  }
}
