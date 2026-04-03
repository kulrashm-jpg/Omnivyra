
/**
 * GET /api/track/clusters?account_id=xxx&days=30
 *
 * Content clustering: groups blog performance by tag/category.
 * Joins blog metadata with analytics data to surface topic-level intelligence.
 *
 * Response:
 * {
 *   clusters: [{
 *     name:         string,           // tag or category
 *     type:         'tag'|'category',
 *     post_count:   number,
 *     total_views:  number,
 *     avg_scroll:   number,
 *     avg_time:     number,
 *     intent_score: number,           // 0–100, based on cta+copy+form signals
 *   }],
 *   top_cluster:  string | null,      // best performing cluster name
 *   bottom_cluster: string | null,
 * }
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';

interface ClusterResult {
  name:         string;
  type:         'tag' | 'category';
  post_count:   number;
  total_views:  number;
  avg_scroll:   number;
  avg_time:     number;
  intent_score: number;
}

function avg(arr: number[]): number {
  return arr.length ? Math.round(arr.reduce((s, n) => s + n, 0) / arr.length) : 0;
}

// Match analytics slug to a blog slug (URL paths may have prefixes)
function slugMatches(urlSlug: string, blogSlug: string): boolean {
  if (!blogSlug) return false;
  const normalized = urlSlug.replace(/\/$/, '');
  return normalized === '/' + blogSlug ||
         normalized.endsWith('/' + blogSlug);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const accountId = typeof req.query.account_id === 'string' ? req.query.account_id.trim() : null;
  if (!accountId) return res.status(400).json({ error: 'account_id required' });

  const access = await enforceCompanyAccess({ req, res, companyId: accountId });
  if (!access) return;

  const days  = Math.min(90, Math.max(1, parseInt(String(req.query.days ?? '30'), 10) || 30));
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  // ── Fetch blog metadata ────────────────────────────────────────────────
  const { data: blogs } = await supabase
    .from('blogs')
    .select('id, slug, tags, category')
    .eq('company_id', accountId)
    .eq('status', 'published');

  if (!blogs || blogs.length === 0) {
    return res.status(200).json({ clusters: [], top_cluster: null, bottom_cluster: null });
  }

  // ── Fetch analytics data ───────────────────────────────────────────────
  const [pvRes, lvRes, intentRes] = await Promise.all([
    supabase.from('blog_analytics').select('url_slug').eq('account_id', accountId).eq('event_type', 'pageview').gte('created_at', since),
    supabase.from('blog_analytics').select('url_slug, time_on_page, scroll_depth').eq('account_id', accountId).eq('event_type', 'pageleave').gte('created_at', since),
    supabase.from('blog_analytics').select('url_slug').eq('account_id', accountId).in('event_type', ['cta_click', 'copy', 'form_interaction']).gte('created_at', since),
  ]);

  const pv     = (pvRes.data     ?? []) as any[];
  const lv     = (lvRes.data     ?? []) as any[];
  const intent = (intentRes.data ?? []) as any[];

  // Build per-slug stats
  const slugViews  = new Map<string, number>();
  const slugTimes  = new Map<string, number[]>();
  const slugScroll = new Map<string, number[]>();
  const slugIntent = new Map<string, number>();

  for (const r of pv)     slugViews.set(r.url_slug, (slugViews.get(r.url_slug) ?? 0) + 1);
  for (const r of lv)     { slugTimes.get(r.url_slug)?.push(r.time_on_page) ?? slugTimes.set(r.url_slug, [r.time_on_page]); slugScroll.get(r.url_slug)?.push(r.scroll_depth) ?? slugScroll.set(r.url_slug, [r.scroll_depth]); }
  for (const r of intent) slugIntent.set(r.url_slug, (slugIntent.get(r.url_slug) ?? 0) + 1);

  const maxViews = Math.max(1, ...slugViews.values());

  // ── Build clusters ──────────────────────────────────────────────────────
  const clusterMap = new Map<string, {
    name: string; type: 'tag' | 'category';
    views: number[]; times: number[]; scrolls: number[]; intents: number;
    slugs: Set<string>;
  }>();

  const addToCluster = (name: string, type: 'tag' | 'category', blogSlug: string) => {
    if (!name) return;
    const key = `${type}::${name.toLowerCase()}`;
    const e   = clusterMap.get(key) ?? { name, type, views: [], times: [], scrolls: [], intents: 0, slugs: new Set() };

    if (!e.slugs.has(blogSlug)) {
      e.slugs.add(blogSlug);
      // Match all analytics slugs to this blog slug
      for (const [urlSlug, v] of slugViews) {
        if (slugMatches(urlSlug, blogSlug)) {
          e.views.push(v);
          if (slugTimes.has(urlSlug))   e.times.push(...(slugTimes.get(urlSlug)!));
          if (slugScroll.has(urlSlug))  e.scrolls.push(...(slugScroll.get(urlSlug)!));
          e.intents += slugIntent.get(urlSlug) ?? 0;
        }
      }
    }
    clusterMap.set(key, e);
  };

  for (const blog of blogs as any[]) {
    const slug = blog.slug ?? '';
    if (blog.category) addToCluster(blog.category, 'category', slug);
    for (const tag of (blog.tags ?? []) as string[]) addToCluster(tag, 'tag', slug);
  }

  const clusters: ClusterResult[] = [...clusterMap.values()]
    .filter((c) => c.views.length > 0)
    .map((c) => {
      const totalViews = c.views.reduce((s, n) => s + n, 0);
      const intentScore = Math.min(100, Math.round((c.intents / Math.max(1, totalViews)) * 200));
      return {
        name:         c.name,
        type:         c.type,
        post_count:   c.slugs.size,
        total_views:  totalViews,
        avg_scroll:   avg(c.scrolls),
        avg_time:     avg(c.times),
        intent_score: intentScore,
      };
    })
    .sort((a, b) => b.total_views - a.total_views)
    .slice(0, 12);

  const ranked = [...clusters].sort((a, b) => (b.avg_scroll + b.avg_time / 3) - (a.avg_scroll + a.avg_time / 3));

  return res.status(200).json({
    clusters,
    top_cluster:    ranked[0]?.name ?? null,
    bottom_cluster: ranked[ranked.length - 1]?.name ?? null,
  });
}
