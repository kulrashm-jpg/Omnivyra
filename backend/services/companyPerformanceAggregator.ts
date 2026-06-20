/**
 * Phase 6E-2 — Company-scoped performance aggregation.
 *
 * Derives company-level platform and content-type engagement rankings from the
 * LIVE `campaign_performance_signals` table (fed by the analytics ingestion
 * pipeline: content_analytics → performanceIngestionJob). Unlike the
 * campaign-scoped `rankPlatformsByPerformance`, these aggregate across the
 * company's recent history, so they are populated for brand-new campaigns too.
 *
 * READ-ONLY. Company-scoped. Empty-safe. Never throws.
 */

import { supabase } from '../db/supabaseClient';
import type { PlatformRank } from './platformPerformanceRanker';

export interface ContentTypeRank {
  content_type: string;
  avg_engagement_rate: number;
  post_count: number;
}

const DEFAULT_LOOKBACK_DAYS = 90;
const MAX_ROWS = 5000;

interface SignalRow {
  platform?: string | null;
  content_type?: string | null;
  impressions?: number | null;
  engagement?: number | null;
}

async function fetchRecentSignals(companyId: string, lookbackDays: number): Promise<SignalRow[]> {
  const cutoffIso = new Date(Date.now() - lookbackDays * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from('campaign_performance_signals')
    .select('platform, content_type, impressions, engagement')
    .eq('company_id', companyId)
    .gte('created_at', cutoffIso)
    .limit(MAX_ROWS);
  if (error || !data) return [];
  return data as SignalRow[];
}

/** Engagement rate = engagement / impressions; 0 when impressions are absent. */
function rate(engagement: number, impressions: number): number {
  return impressions > 0 ? Number((engagement / impressions).toFixed(4)) : 0;
}

function aggregate(
  rows: SignalRow[],
  keyOf: (r: SignalRow) => string,
): Array<{ key: string; avg_engagement_rate: number; post_count: number }> {
  const byKey = new Map<string, { imp: number; eng: number; count: number }>();
  for (const r of rows) {
    const key = keyOf(r);
    if (!key) continue;
    const cur = byKey.get(key) ?? { imp: 0, eng: 0, count: 0 };
    cur.imp += Number(r.impressions ?? 0);
    cur.eng += Number(r.engagement ?? 0);
    cur.count += 1;
    byKey.set(key, cur);
  }
  return Array.from(byKey.entries())
    .map(([key, a]) => ({ key, avg_engagement_rate: rate(a.eng, a.imp), post_count: a.count }))
    .sort((x, y) => y.avg_engagement_rate - x.avg_engagement_rate || y.post_count - x.post_count);
}

/** Rank a company's platforms by recent engagement (output compatible with PlatformRank). */
export async function rankPlatformsByCompanyPerformance(
  companyId: string,
  opts: { lookbackDays?: number } = {},
): Promise<PlatformRank[]> {
  try {
    const id = companyId?.trim();
    if (!id) return [];
    const rows = await fetchRecentSignals(id, opts.lookbackDays ?? DEFAULT_LOOKBACK_DAYS);
    return aggregate(rows, (r) => String(r.platform ?? '').toLowerCase().replace(/^twitter$/, 'x').trim())
      .map((a) => ({ platform: a.key, avg_engagement_rate: a.avg_engagement_rate, post_count: a.post_count }));
  } catch {
    return [];
  }
}

/** Rank a company's content types by recent engagement. */
export async function rankContentTypesByCompanyPerformance(
  companyId: string,
  opts: { lookbackDays?: number } = {},
): Promise<ContentTypeRank[]> {
  try {
    const id = companyId?.trim();
    if (!id) return [];
    const rows = await fetchRecentSignals(id, opts.lookbackDays ?? DEFAULT_LOOKBACK_DAYS);
    return aggregate(rows, (r) => String(r.content_type ?? '').toLowerCase().trim())
      .map((a) => ({ content_type: a.key, avg_engagement_rate: a.avg_engagement_rate, post_count: a.post_count }));
  } catch {
    return [];
  }
}
