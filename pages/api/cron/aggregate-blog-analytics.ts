/**
 * GET /api/cron/aggregate-blog-analytics
 *
 * Daily cron: rolls up yesterday's raw blog_analytics events into
 * blog_analytics_daily for fast dashboard queries.
 *
 * Configure in vercel.json:
 *   { "path": "/api/cron/aggregate-blog-analytics", "schedule": "0 3 * * *" }
 *
 * Protected by x-cron-secret header.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();

  const secret = process.env.CRON_SECRET;
  if (secret && req.headers['x-cron-secret'] !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const dateStr  = yesterday.toISOString().slice(0, 10); // YYYY-MM-DD
  const dayStart = `${dateStr}T00:00:00.000Z`;
  const dayEnd   = `${dateStr}T23:59:59.999Z`;

  // Fetch all pageviews for yesterday
  const { data: pageviews, error: pvErr } = await supabase
    .from('blog_analytics')
    .select('account_id, url_slug')
    .eq('event_type', 'pageview')
    .gte('created_at', dayStart)
    .lte('created_at', dayEnd);

  if (pvErr) return res.status(500).json({ error: pvErr.message });

  // Fetch all pageleave for yesterday (time + scroll)
  const { data: leaves, error: lvErr } = await supabase
    .from('blog_analytics')
    .select('account_id, url_slug, time_on_page, scroll_depth, session_id')
    .eq('event_type', 'pageleave')
    .gte('created_at', dayStart)
    .lte('created_at', dayEnd);

  if (lvErr) return res.status(500).json({ error: lvErr.message });

  // Aggregate by account_id + url_slug
  type Key = string;
  const map = new Map<Key, { views: number; times: number[]; scrolls: number[]; sessions: Set<string> }>();

  const key = (accountId: string, slug: string) => `${accountId}::${slug}`;

  for (const r of (pageviews ?? []) as any[]) {
    const k = key(r.account_id, r.url_slug);
    const e = map.get(k) ?? { views: 0, times: [], scrolls: [], sessions: new Set() };
    e.views++;
    map.set(k, e);
  }
  for (const r of (leaves ?? []) as any[]) {
    const k = key(r.account_id, r.url_slug);
    const e = map.get(k) ?? { views: 0, times: [], scrolls: [], sessions: new Set() };
    if (r.time_on_page > 0)  e.times.push(r.time_on_page);
    if (r.scroll_depth > 0)  e.scrolls.push(r.scroll_depth);
    if (r.session_id)        e.sessions.add(r.session_id);
    map.set(k, e);
  }

  const avg = (a: number[]) => a.length ? a.reduce((s, n) => s + n, 0) / a.length : 0;

  const rows = [...map.entries()].map(([k, d]) => {
    const [accountId, ...slugParts] = k.split('::');
    return {
      account_id:  accountId,
      url_slug:    slugParts.join('::'),
      date:        dateStr,
      views:       d.views,
      sessions:    d.sessions.size,
      avg_time:    Math.round(avg(d.times) * 100) / 100,
      avg_scroll:  Math.round(avg(d.scrolls) * 100) / 100,
      updated_at:  new Date().toISOString(),
    };
  });

  if (rows.length > 0) {
    const { error: upsertErr } = await supabase
      .from('blog_analytics_daily')
      .upsert(rows, { onConflict: 'account_id,url_slug,date' });

    if (upsertErr) return res.status(500).json({ error: upsertErr.message });
  }

  return res.status(200).json({ ok: true, date: dateStr, rows_upserted: rows.length });
}
