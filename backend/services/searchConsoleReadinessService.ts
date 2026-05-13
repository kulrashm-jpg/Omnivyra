import { supabase } from '../db/supabaseClient';

export type SearchConsoleDataReadinessStatus =
  | 'ready'
  | 'no_keyword_data'
  | 'insufficient_coverage'
  | 'insufficient_history'
  | 'stale';

export type SearchConsoleDataReadiness = {
  ready: boolean;
  status: SearchConsoleDataReadinessStatus;
  reason: string;
  confidence: 'none' | 'low' | 'medium' | 'high';
  metrics_last_90_days: number;
  keywords_last_90_days: number;
  pages_last_90_days: number;
  total_impressions_last_90_days: number;
  total_clicks_last_90_days: number;
  earliest_metric_date: string | null;
  latest_metric_date: string | null;
  history_days: number;
};

const MIN_GSC_METRIC_ROWS = 10;
const MIN_GSC_PAGES = 2;
const MIN_GSC_KEYWORDS = 5;
const MIN_GSC_HISTORY_DAYS = 21;
const GSC_FRESHNESS_DAYS = 10;

function isoDateDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function daysBetween(start: string | null, end: string | null): number {
  if (!start || !end) return 0;
  const startMs = new Date(`${start}T00:00:00.000Z`).getTime();
  const endMs = new Date(`${end}T00:00:00.000Z`).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return 0;
  return Math.floor((endMs - startMs) / 86400000) + 1;
}

export async function getSearchConsoleDataReadiness(companyId: string): Promise<SearchConsoleDataReadiness> {
  const since = isoDateDaysAgo(90);
  const { data, error } = await supabase
    .from('keyword_metrics')
    .select('keyword_id, metric_date, page_url, impressions, clicks')
    .eq('company_id', companyId)
    .gte('metric_date', since)
    .order('metric_date', { ascending: false })
    .limit(10000);

  if (error) {
    throw new Error(`Failed to load Search Console data readiness: ${error.message}`);
  }

  const rows = (data ?? []) as Array<{
    keyword_id: string | null;
    metric_date: string | null;
    page_url: string | null;
    impressions: number | null;
    clicks: number | null;
  }>;

  const keywordIds = new Set(rows.map((row) => row.keyword_id).filter(Boolean) as string[]);
  const pages = new Set(rows.map((row) => row.page_url?.trim()).filter(Boolean) as string[]);
  const dates = rows.map((row) => row.metric_date).filter(Boolean) as string[];
  const latestMetricDate = dates[0] ?? null;
  const earliestMetricDate = dates.length > 0 ? dates[dates.length - 1] : null;
  const historyDays = daysBetween(earliestMetricDate, latestMetricDate);
  const impressions = rows.reduce((sum, row) => sum + Number(row.impressions ?? 0), 0);
  const clicks = rows.reduce((sum, row) => sum + Number(row.clicks ?? 0), 0);

  const base = {
    metrics_last_90_days: rows.length,
    keywords_last_90_days: keywordIds.size,
    pages_last_90_days: pages.size,
    total_impressions_last_90_days: impressions,
    total_clicks_last_90_days: clicks,
    earliest_metric_date: earliestMetricDate,
    latest_metric_date: latestMetricDate,
    history_days: historyDays,
  };

  if (rows.length === 0) {
    return {
      ...base,
      ready: false,
      status: 'no_keyword_data',
      reason: 'Search Console is connected but no keyword/page metrics have been ingested yet.',
      confidence: 'none',
    };
  }

  if (latestMetricDate && latestMetricDate < isoDateDaysAgo(GSC_FRESHNESS_DAYS)) {
    return {
      ...base,
      ready: false,
      status: 'stale',
      reason: 'Search Console keyword/page data is stale.',
      confidence: rows.length >= MIN_GSC_METRIC_ROWS ? 'medium' : 'low',
    };
  }

  if (rows.length < MIN_GSC_METRIC_ROWS || keywordIds.size < MIN_GSC_KEYWORDS || pages.size < MIN_GSC_PAGES) {
    return {
      ...base,
      ready: false,
      status: 'insufficient_coverage',
      reason: 'Search Console has synced, but keyword/page coverage is still too thin for confident search insights.',
      confidence: 'low',
    };
  }

  if (historyDays < MIN_GSC_HISTORY_DAYS) {
    return {
      ...base,
      ready: false,
      status: 'insufficient_history',
      reason: 'Search Console needs more historical depth before trend insights are reliable.',
      confidence: 'medium',
    };
  }

  return {
    ...base,
    ready: true,
    status: 'ready',
    reason: 'Search Console keyword/page data is ready for Performance Intelligence.',
    confidence: impressions >= 500 && historyDays >= 60 ? 'high' : 'medium',
  };
}
