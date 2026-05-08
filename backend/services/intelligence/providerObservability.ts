// Provider observability.
//
// Reads ProviderHistoryRecord rows over a recent window and computes:
//   - uptime % (measured outcomes / total)
//   - mean/p95 latency
//   - error rate
//   - cache hit ratio
//   - quota pressure (rate_limited / quota_exceeded ratio)
//   - freshness lag (hours since last successful call)
//
// Callers surface these metrics in an admin dashboard so the platform
// "knows when intelligence quality itself is degraded" — exactly the
// language in the Phase 5 prompt.

import type { ProviderHistoryRecord } from './historicalPersistence';
import { getHistoricalStore } from './historicalPersistence';
import { snapshotBreakers } from './circuitBreaker';

export type ProviderHealth = {
  provider_id: string;
  state: 'healthy' | 'degraded' | 'down' | 'no_data';
  uptime_pct: number | null;
  total_calls: number;
  measured_calls: number;
  error_calls: number;
  cache_hits: number;
  cache_hit_ratio: number | null;
  mean_latency_ms: number | null;
  p95_latency_ms: number | null;
  quota_pressure_ratio: number | null;
  last_successful_at: string | null;
  freshness_lag_hours: number | null;
  circuit_breaker_state: 'closed' | 'open' | 'half_open' | 'unknown';
};

export type ProviderObservability = {
  observed_at: string;
  window_hours: number;
  providers: ProviderHealth[];
};

function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[idx];
}

function classifyState(health: Omit<ProviderHealth, 'state'>): ProviderHealth['state'] {
  if (health.total_calls === 0) return 'no_data';
  const uptime = health.uptime_pct ?? 0;
  if (health.circuit_breaker_state === 'open' || uptime < 30) return 'down';
  if (uptime < 80 || (health.freshness_lag_hours ?? 0) > 48) return 'degraded';
  return 'healthy';
}

export async function buildProviderObservability(params: {
  companyId: string;
  windowHours?: number;
}): Promise<ProviderObservability> {
  const window = params.windowHours ?? 168; // default: 7 days
  const from = new Date(Date.now() - window * 60 * 60 * 1000).toISOString();
  const store = getHistoricalStore();
  const rows = await store.loadProviderHistory({
    company_id: params.companyId,
    from,
    limit: 5000,
  });
  const breakerByProvider = new Map(snapshotBreakers().map((b) => [b.provider_id, b.state]));

  const grouped = new Map<string, ProviderHistoryRecord[]>();
  for (const row of rows) {
    const list = grouped.get(row.provider_id) ?? [];
    list.push(row);
    grouped.set(row.provider_id, list);
  }

  const observedAt = new Date().toISOString();
  const providers: ProviderHealth[] = [];
  for (const [provider_id, list] of grouped.entries()) {
    const total = list.length;
    const measured = list.filter((r) => r.outcome === 'measured');
    const errors = list.filter((r) => r.outcome !== 'measured');
    const cacheHits = list.filter((r) => r.cache_hit);
    const latencyValues = measured.map((r) => r.latency_ms).filter((n): n is number => typeof n === 'number');
    const lastSuccess = measured.length > 0
      ? measured.reduce((latest, r) => (r.observed_at > latest ? r.observed_at : latest), measured[0].observed_at)
      : null;
    const freshnessLag = lastSuccess
      ? Math.max(0, (Date.now() - new Date(lastSuccess).getTime()) / (1000 * 60 * 60))
      : null;
    const quotaErrors = errors.filter((r) => r.outcome === 'rate_limited' || r.outcome === 'quota_exceeded').length;

    const partial: Omit<ProviderHealth, 'state'> = {
      provider_id,
      uptime_pct: total === 0 ? null : Math.round((measured.length / total) * 100),
      total_calls: total,
      measured_calls: measured.length,
      error_calls: errors.length,
      cache_hits: cacheHits.length,
      cache_hit_ratio: total === 0 ? null : Number((cacheHits.length / total).toFixed(3)),
      mean_latency_ms: latencyValues.length === 0
        ? null
        : Math.round(latencyValues.reduce((s, v) => s + v, 0) / latencyValues.length),
      p95_latency_ms: latencyValues.length === 0 ? null : Math.round(p95(latencyValues)),
      quota_pressure_ratio: total === 0 ? null : Number((quotaErrors / total).toFixed(3)),
      last_successful_at: lastSuccess,
      freshness_lag_hours: freshnessLag != null ? Math.round(freshnessLag * 10) / 10 : null,
      circuit_breaker_state:
        (breakerByProvider.get(provider_id) as ProviderHealth['circuit_breaker_state']) ?? 'unknown',
    };
    providers.push({ ...partial, state: classifyState(partial) });
  }

  // Include circuit-breaker entries that have no recent provider history
  // (e.g., breakers tripped during a previous run).
  for (const breaker of snapshotBreakers()) {
    if (grouped.has(breaker.provider_id)) continue;
    const partial: Omit<ProviderHealth, 'state'> = {
      provider_id: breaker.provider_id,
      uptime_pct: null,
      total_calls: 0,
      measured_calls: 0,
      error_calls: 0,
      cache_hits: 0,
      cache_hit_ratio: null,
      mean_latency_ms: null,
      p95_latency_ms: null,
      quota_pressure_ratio: null,
      last_successful_at: null,
      freshness_lag_hours: null,
      circuit_breaker_state: breaker.state,
    };
    providers.push({ ...partial, state: classifyState(partial) });
  }

  return {
    observed_at: observedAt,
    window_hours: window,
    providers: providers.sort((a, b) => a.provider_id.localeCompare(b.provider_id)),
  };
}
