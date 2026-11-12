import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';

/**
 * GET /api/track/hot?account_id=xxx
 *
 * Real-time hot content detection.
 * Returns slugs where views in the last hour are ≥2× the average hourly rate.
 *
 * Response:
 * {
 *   hot: [{ slug, views_last_hour, avg_hourly, spike_ratio }],
 *   has_trending: boolean,
 *   incomplete: boolean   // the last-hour read hit the row cap: some hot posts may be missing
 * }
 *
 * A failed read answers 500 HOT_UNAVAILABLE (e9 / 05, 2026-11-12). It used to FABRICATE spikes: a
 * failed - or row-capped - 24h read left a post without a baseline, the baseline fell back to the
 * post's own last-hour count, and every post with 3+ views was announced as trending at 6x or more.
 * The baseline is now an EXACT count per candidate post (never row-capped), and a post whose
 * baseline cannot be read is never reported.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { AnalyticsReadError, countOf, rowsOf } from '../../../backend/services/blog/blogAnalyticsRead';

export interface HotSlug {
  slug:            string;
  views_last_hour: number;
  avg_hourly:      number;
  spike_ratio:     number;  // views_last_hour / avg_hourly
}

const SPIKE_THRESHOLD = 2.0;   // 2× the hourly average = "hot"
const MIN_VIEWS       = 3;     // ignore single accidental hits
const MAX_CANDIDATES  = 20;    // baselines read for at most this many posts (the busiest last hour)

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const accountId = typeof req.query.account_id === 'string' ? req.query.account_id.trim() : null;
  if (!accountId) return res.status(400).json({ error: 'account_id required' });

  const access = await enforceCompanyAccess({ req, res, companyId: accountId });
  if (!access) return;

  const now          = Date.now();
  const oneHourAgo   = new Date(now - 3_600_000).toISOString();
  const twentyFourAgo = new Date(now - 86_400_000).toISOString();

  const hot: HotSlug[] = [];
  let incomplete = false;

  try {
    // Views in last hour. `count: 'exact'` tells a row-capped read from a complete one.
    const hourly = await supabase
      .from('blog_analytics')
      .select('url_slug', { count: 'exact' })
      .eq('account_id', accountId)
      .eq('event_type', 'pageview')
      .gte('created_at', oneHourAgo);
    const hourRows = rowsOf(hourly as { data: { url_slug: string }[] | null; error: { message?: string } | null }, 'pageviews last hour');
    incomplete = typeof hourly.count === 'number' && hourly.count > hourRows.length;

    const hourMap = new Map<string, number>();
    for (const r of hourRows) hourMap.set(r.url_slug, (hourMap.get(r.url_slug) ?? 0) + 1);

    const candidates = [...hourMap]
      .filter(([, v]) => v >= MIN_VIEWS)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_CANDIDATES);

    // Each candidate's 24h baseline: an EXACT count (head request - no rows, so no row cap).
    const baselines = await Promise.all(candidates.map(([slug]) => supabase
      .from('blog_analytics')
      .select('url_slug', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .eq('event_type', 'pageview')
      .eq('url_slug', slug)
      .gte('created_at', twentyFourAgo)));

    candidates.forEach(([slug, viewsLastHour], i) => {
      // The 24h window contains the last hour; the reads run at slightly different instants.
      const daily24    = Math.max(countOf(baselines[i] as { count: number | null; error: { message?: string } | null }, 'pageviews 24h baseline'), viewsLastHour);
      const avgHourly  = Math.max(0.5, daily24 / 24); // floor at 0.5 to avoid division noise
      const spikeRatio = Math.round((viewsLastHour / avgHourly) * 10) / 10;
      if (spikeRatio >= SPIKE_THRESHOLD) {
        hot.push({ slug, views_last_hour: viewsLastHour, avg_hourly: Math.round(avgHourly * 10) / 10, spike_ratio: spikeRatio });
      }
    });
  } catch (err) {
    if (!(err instanceof AnalyticsReadError)) throw err;
    console.error('[track/hot] read failed', { account_id: accountId, read: err.what, error: err.message });
    return res.status(500).json({ code: 'HOT_UNAVAILABLE', error: 'Trending detection is temporarily unavailable.' });
  }

  if (incomplete) console.warn('[track/hot] last-hour read hit the row cap; some hot posts may be missing', { account_id: accountId });
  hot.sort((a, b) => b.spike_ratio - a.spike_ratio);

  return res.status(200).json({ hot, has_trending: hot.length > 0, incomplete });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/track/hot' });
