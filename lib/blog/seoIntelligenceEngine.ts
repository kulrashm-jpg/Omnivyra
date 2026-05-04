/**
 * SEO Intelligence Engine
 *
 * Lightweight, zero-external-API keyword intelligence that runs BEFORE blog generation.
 * Extracts a primary keyword phrase from the topic, gathers secondary keywords from
 * existing published blogs, checks for title cannibalization, and builds a prompt
 * fragment for injection into the generation prompt.
 *
 * Constraints:
 *   - No external API calls — uses existing blog data only
 *   - Must run fast (< 100ms for keyword extraction, DB call adds latency)
 *   - Must not block generation if it fails (caller wraps in try/catch)
 *   - Max 5 secondary keywords, no duplicates
 */

import { createServiceRoleMigrationProxy } from '../../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');

// ── Stopwords (shared pattern with injectInternalLinks in runBlogGeneration) ──

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'her',
  'was', 'one', 'our', 'out', 'has', 'have', 'from', 'with', 'they',
  'been', 'this', 'that', 'will', 'each', 'make', 'like', 'into',
  'them', 'than', 'its', 'over', 'such', 'what', 'how', 'why', 'most',
  'about', 'which', 'when', 'your', 'does', 'more', 'just', 'also',
  'very', 'some', 'only', 'many', 'much', 'best', 'good', 'way',
  'use', 'using', 'used', 'get', 'got', 'new', 'know',
]);

// ── Types ────────────────────────────────────────────────────────────────────

export interface SEOIntelligenceResult {
  /** 2-4 word keyword phrase extracted from the topic */
  primary_keyword:        string;
  /** Up to 5 related keywords from existing published blog tags/titles */
  secondary_keywords:     string[];
  /** Warnings (e.g. cannibalization risk) */
  keyword_warnings:       string[];
  /** Pre-formatted prompt fragment for injection into generation prompt */
  keyword_context_prompt: string;
}

export interface SEOIntelligenceInput {
  topic:          string;
  companyId:      string;
  blogTable:      'blogs' | 'public_blogs';
  /** Existing blog data — injectable for testing. Defaults to supabase fetch. */
  fetchExistingBlogs?: FetchExistingBlogsFn;
}

export interface ExistingBlogSummary {
  title: string;
  tags:  string[];
}

export type FetchExistingBlogsFn = (
  companyId: string,
  blogTable: 'blogs' | 'public_blogs',
) => Promise<ExistingBlogSummary[]>;

// ── Keyword extraction ───────────────────────────────────────────────────────

/**
 * Extracts a 2-4 word primary keyword phrase from the topic.
 * Removes stopwords, lowercases, and takes the first 2-4 meaningful words.
 */
export function extractPrimaryKeyword(topic: string): string {
  const words = topic
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOP_WORDS.has(w));

  if (words.length === 0) return topic.toLowerCase().trim().slice(0, 60);

  // Take 2-4 words — this gives a focused keyword phrase
  return words.slice(0, Math.min(4, Math.max(2, words.length))).join(' ');
}

/**
 * Extracts related keywords from tags and titles of existing published blogs.
 * Returns up to 5 unique keywords (excluding the primary keyword words).
 */
export function getRelatedKeywords(
  existingBlogs: ExistingBlogSummary[],
  primaryKeyword: string,
): string[] {
  const primaryWords = new Set(primaryKeyword.split(/\s+/));
  const keywordCounts = new Map<string, number>();

  for (const blog of existingBlogs) {
    // Extract from tags
    for (const tag of blog.tags) {
      const normalized = tag.toLowerCase().trim();
      if (normalized && !primaryWords.has(normalized) && !STOP_WORDS.has(normalized)) {
        keywordCounts.set(normalized, (keywordCounts.get(normalized) ?? 0) + 1);
      }
    }

    // Extract meaningful words from titles
    const titleWords = blog.title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 4 && !STOP_WORDS.has(w) && !primaryWords.has(w));

    for (const w of titleWords) {
      keywordCounts.set(w, (keywordCounts.get(w) ?? 0) + 1);
    }
  }

  // Sort by frequency (most common first), take top 5
  return Array.from(keywordCounts.entries())
    .filter(([, count]) => count >= 2) // must appear in at least 2 blogs
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([kw]) => kw);
}

/**
 * Simple word-overlap similarity between two strings.
 * Returns a ratio 0.0–1.0 of shared meaningful words / total unique meaningful words.
 */
function wordOverlapSimilarity(a: string, b: string): number {
  const wordsA = new Set(
    a.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter(w => w.length >= 3 && !STOP_WORDS.has(w))
  );
  const wordsB = new Set(
    b.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter(w => w.length >= 3 && !STOP_WORDS.has(w))
  );

  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let overlap = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap++;
  }

  const union = new Set([...wordsA, ...wordsB]).size;
  return union > 0 ? overlap / union : 0;
}

/**
 * Checks existing blog titles for cannibalization risk (similarity > 0.5).
 * Returns warning strings for each match.
 */
export function checkCannibalization(
  topic: string,
  existingBlogs: ExistingBlogSummary[],
): string[] {
  const warnings: string[] = [];

  for (const blog of existingBlogs) {
    const sim = wordOverlapSimilarity(blog.title, topic);
    if (sim > 0.5) {
      warnings.push(
        `Cannibalization risk: "${blog.title}" has ${Math.round(sim * 100)}% keyword overlap — differentiate your angle`
      );
    }
  }

  return warnings;
}

// ── Default data-access ──────────────────────────────────────────────────────

async function defaultFetchExistingBlogs(
  companyId: string,
  blogTable: 'blogs' | 'public_blogs',
): Promise<ExistingBlogSummary[]> {
  const query = supabase
    .from(blogTable)
    .select('title, tags')
    .eq('status', 'published')
    .not('title', 'is', null);

  if (blogTable === 'blogs') {
    query.eq('company_id', companyId);
  }

  const { data } = await query.limit(100);
  if (!data || data.length === 0) return [];

  return (data as Array<{ title: string; tags: unknown }>).map(b => ({
    title: b.title,
    tags:  Array.isArray(b.tags) ? b.tags.filter((t: unknown) => typeof t === 'string') as string[] : [],
  }));
}

// ── Build prompt fragment ────────────────────────────────────────────────────

function buildKeywordContextPrompt(
  primary: string,
  secondary: string[],
  warnings: string[],
): string {
  const lines: string[] = [
    '## KEYWORD TARGETING (SEO Intelligence)',
    `Primary keyword: "${primary}"`,
    '- Use the primary keyword naturally in: the title, first paragraph, at least 2 H2 headings, meta title, and meta description',
    '- Do NOT keyword-stuff — use it where it reads naturally',
  ];

  if (secondary.length > 0) {
    lines.push(`Secondary keywords: ${secondary.map(k => `"${k}"`).join(', ')}`);
    lines.push('- Weave 2-3 secondary keywords into the body where relevant');
  }

  if (warnings.length > 0) {
    lines.push('');
    lines.push('DIFFERENTIATION WARNINGS:');
    for (const w of warnings) {
      lines.push(`- ${w}`);
    }
    lines.push('- Ensure this article has a UNIQUE angle, title, and opening that does not duplicate existing coverage');
  }

  return lines.join('\n');
}

// ── Main function ────────────────────────────────────────────────────────────

export async function getSEOIntelligence(
  input: SEOIntelligenceInput,
): Promise<SEOIntelligenceResult> {
  const { topic, companyId, blogTable, fetchExistingBlogs = defaultFetchExistingBlogs } = input;

  // 1. Extract primary keyword (pure CPU, instant)
  const primary_keyword = extractPrimaryKeyword(topic);

  // 2. Fetch existing blogs (single DB call)
  const existingBlogs = await fetchExistingBlogs(companyId, blogTable);

  // 3. Get related keywords from existing content
  const secondary_keywords = getRelatedKeywords(existingBlogs, primary_keyword);

  // 4. Check cannibalization
  const keyword_warnings = checkCannibalization(topic, existingBlogs);

  // 5. Build prompt fragment
  const keyword_context_prompt = buildKeywordContextPrompt(
    primary_keyword,
    secondary_keywords,
    keyword_warnings,
  );

  return {
    primary_keyword,
    secondary_keywords,
    keyword_warnings,
    keyword_context_prompt,
  };
}
