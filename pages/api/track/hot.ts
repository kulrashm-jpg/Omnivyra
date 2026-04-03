
/**
 * GET /api/track/hot?account_id=xxx
 *
 * Real-time hot content detection.
 * Returns slugs where views in the last hour are ≥2× the average hourly rate.
 *
 * Response:
 * {
 *   hot: [{ slug, views_last_hour, avg_hourly, spike_ratio }],
 *   has_trending: boolean
 * }
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';

export interface HotSlug {
  slug:            string;
  views_last_hour: number;
  avg_hourly:      number;
  spike_ratio:     number;  // views_last_hour / avg_hourly
}

const SPIKE_THRESHOLD = 2.0;   // 2× the hourly average = "hot"
const MIN_VIEWS       = 3;     // ignore single accidental hits

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const accountId = typeof req.query.account_id === 'string' ? req.query.account_id.trim() : null;
  if (!accountId) return res.status(400).json({ error: 'account_id required' });

  const access = await enforceCompanyAccess({ req, res, companyId: accountId });
  if (!access) return;

  const now          = Date.now();
  const oneHourAgo   = new Date(now - 3_600_000).toISOString();
  const twentyFourAgo = new Date(now - 86_400_000).toISOString();

  // Views in last hour
  const { data: hourlyRaw } = await supabase
    .from('blog_analytics')
    .select('url_slug')
    .eq('account_id', accountId)
    .eq('event_type', 'pageview')
    .gte('created_at', oneHourAgo);

  // Views in last 24h (for baseline avg)
  const { data: dailyRaw } = await supabase
    .from('blog_analytics')
    .select('url_slug')
    .eq('account_id', accountId)
    .eq('event_type', 'pageview')
    .gte('created_at', twentyFourAgo);

  const countBySlug = (rows: any[]): Map<string, number> => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.url_slug, (m.get(r.url_slug) ?? 0) + 1);
    return m;
  };

  const hourMap  = countBySlug(hourlyRaw ?? []);
  const dailyMap = countBySlug(dailyRaw  ?? []);

  const hot: HotSlug[] = [];

  for (const [slug, viewsLastHour] of hourMap) {
    if (viewsLastHour < MIN_VIEWS) continue;
    const daily24      = dailyMap.get(slug) ?? viewsLastHour;
    const avgHourly    = Math.max(0.5, daily24 / 24); // floor at 0.5 to avoid division noise
    const spikeRatio   = Math.round((viewsLastHour / avgHourly) * 10) / 10;
    if (spikeRatio >= SPIKE_THRESHOLD) {
      hot.push({ slug, views_last_hour: viewsLastHour, avg_hourly: Math.round(avgHourly * 10) / 10, spike_ratio: spikeRatio });
    }
  }

  hot.sort((a, b) => b.spike_ratio - a.spike_ratio);

  return res.status(200).json({ hot, has_trending: hot.length > 0 });
}
