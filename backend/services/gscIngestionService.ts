import { supabase } from '../db/supabaseClient';
import { ensureCanonicalDomain, hashKey, normalizeUrl, resolveCompanyWebsite, safeNumber, slugifyKeyword, todayIsoDate } from './ingestionUtils';
import { ownedDbTable } from '../db/writeOwner';
import { authorizeProviderCall, recordProviderUsage } from './providers/providerCostGovernor';
import { fetchAllSearchAnalyticsRows, type SearchAnalyticsDeps } from './gscSearchAnalyticsClient';

export interface GscKeywordRow {
  date?: string | null;
  keyword: string;
  pageUrl?: string | null;
  impressions?: number | string | null;
  clicks?: number | string | null;
  ctr?: number | string | null;
  avgPosition?: number | string | null;
  country?: string | null;
  device?: string | null;
}

export interface GscIngestionInput {
  companyId: string;
  siteUrl?: string;
  accessToken?: string;
  rows?: GscKeywordRow[];
  startDate?: string;
  endDate?: string;
}

export interface GscIngestionResult {
  source: 'gsc';
  keywordsProcessed: number;
  keywordsInserted: number;
  metricsInserted: number;
  window: {
    startDate: string;
    endDate: string;
    mode: 'explicit' | 'rolling_28_day_delayed' | 'historical_90_day_delayed';
  };
}

const GSC_REPORTING_DELAY_DAYS = 3;
const GSC_ROLLING_WINDOW_DAYS = 28;
const GSC_HISTORICAL_BACKFILL_DAYS = 90;

function isoDateFromNow(daysDelta: number): string {
  const date = new Date(Date.now() + daysDelta * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

function startDateForWindow(endDate: string, days: number): string {
  const end = new Date(`${endDate}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() - Math.max(1, days) + 1);
  return end.toISOString().slice(0, 10);
}

export function resolveGscIngestionWindow(input: Pick<GscIngestionInput, 'startDate' | 'endDate'> & { historicalBackfill?: boolean } = {}): {
  startDate: string;
  endDate: string;
  mode: 'explicit' | 'rolling_28_day_delayed' | 'historical_90_day_delayed';
} {
  if (input.startDate || input.endDate) {
    const endDate = input.endDate ?? isoDateFromNow(-GSC_REPORTING_DELAY_DAYS);
    return {
      startDate: input.startDate ?? startDateForWindow(endDate, GSC_ROLLING_WINDOW_DAYS),
      endDate,
      mode: 'explicit',
    };
  }

  const endDate = isoDateFromNow(-GSC_REPORTING_DELAY_DAYS);
  const days = input.historicalBackfill ? GSC_HISTORICAL_BACKFILL_DAYS : GSC_ROLLING_WINDOW_DAYS;
  return {
    startDate: startDateForWindow(endDate, days),
    endDate,
    mode: input.historicalBackfill ? 'historical_90_day_delayed' : 'rolling_28_day_delayed',
  };
}

export function buildGscHistoricalBackfillOverride(): { startDate: string; endDate: string } {
  const window = resolveGscIngestionWindow({ historicalBackfill: true });
  return { startDate: window.startDate, endDate: window.endDate };
}

/**
 * Aggregate totals per (keyword, page, date) — the grain keyword_metrics stores
 * (unique on company_id, keyword_id, metric_date, page_url). Search Console is asked for exactly
 * that grain (no country/device split), so each stored row is the full total, never one country's
 * or one device's slice overwriting another.
 */
const GSC_DIMENSIONS = ['query', 'page', 'date'];

async function fetchGscRows(input: GscIngestionInput, deps: SearchAnalyticsDeps = {}): Promise<GscKeywordRow[]> {
  if (Array.isArray(input.rows)) {
    return input.rows;
  }

  if (!input.siteUrl || !input.accessToken) {
    return [];
  }

  const window = resolveGscIngestionWindow(input);
  const result = await fetchAllSearchAnalyticsRows(
    { accessToken: input.accessToken, propertyUrl: input.siteUrl, startDate: window.startDate, endDate: window.endDate, dimensions: GSC_DIMENSIONS },
    deps,
  );
  // All-or-nothing per run: a partial read fails the run, so the next scheduled run re-reads the
  // same dates (the watermark only advances on a completed run). Upserts make the retry harmless.
  if (result.error) throw result.error;

  return result.rows.map((row) => ({
    date: row.keys?.[2] ?? todayIsoDate(),
    keyword: row.keys?.[0] ?? '',
    pageUrl: row.keys?.[1] ?? null,
    impressions: row.impressions ?? 0,
    clicks: row.clicks ?? 0,
    ctr: row.ctr ?? 0,
    avgPosition: row.position ?? 0,
  }));
}

/**
 * Merge rows that land on the same stored key after normalisation (keyword slug, normalised page URL,
 * date): impressions and clicks are summed, CTR recomputed, position impression-weighted. Without this
 * the second row's upsert would overwrite the first. Pure.
 */
export function aggregateGscRows(rows: GscKeywordRow[]): GscKeywordRow[] {
  const byKey = new Map<string, { row: GscKeywordRow; impressions: number; clicks: number; positionWeight: number; positionSum: number }>();
  for (const row of rows) {
    const keyword = row.keyword?.trim();
    if (!keyword) continue;
    const pageUrl = row.pageUrl ? normalizeUrl(row.pageUrl) : '';
    const date = row.date ?? todayIsoDate();
    const key = JSON.stringify([slugifyKeyword(keyword), pageUrl, date]);
    const impressions = Math.max(0, safeNumber(row.impressions, 0));
    const clicks = Math.max(0, safeNumber(row.clicks, 0));
    const position = safeNumber(row.avgPosition, 0);
    const weight = impressions > 0 ? impressions : 1;
    const entry = byKey.get(key) ?? { row: { keyword, pageUrl: row.pageUrl ?? null, date }, impressions: 0, clicks: 0, positionWeight: 0, positionSum: 0 };
    entry.impressions += impressions;
    entry.clicks += clicks;
    if (position > 0) {
      entry.positionSum += position * weight;
      entry.positionWeight += weight;
    }
    byKey.set(key, entry);
  }
  return [...byKey.values()].map((e) => ({
    ...e.row,
    impressions: e.impressions,
    clicks: e.clicks,
    ctr: e.impressions > 0 ? e.clicks / e.impressions : 0,
    avgPosition: e.positionWeight > 0 ? e.positionSum / e.positionWeight : 0,
  }));
}

async function ensureKeyword(companyId: string, keyword: string, pageUrl: string | null): Promise<string> {
  const landingPageUrl = pageUrl ? normalizeUrl(pageUrl) : '';
  const { data, error } = await ownedDbTable('canonical_keywords')
    .upsert(
      {
        company_id: companyId,
        keyword,
        keyword_normalized: slugifyKeyword(keyword),
        landing_page_url: landingPageUrl,
        source: 'gsc',
      },
      { onConflict: 'company_id,keyword_normalized,landing_page_url' }
    )
    .select('id')
    .single();

  if (error) {
    throw new Error(`Failed to upsert GSC keyword ${keyword}: ${error.message}`);
  }

  return (data as { id: string }).id;
}

export async function ingestGscData(input: GscIngestionInput, deps: SearchAnalyticsDeps = {}): Promise<GscIngestionResult> {
  // Canonical governor gate (no provider bypass): honors kill-switch / dry-run.
  // GSC is free → normally a pass-through; records the run for usage visibility.
  const gov = authorizeProviderCall({ providerId: 'search_console', organizationId: input.companyId });
  if (!gov.allowed) throw new Error(`provider_governor_blocked:search_console:${gov.reason}`);
  void recordProviderUsage({ providerId: 'search_console', organizationId: input.companyId, units: 1, operation: 'ingest' });
  const window = resolveGscIngestionWindow(input);
  const fetched = await fetchGscRows(input, deps);
  const rows = aggregateGscRows(fetched);
  const website = input.siteUrl || (await resolveCompanyWebsite(input.companyId));
  if (website) {
    await ensureCanonicalDomain(input.companyId, website);
  }

  let keywordsInserted = 0;
  let metricsInserted = 0;

  for (const row of rows) {
    if (!row.keyword?.trim()) continue;

    const keywordId = await ensureKeyword(input.companyId, row.keyword.trim(), row.pageUrl ?? null);
    const pageUrl = row.pageUrl ? normalizeUrl(row.pageUrl) : '';
    const { error } = await ownedDbTable('keyword_metrics')
      .upsert(
        {
          company_id: input.companyId,
          keyword_id: keywordId,
          metric_date: row.date ?? todayIsoDate(),
          page_url: pageUrl,
          impressions: Math.max(0, Math.round(safeNumber(row.impressions, 0))),
          clicks: Math.max(0, Math.round(safeNumber(row.clicks, 0))),
          ctr: Math.max(0, safeNumber(row.ctr, 0)),
          avg_position: safeNumber(row.avgPosition, 0),
          // Aggregate totals: no country/device slice (clears values left by earlier per-slice rows).
          dimension_values: {},
        },
        { onConflict: 'company_id,keyword_id,metric_date,page_url' }
      );

    if (error) {
      throw new Error(`Failed to upsert keyword metrics for ${row.keyword}: ${error.message}`);
    }

    keywordsInserted += 1;
    metricsInserted += 1;
  }

  return {
    source: 'gsc',
    keywordsProcessed: fetched.length,
    keywordsInserted,
    metricsInserted,
    window,
  };
}

export function buildGscRunKey(input: GscIngestionInput): string {
  const window = Array.isArray(input.rows) ? null : resolveGscIngestionWindow(input);
  return hashKey(
    'gsc',
    input.companyId,
    input.siteUrl,
    window?.startDate ?? input.startDate ?? '',
    window?.endDate ?? input.endDate ?? '',
    Array.isArray(input.rows) ? input.rows.length : 'api',
  );
}
