/**
 * GET /api/track/angle-performance?account_id=xxx&days=90
 *
 * Angle Performance Memory with Decay Factor.
 *
 * Every analytics event is weighted by recency:
 *   weight = e^(−k × days_ago)   where k = ln(2)/HALF_LIFE_DAYS
 *   half-life = 30 days → events from 30d ago count 50%, 60d ago count 25%
 *
 * This keeps recommendations current and prevents stale patterns from
 * dominating the signal.
 *
 * Response:
 * {
 *   angles: [{
 *     angle_type:         'analytical' | 'contrarian' | 'strategic',
 *     post_count:         number,
 *     total_views:        number,       // raw count (for display)
 *     weighted_views:     number,       // decay-weighted (used for scoring)
 *     avg_scroll:         number,       // 0–100, decay-weighted average
 *     avg_time:           number,       // seconds, decay-weighted average
 *     avg_content_score:  number,       // 0–100 composite score
 *     confidence_level:   'high' | 'medium' | 'low',
 *   }],
 *   best_angle: 'analytical' | 'contrarian' | 'strategic' | null,
 *   has_data:   boolean,
 * }
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';

export type AngleType = 'analytical' | 'contrarian' | 'strategic';

export interface AnglePerformance {
  angle_type:         AngleType;
  post_count:         number;
  total_views:        number;
  weighted_views:     number;
  avg_scroll:         number;
  avg_time:           number;
  avg_content_score:  number;
  confidence_level:   'high' | 'medium' | 'low';
}

// ── Decay constants ────────────────────────────────────────────────────────────

const HALF_LIFE_DAYS = 30;
const DECAY_K        = Math.LN2 / HALF_LIFE_DAYS; // ≈ 0.0231

function decayWeight(createdAt: string): number {
  const daysAgo = (Date.now() - new Date(createdAt).getTime()) / 86_400_000;
  return Math.exp(-DECAY_K * Math.max(0, daysAgo));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Weighted average: Σ(weight × value) / Σ(weight) */
function weightedAvg(pairs: Array<{ value: number; weight: number }>): number {
  if (pairs.length === 0) return 0;
  const sumW  = pairs.reduce((s, p) => s + p.weight, 0);
  if (sumW === 0) return 0;
  const sumWV = pairs.reduce((s, p) => s + p.weight * p.value, 0);
  return Math.round(sumWV / sumW);
}

/** Slug matching: handles /blog/my-post prefixes */
function slugMatches(urlSlug: string, blogSlug: string): boolean {
  if (!blogSlug) return false;
  const normalized = urlSlug.replace(/\/$/, '');
  return normalized === '/' + blogSlug || normalized.endsWith('/' + blogSlug);
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const accountId = typeof req.query.account_id === 'string' ? req.query.account_id.trim() : null;
  if (!accountId) return res.status(400).json({ error: 'account_id required' });

  const access = await enforceCompanyAccess({ req, res, companyId: accountId });
  if (!access) return;

  const days  = Math.min(180, Math.max(7, parseInt(String(req.query.days ?? '90'), 10) || 90));
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  // ── Fetch blogs with angle_type ────────────────────────────────────────────
  const { data: blogs } = await supabase
    .from('blogs')
    .select('slug, angle_type')
    .eq('company_id', accountId)
    .eq('status', 'published')
    .not('angle_type', 'is', null);

  if (!blogs || blogs.length === 0) {
    return res.status(200).json({ angles: [], best_angle: null, has_data: false });
  }

  // ── Fetch analytics with created_at for decay computation ─────────────────
  const [pvRes, lvRes] = await Promise.all([
    supabase.from('blog_analytics')
      .select('url_slug, created_at')
      .eq('account_id', accountId)
      .eq('event_type', 'pageview')
      .gte('created_at', since),
    supabase.from('blog_analytics')
      .select('url_slug, scroll_depth, time_on_page, created_at')
      .eq('account_id', accountId)
      .eq('event_type', 'pageleave')
      .gte('created_at', since),
  ]);

  const pv = (pvRes.data ?? []) as Array<{ url_slug: string; created_at: string }>;
  const lv = (lvRes.data ?? []) as Array<{ url_slug: string; scroll_depth: number; time_on_page: number; created_at: string }>;

  // Build per-slug maps: raw views + weighted views + scroll/time pairs with weights
  const slugRawViews      = new Map<string, number>();
  const slugWeightedViews = new Map<string, number>();
  const slugScrollPairs   = new Map<string, Array<{ value: number; weight: number }>>();
  const slugTimePairs     = new Map<string, Array<{ value: number; weight: number }>>();

  for (const r of pv) {
    const w = decayWeight(r.created_at);
    slugRawViews.set(r.url_slug, (slugRawViews.get(r.url_slug) ?? 0) + 1);
    slugWeightedViews.set(r.url_slug, (slugWeightedViews.get(r.url_slug) ?? 0) + w);
  }

  for (const r of lv) {
    const w  = decayWeight(r.created_at);
    const sc = slugScrollPairs.get(r.url_slug) ?? [];
    const ti = slugTimePairs.get(r.url_slug) ?? [];
    sc.push({ value: r.scroll_depth,  weight: w });
    ti.push({ value: r.time_on_page,  weight: w });
    slugScrollPairs.set(r.url_slug, sc);
    slugTimePairs.set(r.url_slug,   ti);
  }

  const maxWeightedViews = Math.max(1, ...[...slugWeightedViews.values()]);

  // ── Group by angle_type ────────────────────────────────────────────────────
  const angleMap = new Map<AngleType, {
    slugs:          Set<string>;
    rawViews:       number[];
    weightedViews:  number[];
    scrollPairs:    Array<{ value: number; weight: number }>;
    timePairs:      Array<{ value: number; weight: number }>;
  }>();

  for (const blog of blogs as Array<{ slug: string; angle_type: string }>) {
    const angle = blog.angle_type as AngleType;
    if (!angle || !['analytical', 'contrarian', 'strategic'].includes(angle)) continue;

    const entry = angleMap.get(angle) ?? {
      slugs: new Set(), rawViews: [], weightedViews: [], scrollPairs: [], timePairs: [],
    };

    if (!entry.slugs.has(blog.slug)) {
      entry.slugs.add(blog.slug);

      for (const [urlSlug] of slugWeightedViews) {
        if (slugMatches(urlSlug, blog.slug)) {
          entry.rawViews.push(slugRawViews.get(urlSlug) ?? 0);
          entry.weightedViews.push(slugWeightedViews.get(urlSlug) ?? 0);
          const sc = slugScrollPairs.get(urlSlug);
          const ti = slugTimePairs.get(urlSlug);
          if (sc) entry.scrollPairs.push(...sc);
          if (ti) entry.timePairs.push(...ti);
        }
      }
    }

    angleMap.set(angle, entry);
  }

  // ── Build output ──────────────────────────────────────────────────────────
  const angles: AnglePerformance[] = [];

  for (const [angle_type, entry] of angleMap) {
    if (entry.weightedViews.length === 0) continue;

    const totalViews     = entry.rawViews.reduce((s, n) => s + n, 0);
    const totalWeighted  = entry.weightedViews.reduce((s, n) => s + n, 0);
    const avgScroll      = weightedAvg(entry.scrollPairs);
    const avgTime        = weightedAvg(entry.timePairs);

    // Content score using decay-weighted views (normalised), scroll, time
    const topWeighted = Math.max(...entry.weightedViews);
    const viewsNorm   = Math.round((topWeighted / maxWeightedViews) * 100);
    const timeNorm    = Math.min(100, Math.round((avgTime / 180) * 100)); // 3 min = 100
    const contentScore = Math.round(viewsNorm * 0.3 + avgScroll * 0.4 + timeNorm * 0.3);

    // Confidence: post count + per-post score consistency
    const postCount = entry.slugs.size;
    let confidence_level: 'high' | 'medium' | 'low';
    if (postCount >= 5) {
      const perPostScores = entry.weightedViews.map(wv => {
        const vn = Math.round((wv / maxWeightedViews) * 100);
        return Math.min(100, Math.round(vn * 0.3 + avgScroll * 0.4 + timeNorm * 0.3));
      });
      const mean   = perPostScores.reduce((s, n) => s + n, 0) / perPostScores.length;
      const stdDev = Math.sqrt(perPostScores.reduce((s, n) => s + (n - mean) ** 2, 0) / perPostScores.length);
      confidence_level = stdDev <= 15 ? 'high' : 'medium';
    } else if (postCount >= 3) {
      confidence_level = 'medium';
    } else {
      confidence_level = 'low';
    }

    angles.push({
      angle_type,
      post_count:        postCount,
      total_views:       totalViews,
      weighted_views:    Math.round(totalWeighted * 10) / 10,
      avg_scroll:        avgScroll,
      avg_time:          avgTime,
      avg_content_score: Math.min(100, contentScore),
      confidence_level,
    });
  }

  angles.sort((a, b) => b.avg_content_score - a.avg_content_score);
  const best_angle = angles[0]?.angle_type ?? null;

  return res.status(200).json({ angles, best_angle, has_data: angles.length > 0 });
}
