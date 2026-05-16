import { ownedDbTable } from '../db/writeOwner';
import {
  getActiveSearchConsoleProperty,
  getGoogleSearchConsoleStatus,
  getValidSearchConsoleAccessTokenForCompany,
  type AnalyticsPropertyRecord,
} from './analyticsIntegrationService';
import {
  normalizeWebsiteDomain,
  resolveOmnivyraWebsiteCompany,
  resolveOmnivyraWebsiteUrl,
} from './omnivyraWebsiteCompanyService';

const GSC_SCOPE = 'omnivyra_website';
const GSC_REPORTING_DELAY_DAYS = 3;
const GSC_BACKFILL_DAYS = 90;
const GSC_INCREMENTAL_LOOKBACK_DAYS = 7;
const GSC_STALE_THRESHOLD_DAYS = 4;
const GSC_ROW_LIMIT = 25_000;
const GSC_MAX_RETRIES = 3;

type SearchAnalyticsRow = {
  keys?: string[];
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
};

type FactRow = {
  metric_date: string;
  query: string;
  page_url: string;
  country: string;
  device: string;
  clicks: number;
  impressions: number;
  ctr: number;
  avg_position: number;
};

type DailyRow = {
  metric_date: string;
  clicks: number;
  impressions: number;
  ctr: number;
  avg_position: number;
  raw_rows: number;
};

export type OmnivyraGscMetricRow = {
  label: string;
  clicks: number;
  impressions: number;
  ctr: number;
  avg_position: number;
};

export type OmnivyraGscDashboardSummary = {
  status: {
    connected: boolean;
    status: 'no_property' | 'not_synced' | 'live' | 'stale' | 'partial' | 'failed';
    degraded_state: 'live' | 'stale' | 'partial' | 'failed' | 'no_analytics';
    message: string;
    selected_property: string | null;
    last_sync: string | null;
    last_successful_data_date: string | null;
    rows_ingested: number;
    error_message: string | null;
  };
  summary: {
    clicks: number;
    impressions: number;
    ctr: number;
    avg_position: number;
  };
  top_queries: OmnivyraGscMetricRow[];
  top_pages: OmnivyraGscMetricRow[];
  devices: OmnivyraGscMetricRow[];
  countries: OmnivyraGscMetricRow[];
  provenance: {
    source: 'gsc_canonical_ingestion' | 'fallback_no_gsc';
    company_id: string | null;
    website: string;
    property_url: string | null;
  };
};

export type OmnivyraGscIngestionResult = {
  status: 'completed' | 'partial' | 'failed';
  company_id: string;
  property_url: string;
  start_date: string;
  end_date: string;
  rows_fetched: number;
  rows_ingested: number;
  retries: number;
  error_message: string | null;
};

function isoDateDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function safeNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function weightedCtr(clicks: number, impressions: number): number {
  return impressions > 0 ? Number((clicks / impressions).toFixed(6)) : 0;
}

function weightedPosition(rows: Array<{ avg_position: number; impressions: number }>): number {
  const weight = rows.reduce((sum, row) => sum + Math.max(1, row.impressions), 0);
  const weighted = rows.reduce((sum, row) => sum + row.avg_position * Math.max(1, row.impressions), 0);
  return weight > 0 ? Number((weighted / weight).toFixed(4)) : 0;
}

export function normalizeGscPropertyLabel(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(/Ã¢â‚¬Â¢|â€¢/g, '-')
    .replace(/\s+-\s+/g, ' - ')
    .trim();
}

function classifyStatus(row: any | null): OmnivyraGscDashboardSummary['status']['status'] {
  if (!row) return 'not_synced';
  if (row.status === 'failed') return 'failed';
  if (row.status === 'partial') return 'partial';
  if (!row.last_successful_sync_at) return 'not_synced';
  const last = new Date(row.last_successful_sync_at).getTime();
  if (!Number.isFinite(last)) return 'stale';
  return Date.now() - last > GSC_STALE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000 ? 'stale' : 'live';
}

function messageForStatus(status: OmnivyraGscDashboardSummary['status']['status'], error: string | null): string {
  if (status === 'live') return 'Search Console data is refreshed.';
  if (status === 'stale') return 'Search Console data is stale. Refresh Search Console to update SEO metrics.';
  if (status === 'partial') return error || 'Search Console sync completed with partial data.';
  if (status === 'failed') return error || 'Search Console sync failed.';
  if (status === 'no_property') return 'Select an Omnivyra Search Console property before syncing.';
  return 'Search Console is connected but has not synced canonical SEO data yet.';
}

async function resolveOmnivyraGscContext(): Promise<{
  company: NonNullable<Awaited<ReturnType<typeof resolveOmnivyraWebsiteCompany>>>;
  property: AnalyticsPropertyRecord;
  accessToken: string;
}> {
  const company = await resolveOmnivyraWebsiteCompany();
  if (!company) {
    throw new Error('No Omnivyra website company is configured.');
  }

  const [status, property, accessToken] = await Promise.all([
    getGoogleSearchConsoleStatus(company.id),
    getActiveSearchConsoleProperty(company.id),
    getValidSearchConsoleAccessTokenForCompany(company.id),
  ]);

  if (!status.integration || status.integration.status !== 'connected' || !status.tokenValid || !accessToken) {
    throw new Error('Search Console is not authenticated for the Omnivyra website.');
  }
  if (!property) {
    throw new Error('No active Search Console property is selected for the Omnivyra website.');
  }

  return { company, property, accessToken };
}

async function requestSearchAnalytics(params: {
  accessToken: string;
  propertyUrl: string;
  startDate: string;
  endDate: string;
  dimensions: string[];
  startRow: number;
}): Promise<{ rows: SearchAnalyticsRow[]; retries: number }> {
  let attempt = 0;
  let retries = 0;
  let lastError: Error | null = null;

  while (attempt <= GSC_MAX_RETRIES) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(
        `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(params.propertyUrl)}/searchAnalytics/query`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${params.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            startDate: params.startDate,
            endDate: params.endDate,
            dimensions: params.dimensions,
            rowLimit: GSC_ROW_LIMIT,
            startRow: params.startRow,
          }),
          signal: controller.signal,
        },
      );
      clearTimeout(timeout);

      if (response.ok) {
        const payload = await response.json().catch(() => ({}));
        return {
          rows: Array.isArray(payload?.rows) ? payload.rows : [],
          retries,
        };
      }

      const body = await response.text().catch(() => '');
      lastError = new Error(`Search Console API failed (${response.status}): ${body || response.statusText}`);
      if (![408, 429, 500, 502, 503, 504].includes(response.status)) {
        throw lastError;
      }
    } catch (error) {
      clearTimeout(timeout);
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt >= GSC_MAX_RETRIES) break;
    }

    retries += 1;
    await new Promise((resolve) => setTimeout(resolve, 500 * Math.pow(2, attempt)));
    attempt += 1;
  }

  throw lastError ?? new Error('Search Console API failed.');
}

async function fetchAllSearchAnalyticsRows(params: {
  accessToken: string;
  propertyUrl: string;
  startDate: string;
  endDate: string;
  dimensions: string[];
}): Promise<{ rows: SearchAnalyticsRow[]; retries: number; partialFailure: string | null }> {
  const rows: SearchAnalyticsRow[] = [];
  let retries = 0;

  for (let startRow = 0; ; startRow += GSC_ROW_LIMIT) {
    try {
      const page = await requestSearchAnalytics({ ...params, startRow });
      rows.push(...page.rows);
      retries += page.retries;
      console.info('[OMNIVYRA-GSC][page-fetched]', {
        dimensions: params.dimensions,
        start_row: startRow,
        rows: page.rows.length,
        retries: page.retries,
      });
      if (page.rows.length < GSC_ROW_LIMIT) {
        return { rows, retries, partialFailure: null };
      }
    } catch (error) {
      return {
        rows,
        retries,
        partialFailure: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

function mapFactRows(rows: SearchAnalyticsRow[]): FactRow[] {
  return rows.map((row) => ({
    query: String(row.keys?.[0] ?? '').trim(),
    page_url: String(row.keys?.[1] ?? '').trim(),
    country: String(row.keys?.[2] ?? '').trim(),
    device: String(row.keys?.[3] ?? '').trim(),
    metric_date: String(row.keys?.[4] ?? '').trim(),
    clicks: Math.max(0, Math.round(safeNumber(row.clicks))),
    impressions: Math.max(0, Math.round(safeNumber(row.impressions))),
    ctr: Math.max(0, safeNumber(row.ctr)),
    avg_position: Math.max(0, safeNumber(row.position)),
  })).filter((row) => row.metric_date);
}

function mapDailyRows(rows: SearchAnalyticsRow[]): DailyRow[] {
  return rows.map((row) => ({
    metric_date: String(row.keys?.[0] ?? '').trim(),
    clicks: Math.max(0, Math.round(safeNumber(row.clicks))),
    impressions: Math.max(0, Math.round(safeNumber(row.impressions))),
    ctr: Math.max(0, safeNumber(row.ctr)),
    avg_position: Math.max(0, safeNumber(row.position)),
    raw_rows: 1,
  })).filter((row) => row.metric_date);
}

async function resolveIncrementalWindow(propertyUrl: string, forceBackfill: boolean): Promise<{ startDate: string; endDate: string }> {
  const endDate = isoDateDaysAgo(GSC_REPORTING_DELAY_DAYS);
  if (forceBackfill) {
    return { startDate: isoDateDaysAgo(GSC_BACKFILL_DAYS + GSC_REPORTING_DELAY_DAYS), endDate };
  }

  const { data } = await ownedDbTable('platform_gsc_sync_status')
    .select('last_successful_data_date')
    .eq('scope', GSC_SCOPE)
    .eq('property_url', propertyUrl)
    .maybeSingle();

  const latest = typeof data?.last_successful_data_date === 'string' ? data.last_successful_data_date : null;
  return {
    startDate: latest ? addDays(latest, -GSC_INCREMENTAL_LOOKBACK_DAYS) : isoDateDaysAgo(GSC_BACKFILL_DAYS + GSC_REPORTING_DELAY_DAYS),
    endDate,
  };
}

async function upsertSyncStatus(params: {
  companyId: string;
  propertyUrl: string;
  status: 'not_synced' | 'syncing' | 'completed' | 'partial' | 'failed';
  degradedState: 'live' | 'stale' | 'partial' | 'failed' | 'no_analytics';
  startedAt?: string | null;
  completedAt?: string | null;
  lastSuccessfulSyncAt?: string | null;
  lastSuccessfulDataDate?: string | null;
  rowsFetched?: number;
  rowsIngested?: number;
  retryCount?: number;
  errorMessage?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const { data: existing } = await ownedDbTable('platform_gsc_sync_status')
    .select('last_successful_sync_at, last_successful_data_date')
    .eq('scope', GSC_SCOPE)
    .eq('property_url', params.propertyUrl)
    .maybeSingle();

  const { error } = await ownedDbTable('platform_gsc_sync_status')
    .upsert(
      {
        scope: GSC_SCOPE,
        company_id: params.companyId,
        property_url: params.propertyUrl,
        status: params.status,
        degraded_state: params.degradedState,
        started_at: params.startedAt ?? null,
        completed_at: params.completedAt ?? null,
        last_successful_sync_at: params.lastSuccessfulSyncAt ?? existing?.last_successful_sync_at ?? null,
        last_successful_data_date: params.lastSuccessfulDataDate ?? existing?.last_successful_data_date ?? null,
        rows_fetched: params.rowsFetched ?? 0,
        rows_ingested: params.rowsIngested ?? 0,
        retry_count: params.retryCount ?? 0,
        error_message: params.errorMessage ?? null,
        metadata: params.metadata ?? {},
      },
      { onConflict: 'scope,property_url' },
    );
  if (error) throw new Error(`Failed to update GSC sync status: ${error.message}`);
}

async function upsertFactRows(companyId: string, propertyUrl: string, rows: FactRow[]): Promise<number> {
  let written = 0;
  for (let index = 0; index < rows.length; index += 500) {
    const batch = rows.slice(index, index + 500);
    const { error } = await ownedDbTable('platform_gsc_query_metrics')
      .upsert(
        batch.map((row) => ({
          scope: GSC_SCOPE,
          company_id: companyId,
          property_url: propertyUrl,
          ...row,
          ingestion_run_at: new Date().toISOString(),
        })),
        { onConflict: 'scope,property_url,metric_date,query,page_url,country,device' },
      );
    if (error) throw new Error(`Failed to upsert GSC query metrics: ${error.message}`);
    written += batch.length;
  }
  return written;
}

async function upsertDailyRows(companyId: string, propertyUrl: string, rows: DailyRow[]): Promise<number> {
  let written = 0;
  for (let index = 0; index < rows.length; index += 500) {
    const batch = rows.slice(index, index + 500);
    const { error } = await ownedDbTable('platform_gsc_daily_metrics')
      .upsert(
        batch.map((row) => ({
          scope: GSC_SCOPE,
          company_id: companyId,
          property_url: propertyUrl,
          ...row,
          ingestion_run_at: new Date().toISOString(),
        })),
        { onConflict: 'scope,property_url,metric_date' },
      );
    if (error) throw new Error(`Failed to upsert GSC daily metrics: ${error.message}`);
    written += batch.length;
  }
  return written;
}

export async function runOmnivyraGscIngestion(options: {
  forceBackfill?: boolean;
  startDate?: string;
  endDate?: string;
} = {}): Promise<OmnivyraGscIngestionResult> {
  const context = await resolveOmnivyraGscContext();
  const propertyUrl = context.property.property_id;
  const startedAt = new Date().toISOString();
  const resolvedWindow = options.startDate && options.endDate
    ? { startDate: options.startDate, endDate: options.endDate }
    : await resolveIncrementalWindow(propertyUrl, Boolean(options.forceBackfill));

  console.info('[OMNIVYRA-GSC][ingestion-start]', {
    company_id: context.company.id,
    property_url: propertyUrl,
    start_date: resolvedWindow.startDate,
    end_date: resolvedWindow.endDate,
  });

  await upsertSyncStatus({
    companyId: context.company.id,
    propertyUrl,
    status: 'syncing',
    degradedState: 'partial',
    startedAt,
    metadata: { window: resolvedWindow },
  });

  const factFetch = await fetchAllSearchAnalyticsRows({
    accessToken: context.accessToken,
    propertyUrl,
    startDate: resolvedWindow.startDate,
    endDate: resolvedWindow.endDate,
    dimensions: ['query', 'page', 'country', 'device', 'date'],
  });
  const dailyFetch = await fetchAllSearchAnalyticsRows({
    accessToken: context.accessToken,
    propertyUrl,
    startDate: resolvedWindow.startDate,
    endDate: resolvedWindow.endDate,
    dimensions: ['date'],
  });

  const factRows = mapFactRows(factFetch.rows);
  const dailyRows = mapDailyRows(dailyFetch.rows);
  const partialFailure = factFetch.partialFailure || dailyFetch.partialFailure;
  const rowsFetched = factRows.length + dailyRows.length;
  const retries = factFetch.retries + dailyFetch.retries;

  let rowsIngested = 0;
  try {
    rowsIngested += await upsertFactRows(context.company.id, propertyUrl, factRows);
    rowsIngested += await upsertDailyRows(context.company.id, propertyUrl, dailyRows);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await upsertSyncStatus({
      companyId: context.company.id,
      propertyUrl,
      status: 'failed',
      degradedState: 'failed',
      startedAt,
      completedAt: new Date().toISOString(),
      rowsFetched,
      rowsIngested,
      retryCount: retries,
      errorMessage: message,
      metadata: { window: resolvedWindow },
    });
    throw error;
  }

  const latestDataDate = dailyRows.map((row) => row.metric_date).sort().at(-1) ?? null;
  const completedAt = new Date().toISOString();
  const finalStatus = partialFailure ? 'partial' : 'completed';

  await upsertSyncStatus({
    companyId: context.company.id,
    propertyUrl,
    status: finalStatus,
    degradedState: partialFailure ? 'partial' : 'live',
    startedAt,
    completedAt,
    lastSuccessfulSyncAt: rowsIngested > 0 ? completedAt : null,
    lastSuccessfulDataDate: latestDataDate,
    rowsFetched,
    rowsIngested,
    retryCount: retries,
    errorMessage: partialFailure,
    metadata: { window: resolvedWindow },
  });

  console.info('[OMNIVYRA-GSC][ingestion-complete]', {
    company_id: context.company.id,
    property_url: propertyUrl,
    rows_fetched: rowsFetched,
    rows_ingested: rowsIngested,
    retries,
    status: finalStatus,
  });

  return {
    status: finalStatus,
    company_id: context.company.id,
    property_url: propertyUrl,
    start_date: resolvedWindow.startDate,
    end_date: resolvedWindow.endDate,
    rows_fetched: rowsFetched,
    rows_ingested: rowsIngested,
    retries,
    error_message: partialFailure,
  };
}

function aggregateBy(rows: FactRow[], getLabel: (row: FactRow) => string, limit: number): OmnivyraGscMetricRow[] {
  const buckets = new Map<string, FactRow[]>();
  for (const row of rows) {
    const label = getLabel(row).trim() || 'Unknown';
    buckets.set(label, [...(buckets.get(label) ?? []), row]);
  }
  return Array.from(buckets.entries()).map(([label, bucket]) => {
    const clicks = bucket.reduce((sum, row) => sum + row.clicks, 0);
    const impressions = bucket.reduce((sum, row) => sum + row.impressions, 0);
    return {
      label,
      clicks,
      impressions,
      ctr: weightedCtr(clicks, impressions),
      avg_position: weightedPosition(bucket),
    };
  }).sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions).slice(0, limit);
}

export async function getOmnivyraGscDashboardSummary(days = 30): Promise<OmnivyraGscDashboardSummary> {
  const company = await resolveOmnivyraWebsiteCompany();
  const website = company ? (resolveOmnivyraWebsiteUrl(company) || 'omnivyra.com') : 'omnivyra.com';
  if (!company) {
    return {
      status: {
        connected: false,
        status: 'failed',
        degraded_state: 'failed',
        message: 'No Omnivyra website company is configured.',
        selected_property: null,
        last_sync: null,
        last_successful_data_date: null,
        rows_ingested: 0,
        error_message: 'No Omnivyra website company is configured.',
      },
      summary: { clicks: 0, impressions: 0, ctr: 0, avg_position: 0 },
      top_queries: [],
      top_pages: [],
      devices: [],
      countries: [],
      provenance: { source: 'fallback_no_gsc', company_id: null, website, property_url: null },
    };
  }

  const property = await getActiveSearchConsoleProperty(company.id).catch(() => null);
  if (!property) {
    return {
      status: {
        connected: false,
        status: 'no_property',
        degraded_state: 'no_analytics',
        message: 'Select an Omnivyra Search Console property before syncing.',
        selected_property: null,
        last_sync: null,
        last_successful_data_date: null,
        rows_ingested: 0,
        error_message: null,
      },
      summary: { clicks: 0, impressions: 0, ctr: 0, avg_position: 0 },
      top_queries: [],
      top_pages: [],
      devices: [],
      countries: [],
      provenance: { source: 'fallback_no_gsc', company_id: company.id, website, property_url: null },
    };
  }

  const since = isoDateDaysAgo(days + GSC_REPORTING_DELAY_DAYS);
  const [statusResult, dailyResult, factResult] = await Promise.all([
    ownedDbTable('platform_gsc_sync_status')
      .select('*')
      .eq('scope', GSC_SCOPE)
      .eq('property_url', property.property_id)
      .maybeSingle(),
    ownedDbTable('platform_gsc_daily_metrics')
      .select('metric_date, clicks, impressions, ctr, avg_position, raw_rows')
      .eq('scope', GSC_SCOPE)
      .eq('property_url', property.property_id)
      .gte('metric_date', since)
      .order('metric_date', { ascending: false })
      .limit(500),
    ownedDbTable('platform_gsc_query_metrics')
      .select('metric_date, query, page_url, country, device, clicks, impressions, ctr, avg_position')
      .eq('scope', GSC_SCOPE)
      .eq('property_url', property.property_id)
      .gte('metric_date', since)
      .limit(20000),
  ]);

  if (statusResult.error || dailyResult.error || factResult.error) {
    const message = statusResult.error?.message || dailyResult.error?.message || factResult.error?.message || 'Failed to load Search Console canonical data';
    return {
      status: {
        connected: false,
        status: 'failed',
        degraded_state: 'failed',
        message,
        selected_property: property.property_id,
        last_sync: null,
        last_successful_data_date: null,
        rows_ingested: 0,
        error_message: message,
      },
      summary: { clicks: 0, impressions: 0, ctr: 0, avg_position: 0 },
      top_queries: [],
      top_pages: [],
      devices: [],
      countries: [],
      provenance: { source: 'fallback_no_gsc', company_id: company.id, website, property_url: property.property_id },
    };
  }

  const statusRow = statusResult.data as any | null;
  const dashboardStatus = classifyStatus(statusRow);
  const dailyRows = (dailyResult.data ?? []) as DailyRow[];
  const factRows = (factResult.data ?? []) as FactRow[];
  const clicks = dailyRows.reduce((sum, row) => sum + Number(row.clicks ?? 0), 0);
  const impressions = dailyRows.reduce((sum, row) => sum + Number(row.impressions ?? 0), 0);
  const avgPosition = weightedPosition(dailyRows.map((row) => ({ avg_position: Number(row.avg_position ?? 0), impressions: Number(row.impressions ?? 0) })));

  return {
    status: {
      connected: dashboardStatus === 'live' || dashboardStatus === 'stale' || dashboardStatus === 'partial',
      status: dashboardStatus,
      degraded_state: statusRow?.degraded_state ?? (dashboardStatus === 'live' ? 'live' : 'no_analytics'),
      message: messageForStatus(dashboardStatus, statusRow?.error_message ?? null),
      selected_property: normalizeGscPropertyLabel(property.property_name || property.property_id),
      last_sync: statusRow?.last_successful_sync_at ?? statusRow?.completed_at ?? null,
      last_successful_data_date: statusRow?.last_successful_data_date ?? null,
      rows_ingested: Number(statusRow?.rows_ingested ?? 0),
      error_message: statusRow?.error_message ?? null,
    },
    summary: {
      clicks,
      impressions,
      ctr: weightedCtr(clicks, impressions),
      avg_position: avgPosition,
    },
    top_queries: aggregateBy(factRows, (row) => row.query, 10),
    top_pages: aggregateBy(factRows, (row) => row.page_url, 10),
    devices: aggregateBy(factRows, (row) => row.device, 8),
    countries: aggregateBy(factRows, (row) => row.country, 10),
    provenance: {
      source: factRows.length > 0 || dailyRows.length > 0 ? 'gsc_canonical_ingestion' : 'fallback_no_gsc',
      company_id: company.id,
      website: normalizeWebsiteDomain(website) || website,
      property_url: property.property_id,
    },
  };
}

export async function buildOmnivyraGscReportContext(companyId: string): Promise<OmnivyraGscDashboardSummary | null> {
  const company = await resolveOmnivyraWebsiteCompany();
  if (!company || company.id !== companyId) return null;
  return getOmnivyraGscDashboardSummary(30);
}

export { GSC_SCOPE as OMNIVYRA_GSC_SCOPE };
