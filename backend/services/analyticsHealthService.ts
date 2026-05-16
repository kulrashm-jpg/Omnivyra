import { supabase } from '../db/supabaseClient';
import { getAnalyticsReadiness } from './analyticsDataReadinessService';
import { classifyAnalyticsFreshness, type AnalyticsFreshnessSnapshot } from './analyticsFreshnessService';
import { getOmnivyraGscDashboardSummary } from './omnivyraGscAnalyticsService';
import { buildAnalyticsCorrelationContext, type AnalyticsCorrelationContext } from './analyticsCorrelationService';
import { buildGscSeoIntelligence, type GscSeoIntelligence } from './gscSeoIntelligenceService';
import { getAnalyticsEnterpriseSnapshot, type AnalyticsEnterpriseSnapshot } from './analyticsEnterpriseSnapshotService';

export type AnalyticsHealthRun = {
  source: 'ga4' | 'gsc';
  status: string;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  records_processed: number;
  records_inserted: number;
  records_updated: number;
  retry_count: number;
  error_message: string | null;
};

export type AnalyticsHealthSummary = {
  company_id: string;
  generated_at: string;
  freshness: {
    ga: AnalyticsFreshnessSnapshot;
    gsc: AnalyticsFreshnessSnapshot;
  };
  health: {
    status: 'healthy' | 'degraded' | 'failed' | 'unavailable';
    message: string;
    confidence: 'high' | 'medium' | 'low' | 'none';
  };
  ingestion_history: AnalyticsHealthRun[];
  degraded_history: Array<{
    source: 'ga4' | 'gsc';
    status: string;
    occurred_at: string | null;
    error_message: string | null;
  }>;
  operational_metrics: {
    ga_events_last_30_days: number;
    gsc_rows_ingested: number;
    total_retries_last_10_runs: number;
    avg_duration_ms_last_10_runs: number | null;
    quota_or_api_errors: string[];
  };
  correlation: AnalyticsCorrelationContext;
  gsc_intelligence: GscSeoIntelligence | null;
  enterprise?: {
    cache_status: AnalyticsEnterpriseSnapshot['cache_status'];
    trust_score: number;
    completeness_score: number;
    opportunity_count: number;
    provider_uptime: AnalyticsEnterpriseSnapshot['observability']['provider_uptime'];
    quota_warnings: string[];
  };
};

function durationMs(startedAt: string | null, completedAt: string | null): number | null {
  if (!startedAt || !completedAt) return null;
  const start = new Date(startedAt).getTime();
  const end = new Date(completedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return end - start;
}

function healthStatus(ga: AnalyticsFreshnessSnapshot, gsc: AnalyticsFreshnessSnapshot): AnalyticsHealthSummary['health'] {
  if (ga.classification === 'failed' || gsc.classification === 'failed') {
    return { status: 'failed', message: 'One or more analytics syncs are failing.', confidence: 'low' };
  }
  if (ga.classification === 'unavailable' && gsc.classification === 'unavailable') {
    return { status: 'unavailable', message: 'No trusted analytics data is available.', confidence: 'none' };
  }
  if (ga.classification === 'stale' || gsc.classification === 'stale' || ga.classification === 'aging' || gsc.classification === 'aging') {
    return { status: 'degraded', message: 'Analytics data is usable but freshness is degraded.', confidence: 'medium' };
  }
  return { status: 'healthy', message: 'GA and GSC analytics are operational.', confidence: 'high' };
}

export async function getAnalyticsHealthSummary(companyId: string): Promise<AnalyticsHealthSummary> {
  const [gaReadiness, gscSummary, runs, enterpriseSnapshot] = await Promise.all([
    getAnalyticsReadiness(companyId).catch(() => null),
    getOmnivyraGscDashboardSummary(30).catch(() => null),
    supabase
      .from('ingestion_runs')
      .select('source, status, started_at, completed_at, records_processed, records_inserted, records_updated, retry_count, error_message')
      .eq('company_id', companyId)
      .in('source', ['ga4', 'gsc'])
      .order('started_at', { ascending: false })
      .limit(10),
    getAnalyticsEnterpriseSnapshot(companyId).catch(() => null),
  ]);

  const runRows = ((runs.data ?? []) as any[]).map((row): AnalyticsHealthRun => ({
    source: row.source,
    status: row.status,
    started_at: row.started_at ?? null,
    completed_at: row.completed_at ?? null,
    duration_ms: durationMs(row.started_at ?? null, row.completed_at ?? null),
    records_processed: Number(row.records_processed ?? 0),
    records_inserted: Number(row.records_inserted ?? 0),
    records_updated: Number(row.records_updated ?? 0),
    retry_count: Number(row.retry_count ?? 0),
    error_message: row.error_message ?? null,
  }));

  const gaFreshness = classifyAnalyticsFreshness({
    source: 'ga',
    lastSuccessfulSyncAt: gaReadiness?.last_successful_ingestion_at ?? null,
    status: gaReadiness?.status ?? null,
    rowsOrEvents: gaReadiness?.events_last_30_days ?? 0,
  });
  const gscFreshness = classifyAnalyticsFreshness({
    source: 'gsc',
    lastSuccessfulSyncAt: gscSummary?.status.last_sync ?? null,
    status: gscSummary?.status.status ?? null,
    errorMessage: gscSummary?.status.error_message ?? null,
    rowsOrEvents: gscSummary?.status.rows_ingested ?? 0,
  });

  const durations = runRows.map((row) => row.duration_ms).filter((value): value is number => typeof value === 'number');
  const quotaOrApiErrors = runRows
    .map((row) => row.error_message)
    .filter((message): message is string => Boolean(message && /(quota|429|api|timeout|rate)/i.test(message)));

  return {
    company_id: companyId,
    generated_at: new Date().toISOString(),
    freshness: {
      ga: gaFreshness,
      gsc: gscFreshness,
    },
    health: healthStatus(gaFreshness, gscFreshness),
    ingestion_history: runRows,
    degraded_history: runRows
      .filter((row) => row.status === 'failed' || row.status === 'partial' || row.error_message)
      .map((row) => ({
        source: row.source,
        status: row.status,
        occurred_at: row.completed_at ?? row.started_at,
        error_message: row.error_message,
      })),
    operational_metrics: {
      ga_events_last_30_days: gaReadiness?.events_last_30_days ?? 0,
      gsc_rows_ingested: gscSummary?.status.rows_ingested ?? 0,
      total_retries_last_10_runs: runRows.reduce((sum, row) => sum + row.retry_count, 0),
      avg_duration_ms_last_10_runs: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : null,
      quota_or_api_errors: quotaOrApiErrors.slice(0, 5),
    },
    correlation: enterpriseSnapshot?.correlation ?? await buildAnalyticsCorrelationContext(companyId).catch(() => ({ provenance: { ga: 'missing' as const, gsc: 'missing' as const }, insights: [] })),
    gsc_intelligence: enterpriseSnapshot?.gsc_intelligence ?? await buildGscSeoIntelligence(companyId, 30).catch(() => null),
    enterprise: enterpriseSnapshot ? {
      cache_status: enterpriseSnapshot.cache_status,
      trust_score: enterpriseSnapshot.governance.trust_score,
      completeness_score: enterpriseSnapshot.governance.completeness_score,
      opportunity_count: enterpriseSnapshot.opportunities.length,
      provider_uptime: enterpriseSnapshot.observability.provider_uptime,
      quota_warnings: enterpriseSnapshot.observability.quota_warnings,
    } : undefined,
  };
}
