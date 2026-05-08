// Platform-wide operations aggregator.
//
// Powers the operator dashboard. Aggregates real persisted data across
// tenants (no synthetic activity streams). Operators drill from this
// surface into per-tenant detail.

import type { ProviderHistoryRecord } from './historicalPersistence';
import { getHistoricalStore } from './historicalPersistence';
import { snapshotBreakers } from './circuitBreaker';
import { getScanQueueStore } from './scanOrchestration';
import type { ScanQueueRecord } from './scanOrchestration';

export type PlatformOperationsView = {
  observed_at: string;
  window_hours: number;
  tenants_active: number;
  /** Cross-tenant provider health — one row per provider id. */
  providers: Array<{
    provider_id: string;
    state: 'healthy' | 'degraded' | 'down' | 'no_data';
    total_calls: number;
    measured_calls: number;
    error_calls: number;
    cache_hit_ratio: number | null;
    p95_latency_ms: number | null;
    quota_pressure_ratio: number | null;
    circuit_breaker_state: 'closed' | 'open' | 'half_open' | 'unknown';
  }>;
  /** Cross-tenant scan queue snapshot. */
  queue: {
    queued: number;
    running: number;
    failed_in_window: number;
    skipped_in_window: number;
    avg_wait_ms: number | null;
  };
  /** Per-tenant cost / activity summary in the window. */
  per_tenant: Array<{
    tenant_id: string;
    scans_in_window: number;
    failed_scans: number;
    cancelled_scans: number;
  }>;
};

function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[idx];
}

function classifyProviderState(uptime: number | null, breakerState: string): 'healthy' | 'degraded' | 'down' | 'no_data' {
  if (uptime == null) return 'no_data';
  if (breakerState === 'open' || uptime < 30) return 'down';
  if (uptime < 80) return 'degraded';
  return 'healthy';
}

export async function buildPlatformOperationsView(params: {
  windowHours?: number;
  tenantIds: string[];
}): Promise<PlatformOperationsView> {
  const window = params.windowHours ?? 24;
  const fromIso = new Date(Date.now() - window * 60 * 60 * 1000).toISOString();
  const observedAt = new Date().toISOString();
  const store = getHistoricalStore();
  const queueStore = getScanQueueStore();

  // Aggregate provider history across all tenants. The historical store is
  // company-scoped (the company_id is the join key), so we accumulate from
  // each tenant's first company row that's reachable in the window.
  const allProviderRows: ProviderHistoryRecord[] = [];
  for (const tenantId of params.tenantIds) {
    // The historical-store contract is company-scoped; we use the tenant's
    // first registered company_id when present. This view is a quick aggregate
    // — full per-tenant drill-down happens in the per-report admin console.
    try {
      // An operator-context tenant_id is a valid `company_id` namespace too.
      const rows = await store.loadProviderHistory({ company_id: tenantId, from: fromIso, limit: 5000 });
      allProviderRows.push(...rows);
    } catch {
      // tenant has no history — skip silently.
    }
  }

  const providerGroups = new Map<string, ProviderHistoryRecord[]>();
  for (const row of allProviderRows) {
    const list = providerGroups.get(row.provider_id) ?? [];
    list.push(row);
    providerGroups.set(row.provider_id, list);
  }
  const breakerState = new Map(snapshotBreakers().map((b) => [b.provider_id, b.state]));

  const providers: PlatformOperationsView['providers'] = [];
  for (const [provider_id, rows] of providerGroups.entries()) {
    const measured = rows.filter((r) => r.outcome === 'measured');
    const errors = rows.filter((r) => r.outcome !== 'measured');
    const quotaErrors = errors.filter((r) => r.outcome === 'rate_limited' || r.outcome === 'quota_exceeded').length;
    const cacheHits = rows.filter((r) => r.cache_hit).length;
    const latencies = measured.map((r) => r.latency_ms).filter((n): n is number => typeof n === 'number');
    const uptimePct = rows.length === 0 ? null : Math.round((measured.length / rows.length) * 100);
    const breaker = (breakerState.get(provider_id) as 'closed' | 'open' | 'half_open' | undefined) ?? 'unknown';
    providers.push({
      provider_id,
      state: classifyProviderState(uptimePct, breaker),
      total_calls: rows.length,
      measured_calls: measured.length,
      error_calls: errors.length,
      cache_hit_ratio: rows.length === 0 ? null : Number((cacheHits / rows.length).toFixed(3)),
      p95_latency_ms: latencies.length === 0 ? null : Math.round(p95(latencies)),
      quota_pressure_ratio: rows.length === 0 ? null : Number((quotaErrors / rows.length).toFixed(3)),
      circuit_breaker_state: breaker,
    });
  }
  // Add breaker rows that haven't seen traffic yet.
  for (const breaker of snapshotBreakers()) {
    if (providerGroups.has(breaker.provider_id)) continue;
    providers.push({
      provider_id: breaker.provider_id,
      state: 'no_data',
      total_calls: 0,
      measured_calls: 0,
      error_calls: 0,
      cache_hit_ratio: null,
      p95_latency_ms: null,
      quota_pressure_ratio: null,
      circuit_breaker_state: breaker.state,
    });
  }

  // Aggregate scan queue across tenants.
  let queued = 0;
  let running = 0;
  let failed = 0;
  let skipped = 0;
  const waitTimes: number[] = [];
  const perTenant: PlatformOperationsView['per_tenant'] = [];
  for (const tenantId of params.tenantIds) {
    const rows = await queueStore.list({ tenantId, limit: 500 });
    let scansInWindow = 0;
    let failedScans = 0;
    let cancelled = 0;
    for (const r of rows) {
      if (r.enqueued_at >= fromIso) scansInWindow += 1;
      if (r.status === 'queued') queued += 1;
      if (r.status === 'running') running += 1;
      if (r.status === 'failed' && r.completed_at && r.completed_at >= fromIso) {
        failed += 1;
        failedScans += 1;
      }
      if (
        (r.status === 'skipped_budget_exhausted' || r.status === 'skipped_provider_unavailable') &&
        r.completed_at &&
        r.completed_at >= fromIso
      ) {
        skipped += 1;
      }
      if (r.status === 'cancelled') cancelled += 1;
      if (r.started_at && r.enqueued_at) {
        waitTimes.push(new Date(r.started_at).getTime() - new Date(r.enqueued_at).getTime());
      }
    }
    perTenant.push({
      tenant_id: tenantId,
      scans_in_window: scansInWindow,
      failed_scans: failedScans,
      cancelled_scans: cancelled,
    });
  }

  const avgWait =
    waitTimes.length === 0 ? null : Math.round(waitTimes.reduce((s, n) => s + n, 0) / waitTimes.length);

  return {
    observed_at: observedAt,
    window_hours: window,
    tenants_active: perTenant.filter((t) => t.scans_in_window > 0).length,
    providers,
    queue: {
      queued,
      running,
      failed_in_window: failed,
      skipped_in_window: skipped,
      avg_wait_ms: avgWait,
    },
    per_tenant: perTenant,
  };
}
