/**
 * Blog analytics surfacing — DETERMINISTIC join over data that already exists.
 *
 * Reuses the GA4 ingestion output (`canonical_page_views`) and joins it to
 * local `blogs` rows by normalized URL. No new ingestion pipeline; no warehouse.
 *
 * Match strategy (deterministic, in priority order):
 *   1. blogs.external_url (set after a successful remote publish)
 *   2. blogs.slug         → `${companyWebsite}/${slug}`
 *   3. blogs.slug         → `${companyWebsite}/blog/${slug}` (common pattern)
 *
 * All candidate URLs are normalized via `normalizeUrl` from ingestionUtils so
 * the comparison matches exactly how the ingestion service persisted page_url.
 */
import { ownedDbTable } from '../db/writeOwner';
import { normalizeUrl, resolveCompanyWebsite } from './ingestionUtils';
import { cached } from './lightCache';

const WINDOW_MS = 28 * 86_400_000;

interface BlogRow {
  id: string;
  company_id: string;
  title: string | null;
  slug: string | null;
  external_id: string | null;
  external_url: string | null;
  status: string | null;
  published_at: string | null;
}

interface PageViewAggregate {
  views: number;
  engagementMs: number;
  bySource: Map<string, number>;
}

export interface BlogAnalyticsCard {
  blogId: string;
  views28d: number;
  engagementTimeSec28d: number;
  trafficSources: Array<{ sourceMedium: string; sessions: number }>;
  matchedPageUrl: string | null;
  windowDays: number;
}

export interface TopBlogRow {
  blogId: string;
  title: string;
  slug: string | null;
  views28d: number;
  engagementTimeSec28d: number;
  externalUrl: string | null;
}

function candidateUrlsFor(blog: BlogRow, websiteBase: string | null): string[] {
  const out: string[] = [];
  const push = (raw: string | null | undefined) => {
    if (!raw) return;
    try { out.push(normalizeUrl(raw)); }
    catch { /* skip malformed */ }
  };
  if (blog.external_url) push(blog.external_url);
  if (websiteBase && blog.slug) {
    const base = websiteBase.replace(/\/+$/, '');
    push(`${base}/${blog.slug.replace(/^\/+/, '')}`);
    push(`${base}/blog/${blog.slug.replace(/^\/+/, '')}`);
  }
  // De-duplicate (normalizeUrl yields canonical strings).
  return Array.from(new Set(out));
}

async function aggregateViews(companyId: string, urls: string[], sinceIso: string): Promise<PageViewAggregate> {
  const agg: PageViewAggregate = { views: 0, engagementMs: 0, bySource: new Map() };
  if (urls.length === 0) return agg;
  try {
    const { data } = await ownedDbTable('canonical_page_views')
      .select('view_count, engagement_time_msec, view_metadata, viewed_at')
      .eq('company_id', companyId)
      .in('page_url', urls)
      .gte('viewed_at', sinceIso)
      .limit(10_000);
    for (const r of ((data ?? []) as Array<{ view_count: number | null; engagement_time_msec: number | null; view_metadata: Record<string, unknown> | null }>)) {
      agg.views += Number(r.view_count ?? 0);
      agg.engagementMs += Number(r.engagement_time_msec ?? 0);
      const md = r.view_metadata ?? {};
      const sm = String((md as Record<string, unknown>).source_medium ?? 'direct');
      agg.bySource.set(sm, (agg.bySource.get(sm) ?? 0) + Number(r.view_count ?? 0));
    }
  } catch { /* substrate temporarily unavailable */ }
  return agg;
}

export async function getBlogAnalyticsCard(companyId: string, blogId: string): Promise<BlogAnalyticsCard | null> {
  const { data: blog } = await ownedDbTable('blogs')
    .select('id, company_id, title, slug, external_id, external_url, status, published_at')
    .eq('id', blogId)
    .eq('company_id', companyId)
    .maybeSingle();
  if (!blog) return null;
  const website = await resolveCompanyWebsite(companyId).catch(() => null);
  const urls = candidateUrlsFor(blog as BlogRow, website);
  const sinceIso = new Date(Date.now() - WINDOW_MS).toISOString();
  const agg = await aggregateViews(companyId, urls, sinceIso);
  const sources = Array.from(agg.bySource.entries())
    .map(([sourceMedium, sessions]) => ({ sourceMedium, sessions }))
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 10);
  return {
    blogId: (blog as BlogRow).id,
    views28d: agg.views,
    engagementTimeSec28d: Math.round(agg.engagementMs / 1000),
    trafficSources: sources,
    matchedPageUrl: urls[0] ?? null,
    windowDays: 28,
  };
}

export async function getTopPerformingBlogs(companyId: string, limit = 10): Promise<TopBlogRow[]> {
  return cached(`blog-analytics:top:${companyId}:${limit}`, 60_000, async () =>
    getTopPerformingBlogsUncached(companyId, limit),
  );
}

async function getTopPerformingBlogsUncached(companyId: string, limit: number): Promise<TopBlogRow[]> {
  const website = await resolveCompanyWebsite(companyId).catch(() => null);
  let blogs: BlogRow[] = [];
  try {
    const { data } = await ownedDbTable('blogs')
      .select('id, company_id, title, slug, external_id, external_url, status, published_at')
      .eq('company_id', companyId)
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(200);
    blogs = (data ?? []) as BlogRow[];
  } catch { blogs = []; }
  if (blogs.length === 0) return [];

  // Build the complete candidate-URL set, then run a single ranged query.
  const allUrls = new Set<string>();
  const urlsByBlogId = new Map<string, string[]>();
  for (const b of blogs) {
    const urls = candidateUrlsFor(b, website);
    urlsByBlogId.set(b.id, urls);
    for (const u of urls) allUrls.add(u);
  }
  if (allUrls.size === 0) return [];

  const sinceIso = new Date(Date.now() - WINDOW_MS).toISOString();
  let rows: Array<{ page_url: string; view_count: number | null; engagement_time_msec: number | null }> = [];
  try {
    const { data } = await ownedDbTable('canonical_page_views')
      .select('page_url, view_count, engagement_time_msec')
      .eq('company_id', companyId)
      .in('page_url', Array.from(allUrls))
      .gte('viewed_at', sinceIso)
      .limit(50_000);
    rows = (data ?? []) as Array<{ page_url: string; view_count: number | null; engagement_time_msec: number | null }>;
  } catch { rows = []; }

  const viewsByUrl = new Map<string, { views: number; engagementMs: number }>();
  for (const r of rows) {
    const cur = viewsByUrl.get(r.page_url) ?? { views: 0, engagementMs: 0 };
    cur.views += Number(r.view_count ?? 0);
    cur.engagementMs += Number(r.engagement_time_msec ?? 0);
    viewsByUrl.set(r.page_url, cur);
  }

  const ranked: TopBlogRow[] = blogs.map((b) => {
    const urls = urlsByBlogId.get(b.id) ?? [];
    let views = 0;
    let engagementMs = 0;
    for (const u of urls) {
      const v = viewsByUrl.get(u);
      if (v) { views += v.views; engagementMs += v.engagementMs; }
    }
    return {
      blogId: b.id,
      title: b.title ?? '(untitled)',
      slug: b.slug,
      views28d: views,
      engagementTimeSec28d: Math.round(engagementMs / 1000),
      externalUrl: b.external_url,
    };
  });
  ranked.sort((a, b) => b.views28d - a.views28d);
  return ranked.slice(0, limit);
}

// ─── Summary widget (trending + traffic-source rollup + publish success rate) ──

export interface BlogAnalyticsSummary {
  companyId: string;
  generatedAt: string;
  windowDays: number;
  trending: Array<{ blogId: string; title: string; views28d: number; deltaPct14d: number }>;
  trafficSources: Array<{ sourceMedium: string; views: number }>;
  topCategories: Array<{ category: string; views: number; posts: number }>;
  publishSuccessRate: number; // 0..1 across the last 100 jobs
  publishAttempts: number;
  publishSuccesses: number;
  lastAnalyticsRefreshAt: string | null;
  lowPerformingBlogs: Array<{ blogId: string; title: string; views28d: number }>;
}

async function loadCategoryByBlogId(companyId: string): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  try {
    const { data } = await ownedDbTable('blogs')
      .select('id, category')
      .eq('company_id', companyId)
      .eq('status', 'published')
      .limit(500);
    for (const r of ((data ?? []) as Array<{ id: string; category: string | null }>)) out.set(r.id, r.category);
  } catch { /* ignore */ }
  return out;
}

async function loadLastAnalyticsRefresh(companyId: string): Promise<string | null> {
  try {
    const { data } = await ownedDbTable('analytics_properties')
      .select('last_synced_at')
      .eq('company_id', companyId)
      .order('last_synced_at', { ascending: false })
      .limit(1);
    const v = ((data ?? []) as Array<{ last_synced_at: string | null }>)[0]?.last_synced_at ?? null;
    return v;
  } catch { return null; }
}

async function loadPublishSuccessRate(companyId: string): Promise<{ attempts: number; successes: number }> {
  try {
    const { data } = await ownedDbTable('publishing_jobs')
      .select('status')
      .eq('company_id', companyId)
      .in('status', ['published', 'failed', 'dead_letter'])
      .order('updated_at', { ascending: false })
      .limit(100);
    const rows = (data ?? []) as Array<{ status: string }>;
    const successes = rows.filter((r) => r.status === 'published').length;
    return { attempts: rows.length, successes };
  } catch { return { attempts: 0, successes: 0 }; }
}

export async function buildBlogAnalyticsSummary(companyId: string): Promise<BlogAnalyticsSummary> {
  return cached(`blog-analytics:summary:${companyId}`, 60_000, async () => {
    const [top, top14, categories, lastRefresh, publishRate] = await Promise.all([
      getTopPerformingBlogs(companyId, 50),
      getTopPerformingBlogsForWindow(companyId, 14, 50),
      loadCategoryByBlogId(companyId),
      loadLastAnalyticsRefresh(companyId),
      loadPublishSuccessRate(companyId),
    ]);

    // Trending: delta vs the prior 14-day half of the window. Positive = trending up.
    const views14ById = new Map<string, number>();
    for (const r of top14) views14ById.set(r.blogId, r.views28d); // top14 returns 14d views in views28d field
    const trending = top
      .map((r) => {
        const v14 = views14ById.get(r.blogId) ?? 0;
        const v28prevHalf = Math.max(0, r.views28d - v14);
        const deltaPct = v28prevHalf > 0 ? Number(((v14 - v28prevHalf) / v28prevHalf).toFixed(3)) : (v14 > 0 ? 1 : 0);
        return { blogId: r.blogId, title: r.title, views28d: r.views28d, deltaPct14d: deltaPct };
      })
      .filter((t) => t.views28d > 0)
      .sort((a, b) => b.deltaPct14d - a.deltaPct14d)
      .slice(0, 10);

    // Traffic-source rollup across all top 50 blogs.
    const sourceTotals = new Map<string, number>();
    const blogIds = top.map((t) => t.blogId);
    if (blogIds.length > 0) {
      const website = await resolveCompanyWebsite(companyId).catch(() => null);
      const { data: blogs } = await ownedDbTable('blogs')
        .select('id, company_id, title, slug, external_id, external_url, status, published_at')
        .in('id', blogIds)
        .eq('company_id', companyId)
        .limit(blogIds.length) as { data: BlogRow[] | null };
      const allUrls = new Set<string>();
      for (const b of (blogs ?? [])) {
        for (const u of candidateUrlsFor(b, website)) allUrls.add(u);
      }
      if (allUrls.size > 0) {
        const sinceIso = new Date(Date.now() - WINDOW_MS).toISOString();
        const { data: views } = await ownedDbTable('canonical_page_views')
          .select('view_metadata, view_count')
          .eq('company_id', companyId)
          .in('page_url', Array.from(allUrls))
          .gte('viewed_at', sinceIso)
          .limit(50_000) as { data: Array<{ view_metadata: Record<string, unknown> | null; view_count: number | null }> | null };
        for (const r of (views ?? [])) {
          const sm = String((r.view_metadata ?? {} as Record<string, unknown>).source_medium ?? 'direct');
          sourceTotals.set(sm, (sourceTotals.get(sm) ?? 0) + Number(r.view_count ?? 0));
        }
      }
    }
    const trafficSources = [...sourceTotals.entries()]
      .map(([sourceMedium, views]) => ({ sourceMedium, views }))
      .sort((a, b) => b.views - a.views)
      .slice(0, 10);

    // Top categories
    const catTotals = new Map<string, { views: number; posts: number }>();
    for (const r of top) {
      const cat = categories.get(r.blogId) || 'Uncategorised';
      const cur = catTotals.get(cat) ?? { views: 0, posts: 0 };
      cur.views += r.views28d;
      cur.posts += 1;
      catTotals.set(cat, cur);
    }
    const topCategories = [...catTotals.entries()]
      .map(([category, v]) => ({ category, ...v }))
      .sort((a, b) => b.views - a.views)
      .slice(0, 10);

    // Low performers: published >= 14d ago with < 10 views
    const lowPerformingBlogs = top
      .filter((r) => r.views28d < 10)
      .slice(0, 10)
      .map((r) => ({ blogId: r.blogId, title: r.title, views28d: r.views28d }));

    return {
      companyId,
      generatedAt: new Date().toISOString(),
      windowDays: 28,
      trending,
      trafficSources,
      topCategories,
      publishSuccessRate: publishRate.attempts > 0 ? Number((publishRate.successes / publishRate.attempts).toFixed(3)) : 0,
      publishAttempts: publishRate.attempts,
      publishSuccesses: publishRate.successes,
      lastAnalyticsRefreshAt: lastRefresh,
      lowPerformingBlogs,
    };
  });
}

async function getTopPerformingBlogsForWindow(companyId: string, days: number, limit: number): Promise<TopBlogRow[]> {
  // Same shape as getTopPerformingBlogs but with a custom window. Cached separately.
  return cached(`blog-analytics:top:${companyId}:${days}d:${limit}`, 60_000, async () => {
    const website = await resolveCompanyWebsite(companyId).catch(() => null);
    let blogs: BlogRow[] = [];
    try {
      const { data } = await ownedDbTable('blogs')
        .select('id, company_id, title, slug, external_id, external_url, status, published_at')
        .eq('company_id', companyId)
        .eq('status', 'published')
        .order('published_at', { ascending: false })
        .limit(200);
      blogs = (data ?? []) as BlogRow[];
    } catch { blogs = []; }
    if (blogs.length === 0) return [];

    const allUrls = new Set<string>();
    const urlsByBlogId = new Map<string, string[]>();
    for (const b of blogs) {
      const urls = candidateUrlsFor(b, website);
      urlsByBlogId.set(b.id, urls);
      for (const u of urls) allUrls.add(u);
    }
    if (allUrls.size === 0) return [];

    const sinceIso = new Date(Date.now() - days * 86_400_000).toISOString();
    let rows: Array<{ page_url: string; view_count: number | null; engagement_time_msec: number | null }> = [];
    try {
      const { data } = await ownedDbTable('canonical_page_views')
        .select('page_url, view_count, engagement_time_msec')
        .eq('company_id', companyId)
        .in('page_url', Array.from(allUrls))
        .gte('viewed_at', sinceIso)
        .limit(50_000);
      rows = (data ?? []) as Array<{ page_url: string; view_count: number | null; engagement_time_msec: number | null }>;
    } catch { rows = []; }

    const viewsByUrl = new Map<string, { views: number; engagementMs: number }>();
    for (const r of rows) {
      const cur = viewsByUrl.get(r.page_url) ?? { views: 0, engagementMs: 0 };
      cur.views += Number(r.view_count ?? 0);
      cur.engagementMs += Number(r.engagement_time_msec ?? 0);
      viewsByUrl.set(r.page_url, cur);
    }

    const ranked: TopBlogRow[] = blogs.map((b) => {
      const urls = urlsByBlogId.get(b.id) ?? [];
      let views = 0, engagementMs = 0;
      for (const u of urls) {
        const v = viewsByUrl.get(u);
        if (v) { views += v.views; engagementMs += v.engagementMs; }
      }
      return {
        blogId: b.id,
        title: b.title ?? '(untitled)',
        slug: b.slug,
        views28d: views,
        engagementTimeSec28d: Math.round(engagementMs / 1000),
        externalUrl: b.external_url,
      };
    });
    ranked.sort((a, b) => b.views28d - a.views28d);
    return ranked.slice(0, limit);
  });
}
