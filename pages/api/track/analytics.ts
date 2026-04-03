
/**
 * GET /api/track/analytics?account_id=xxx&days=30
 *
 * Returns aggregated blog performance metrics with:
 *   - Before/after comparison (current 7d vs previous 7d)
 *   - Content scores per page (0–100)
 *   - Prioritized insights (top 3 by impact × confidence)
 *   - Cold start state when no data exists
 *
 * Prefers blog_analytics_daily for historical data (faster at scale).
 * Falls back to raw blog_analytics if daily table is empty.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';

// ── Public types (used by BlogAnalyticsPanel) ──────────────────────────────

export interface BlogInsight {
  type:      'warning' | 'success' | 'tip';
  message:   string;
  action?:   string;
  priority?: number;
}

export interface PageStats {
  slug:         string;
  views:        number;
  avg_time:     number;
  avg_scroll:   number;
  content_score: number;  // 0–100
}

export interface PeriodDelta {
  views_delta:  number | null;  // percentage change, null = no prior data
  time_delta:   number | null;
  scroll_delta: number | null;
}

// ── Content score ──────────────────────────────────────────────────────────
// weights: scroll 40%, time 30%, views 30% (views normalised vs max in set)

function contentScore(views: number, avgScroll: number, avgTime: number, maxViews: number): number {
  const nViews  = maxViews > 0 ? Math.min(views / maxViews, 1) : 0;
  const nScroll = avgScroll / 100;
  const nTime   = Math.min(avgTime / 180, 1); // cap at 3 min
  return Math.round(nViews * 30 + nScroll * 40 + nTime * 30);
}

// ── Insight engine (prioritised) ───────────────────────────────────────────

interface ScoredInsight extends BlogInsight { _score: number; }

function deriveInsights(
  totalViews:  number,
  avgTime:     number,
  avgScroll:   number,
  topPages:    PageStats[],
  delta:       PeriodDelta,
): BlogInsight[] {
  const candidates: ScoredInsight[] = [];

  const add = (
    type:    BlogInsight['type'],
    message: string,
    action:  string | undefined,
    impact:  number,  // 1–10
    confidence: number, // 1–10
  ) => candidates.push({ type, message, action, _score: impact * confidence });

  // Cold start
  if (totalViews < 5) {
    add('tip', 'We\'ll start tracking once visitors arrive. Insights appear after 5+ page views.', undefined, 5, 10);
    return [{ type: 'tip', message: candidates[0].message }];
  }

  // Low scroll — weak intro
  if (avgScroll < 30 && totalViews >= 10) {
    add('warning', 'Readers aren\'t scrolling past the intro.', 'Strengthen your opening paragraph or move the best insight higher.', 9, 8);
  }

  // Fast bounce — low engagement
  if (avgTime < 20 && totalViews >= 5) {
    add('warning', 'Visitors leave within 20 seconds on average.', 'Add a compelling hook in the first 100 words. Check page load speed.', 8, 7);
  }

  // High traffic + low scroll — readability issue
  if (totalViews > 50 && avgScroll < 25) {
    add('warning', `High traffic (${totalViews} views) but low scroll depth (${avgScroll}%).`, 'Improve readability: shorter paragraphs, subheadings, pull quotes.', 7, 9);
  }

  // High engagement — campaign opportunity
  if (avgScroll > 75 && avgTime > 60) {
    add('success', 'High engagement — readers are reading in full.', 'Turn this blog into a LinkedIn campaign or Twitter thread.', 9, 9);
  }

  // Star page
  const star = topPages.find((p) => p.content_score >= 70);
  if (star) {
    add('success', `"${star.slug}" is your best-performing page (score ${star.content_score}/100).`, 'Repurpose it — LinkedIn posts, email digest, or short-form video hooks.', 8, 8);
  }

  // Positive trend
  if (delta.views_delta !== null && delta.views_delta >= 20) {
    add('success', `Views up ${delta.views_delta}% vs the previous 7 days.`, 'Momentum is strong — publish more content in this topic area.', 7, 9);
  }

  // Negative trend
  if (delta.views_delta !== null && delta.views_delta <= -20) {
    add('warning', `Views down ${Math.abs(delta.views_delta)}% vs the previous 7 days.`, 'Try promoting your latest post on LinkedIn or via email.', 6, 7);
  }

  // Scroll improving
  if (delta.scroll_delta !== null && delta.scroll_delta >= 15) {
    add('success', `Scroll depth improved +${delta.scroll_delta}% — content is more engaging.`, undefined, 6, 8);
  }

  if (candidates.length === 0) {
    add('tip', 'Blog Intelligence is active. Insights surface as traffic grows.', undefined, 1, 10);
  }

  return candidates
    .sort((a, b) => b._score - a._score)
    .slice(0, 3)
    .map(({ _score, ...rest }) => rest);
}

// ── Aggregation helpers ────────────────────────────────────────────────────

interface RawRow { url_slug: string; time_on_page: number; scroll_depth: number }

function aggregateSlice(pageviews: any[], leaves: any[]) {
  const viewMap   = new Map<string, number>();
  const timeArr   = new Map<string, number[]>();
  const scrollArr = new Map<string, number[]>();

  for (const r of pageviews) viewMap.set(r.url_slug, (viewMap.get(r.url_slug) ?? 0) + 1);
  for (const r of leaves   as RawRow[]) {
    if (!timeArr.has(r.url_slug))   timeArr.set(r.url_slug, []);
    if (!scrollArr.has(r.url_slug)) scrollArr.set(r.url_slug, []);
    timeArr.get(r.url_slug)!.push(r.time_on_page);
    scrollArr.get(r.url_slug)!.push(r.scroll_depth);
  }

  const avg = (a: number[]) => a.length ? Math.round(a.reduce((s, n) => s + n, 0) / a.length) : 0;
  const totalViews = pageviews.length;
  const allLeaves  = leaves as RawRow[];
  const avgTime    = allLeaves.length ? avg(allLeaves.map((r) => r.time_on_page)) : 0;
  const avgScroll  = allLeaves.length ? avg(allLeaves.map((r) => r.scroll_depth)) : 0;
  const pages      = [...viewMap.entries()].map(([slug, views]) => ({
    slug, views,
    avg_time:   avg(timeArr.get(slug)   ?? []),
    avg_scroll: avg(scrollArr.get(slug) ?? []),
  })).sort((a, b) => b.views - a.views).slice(0, 10);

  return { totalViews, avgTime, avgScroll, pages };
}

function pctChange(cur: number, prev: number): number | null {
  if (prev === 0) return null;
  return Math.round(((cur - prev) / prev) * 100);
}

// ── Handler ────────────────────────────────────────────────────────────────

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const accountId = typeof req.query.account_id === 'string' ? req.query.account_id.trim() : null;
  if (!accountId) return res.status(400).json({ error: 'account_id required' });

  const access = await enforceCompanyAccess({ req, res, companyId: accountId });
  if (!access) return;

  const days  = Math.min(90, Math.max(1, parseInt(String(req.query.days ?? '30'), 10) || 30));
  const now   = Date.now();
  const since = new Date(now - days * 86_400_000).toISOString();

  // Before/after window (always last 7d vs previous 7d)
  const cur7Start  = new Date(now - 7 * 86_400_000).toISOString();
  const prev7Start = new Date(now - 14 * 86_400_000).toISOString();

  // ── Try pre-aggregated daily table first ──────────────────────────────
  const { data: dailyRows } = await supabase
    .from('blog_analytics_daily')
    .select('url_slug, views, avg_time, avg_scroll, sessions, date')
    .eq('account_id', accountId)
    .gte('date', since.slice(0, 10))
    .order('date', { ascending: false });

  let totalViews: number;
  let avgTime:    number;
  let avgScroll:  number;
  let rawPages:   Array<{ slug: string; views: number; avg_time: number; avg_scroll: number }>;

  if (dailyRows && dailyRows.length > 0) {
    // Use pre-aggregated data
    const slugMap = new Map<string, { views: number; times: number[]; scrolls: number[] }>();
    for (const r of dailyRows as any[]) {
      const e = slugMap.get(r.url_slug) ?? { views: 0, times: [], scrolls: [] };
      e.views += r.views ?? 0;
      if (r.avg_time   > 0) e.times.push(r.avg_time);
      if (r.avg_scroll > 0) e.scrolls.push(r.avg_scroll);
      slugMap.set(r.url_slug, e);
    }
    const avg = (a: number[]) => a.length ? Math.round(a.reduce((s, n) => s + n, 0) / a.length) : 0;
    rawPages   = [...slugMap.entries()].map(([slug, d]) => ({
      slug, views: d.views, avg_time: avg(d.times), avg_scroll: avg(d.scrolls),
    })).sort((a, b) => b.views - a.views).slice(0, 10);
    totalViews = rawPages.reduce((s, p) => s + p.views, 0);
    avgTime    = avg(rawPages.flatMap((p) => Array(p.views).fill(p.avg_time)));
    avgScroll  = avg(rawPages.flatMap((p) => Array(p.views).fill(p.avg_scroll)));
  } else {
    // Fall back to raw blog_analytics
    const [pvRes, lvRes] = await Promise.all([
      supabase.from('blog_analytics').select('url_slug').eq('account_id', accountId).eq('event_type', 'pageview').gte('created_at', since),
      supabase.from('blog_analytics').select('url_slug, time_on_page, scroll_depth').eq('account_id', accountId).eq('event_type', 'pageleave').gte('created_at', since),
    ]);
    const agg = aggregateSlice(pvRes.data ?? [], lvRes.data ?? []);
    totalViews = agg.totalViews; avgTime = agg.avgTime; avgScroll = agg.avgScroll; rawPages = agg.pages;
  }

  // ── Before/After (always from raw) ────────────────────────────────────
  const [curPv, curLv, prevPv, prevLv] = await Promise.all([
    supabase.from('blog_analytics').select('url_slug').eq('account_id', accountId).eq('event_type', 'pageview').gte('created_at', cur7Start),
    supabase.from('blog_analytics').select('url_slug, time_on_page, scroll_depth').eq('account_id', accountId).eq('event_type', 'pageleave').gte('created_at', cur7Start),
    supabase.from('blog_analytics').select('url_slug').eq('account_id', accountId).eq('event_type', 'pageview').gte('created_at', prev7Start).lt('created_at', cur7Start),
    supabase.from('blog_analytics').select('url_slug, time_on_page, scroll_depth').eq('account_id', accountId).eq('event_type', 'pageleave').gte('created_at', prev7Start).lt('created_at', cur7Start),
  ]);

  const cur  = aggregateSlice(curPv.data  ?? [], curLv.data  ?? []);
  const prev = aggregateSlice(prevPv.data ?? [], prevLv.data ?? []);

  const delta: PeriodDelta = {
    views_delta:  pctChange(cur.totalViews, prev.totalViews),
    time_delta:   pctChange(cur.avgTime,    prev.avgTime),
    scroll_delta: pctChange(cur.avgScroll,  prev.avgScroll),
  };

  // ── Content scores ────────────────────────────────────────────────────
  const maxViews  = Math.max(1, ...rawPages.map((p) => p.views));
  const topPages: PageStats[] = rawPages.map((p) => ({
    ...p,
    content_score: contentScore(p.views, p.avg_scroll, p.avg_time, maxViews),
  }));

  // ── Insights ──────────────────────────────────────────────────────────
  const insights = deriveInsights(totalViews, avgTime, avgScroll, topPages, delta);

  return res.status(200).json({
    total_views:  totalViews,
    avg_time:     avgTime,
    avg_scroll:   avgScroll,
    top_pages:    topPages,
    insights,
    delta,
    period_days:  days,
    cold_start:   totalViews < 5,
  });
}
