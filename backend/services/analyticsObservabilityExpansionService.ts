import type { AnalyticsEnterpriseSnapshot } from './analyticsEnterpriseSnapshotService';

export type AnalyticsOperationalAlert = {
  type: 'ingestion_anomaly' | 'provider_sla' | 'schema_drift' | 'quota_forecast' | 'sync_regression' | 'cache_health' | 'snapshot_integrity';
  severity: 'high' | 'medium' | 'low';
  message: string;
  evidence: Record<string, unknown>;
};

export type AnalyticsObservabilityExpansion = {
  alerts: AnalyticsOperationalAlert[];
  provider_sla: {
    ga_success_rate: number;
    gsc_success_rate: number;
    status: 'healthy' | 'watch' | 'risk';
  };
  cache_health: {
    status: 'healthy' | 'miss' | 'expired';
    cache_status: AnalyticsEnterpriseSnapshot['cache_status'];
  };
};

export function buildAnalyticsObservabilityExpansion(snapshot: AnalyticsEnterpriseSnapshot): AnalyticsObservabilityExpansion {
  const alerts: AnalyticsOperationalAlert[] = [];
  const runs = snapshot.observability.ingestion_history;
  const failedRuns = runs.filter((run) => run.status === 'failed' || run.error_message);
  const retryTotal = runs.reduce((sum, run) => sum + run.retry_count, 0);

  if (failedRuns.length > 0) {
    alerts.push({
      type: 'ingestion_anomaly',
      severity: failedRuns.length >= 3 ? 'high' : 'medium',
      message: 'Recent analytics ingestion has failures or partial errors.',
      evidence: { failed_runs: failedRuns.length },
    });
  }

  if (retryTotal >= 3) {
    alerts.push({
      type: 'quota_forecast',
      severity: retryTotal >= 8 ? 'high' : 'medium',
      message: 'Retry volume is elevated; monitor provider quota and latency.',
      evidence: { retry_total: retryTotal },
    });
  }

  if (snapshot.cache_status === 'computed') {
    alerts.push({
      type: 'cache_health',
      severity: 'low',
      message: 'Snapshot was freshly computed; cache will warm after this request.',
      evidence: { cache_status: snapshot.cache_status },
    });
  }

  if (snapshot.governance.trust_score < 60) {
    alerts.push({
      type: 'snapshot_integrity',
      severity: 'high',
      message: 'Analytics trust score is below enterprise decision threshold.',
      evidence: { trust_score: snapshot.governance.trust_score },
    });
  }

  const ga = snapshot.observability.provider_uptime.ga_success_rate;
  const gsc = snapshot.observability.provider_uptime.gsc_success_rate;
  return {
    alerts,
    provider_sla: {
      ga_success_rate: ga,
      gsc_success_rate: gsc,
      status: ga >= 0.9 && gsc >= 0.9 ? 'healthy' : ga >= 0.7 || gsc >= 0.7 ? 'watch' : 'risk',
    },
    cache_health: {
      status: snapshot.cache_status === 'memory_hit' || snapshot.cache_status === 'database_hit' ? 'healthy' : 'miss',
      cache_status: snapshot.cache_status,
    },
  };
}
