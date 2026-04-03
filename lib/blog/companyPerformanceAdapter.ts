/**
 * Company Performance Adapter
 *
 * Reads raw company blog data from:
 *   - `blogs`                             — post metadata, views, likes
 *   - `company_blog_performance_summary`  — session, scroll, time, completion
 *
 * Normalizes the result into PostPerformance[] — the exact input type
 * required by performanceEngine.ts.
 *
 * performanceEngine is NOT modified. This adapter is the boundary layer.
 * It absorbs all schema differences between public_blogs and blogs.
 *
 * Usage:
 *   const posts = await fetchCompanyPostPerformance(companyId);
 *   const metrics = computeAllMetrics(posts, seriesPostIds);
 */

import { supabase } from '../../backend/db/supabaseClient';
import type { PostPerformance } from './performanceEngine';

// ── Raw DB row types ──────────────────────────────────────────────────────────
// Nullable numeric fields: DB columns have DEFAULT 0 but SELECT does not
// guarantee NOT NULL at the TypeScript boundary — widened to `number | null`.

interface BlogRow {
  id:             string;
  title:          string;
  slug:           string | null;
  category:       string | null;
  tags:           string[] | null;
  status:         string;
  views_count:    number | null;   // DEFAULT 0, but nullable at TS boundary
  likes_count:    number | null;   // DEFAULT 0, added in 20260330_blogs_likes_count.sql
  content_blocks: unknown[] | null;
  published_at:   string | null;
}

interface PerfSummaryRow {
  blog_id:          string;
  company_id:       string;
  // Aggregate view functions return numeric | null when there are no rows.
  session_count:    number | null;
  avg_time_seconds: number | null;
  avg_scroll_depth: number | null;
  completion_rate:  number | null;
}

// ── Block analysis ────────────────────────────────────────────────────────────
// Mirrors the annotation logic in pages/api/admin/blog/intelligence.ts
// for public_blogs. No external dependencies.

interface BlockAnalysis {
  has_summary:      boolean;
  internal_links:   number;
  references_count: number;
}

function analyzeBlocks(blocks: unknown[] | null): BlockAnalysis {
  if (!Array.isArray(blocks)) {
    return { has_summary: false, internal_links: 0, references_count: 0 };
  }

  let has_summary      = false;
  let internal_links   = 0;
  let references_count = 0;

  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;

    if (
      b['type'] === 'summary' &&
      typeof b['body'] === 'string' &&
      (b['body'] as string).trim().length > 0
    ) {
      has_summary = true;
    }

    if (
      b['type'] === 'internal_link' &&
      typeof b['slug'] === 'string' &&
      (b['slug'] as string).trim().length > 0
    ) {
      internal_links++;
    }

    if (b['type'] === 'references' && Array.isArray(b['items'])) {
      references_count = (b['items'] as unknown[]).filter((r: unknown): boolean => {
        if (!r || typeof r !== 'object') return false;
        const ri = r as Record<string, unknown>;
        return (
          (typeof ri['title'] === 'string' && (ri['title'] as string).trim().length > 0) ||
          (typeof ri['url']   === 'string' && (ri['url']   as string).trim().length > 0)
        );
      }).length;
    }
  }

  return { has_summary, internal_links, references_count };
}

// ── Perf defaults ─────────────────────────────────────────────────────────────

const ZERO_PERF: Readonly<{
  session_count:    number;
  avg_time_seconds: number;
  avg_scroll_depth: number;
  completion_rate:  number;
}> = {
  session_count:    0,
  avg_time_seconds: 0,
  avg_scroll_depth: 0,
  completion_rate:  0,
};

function normalizePerfRow(row: PerfSummaryRow | undefined): typeof ZERO_PERF {
  if (!row) return ZERO_PERF;
  return {
    session_count:    Number(row.session_count)    || 0,
    avg_time_seconds: Number(row.avg_time_seconds) || 0,
    avg_scroll_depth: Number(row.avg_scroll_depth) || 0,
    completion_rate:  Number(row.completion_rate)  || 0,
  };
}

// ── Main adapter function ─────────────────────────────────────────────────────

/**
 * Fetches and normalizes all blog posts for a company into PostPerformance[].
 * Returns an empty array if the company has no posts or on DB error.
 *
 * Scoped strictly to company_id — no cross-company data leakage possible.
 * Output type is verified at compile time via `satisfies PostPerformance`.
 */
export async function fetchCompanyPostPerformance(
  companyId: string,
): Promise<PostPerformance[]> {

  // ── 1. Fetch blog rows ──────────────────────────────────────────────────────
  const { data: blogRows, error: blogErr } = await supabase
    .from('blogs')
    .select(
      'id, title, slug, category, tags, status, views_count, likes_count, content_blocks, published_at',
    )
    .eq('company_id', companyId);

  if (blogErr || !blogRows || blogRows.length === 0) return [];

  // ── 2. Fetch performance summary rows ───────────────────────────────────────
  const blogIds = (blogRows as BlogRow[]).map(b => b.id);

  const { data: perfRows } = await supabase
    .from('company_blog_performance_summary')
    .select(
      'blog_id, company_id, session_count, avg_time_seconds, avg_scroll_depth, completion_rate',
    )
    .eq('company_id', companyId)
    .in('blog_id', blogIds);

  // Index perf data by blog_id for O(1) lookup
  const perfMap = new Map<string, PerfSummaryRow>();
  for (const row of (perfRows ?? []) as PerfSummaryRow[]) {
    perfMap.set(row.blog_id, row);
  }

  // ── 3. Normalize into PostPerformance[] ────────────────────────────────────
  return (blogRows as BlogRow[]).map((blog): PostPerformance => {
    const perf = normalizePerfRow(perfMap.get(blog.id));
    const { has_summary, internal_links, references_count } = analyzeBlocks(blog.content_blocks);

    // Compile-time check: the object literal must satisfy PostPerformance exactly.
    // If performanceEngine.ts adds or renames a field, this will fail to compile.
    const post = {
      id:               blog.id,
      title:            blog.title,
      slug:             blog.slug            ?? '',
      category:         blog.category        ?? null,
      tags:             Array.isArray(blog.tags) ? blog.tags : [],
      status:           blog.status,
      views_count:      blog.views_count     ?? 0,
      likes_count:      blog.likes_count     ?? 0,
      // Company blogs have no comments system.
      // Field is required by PostPerformance interface — set to 0.
      comments_count:   0,
      session_count:    perf.session_count,
      avg_time_seconds: perf.avg_time_seconds,
      avg_scroll_depth: perf.avg_scroll_depth,
      completion_rate:  perf.completion_rate,
      has_summary,
      internal_links,
      references_count,
      published_at:     blog.published_at    ?? null,
    } satisfies PostPerformance;

    return post;
  });
}

/**
 * Fetches the set of blog IDs that belong to at least one company series.
 * Used by computeAllMetrics(posts, seriesPostIds) for visibility scoring.
 */
export async function fetchCompanySeriesPostIds(companyId: string): Promise<Set<string>> {
  const { data } = await supabase
    .from('company_blog_series_posts')
    .select('blog_id, company_blog_series!inner(company_id)')
    .eq('company_blog_series.company_id', companyId);

  const ids = new Set<string>();
  for (const row of (data ?? []) as Array<{ blog_id: string }>) {
    ids.add(row.blog_id);
  }
  return ids;
}
