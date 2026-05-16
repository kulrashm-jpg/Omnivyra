/**
 * Phase 7 — Operational resilience diagnostics.
 *
 * Single read-only aggregate for the resilience dashboard. Returns:
 *   • DLQ counts per kind
 *   • Projection sync state per kind (lag + retry count)
 *   • Execution failure / partial counts (rolling window)
 *   • Connector degradation counts (rolling window)
 *   • Replay drift detection (most-stale projection cursor)
 *   • Projection consistency check (compares last lifecycle write vs cursor)
 *
 * Deterministic. Bounded operational windows. Tenant-scoped.
 */

import { ownedDbTable } from '../db/writeOwner';

export type OperationalHealthSnapshot = {
  organization_id: string;
  generated_at: string;
  window_hours: number;
  dlq_counts: { execution_failure: number; projection: number; moderation_block: number };
  projection_sync: Array<{
    projection_kind: string;
    cursor_position: string | null;
    pending_retry_count: number;
    last_synced_at: string | null;
    lag_seconds: number | null;
  }>;
  execution_health: { completed: number; partial: number; failed: number };
  connector_degradation: { rate_limited_runs: number; degraded_sources: number };
  replay_drift: { stalest_projection_kind: string | null; stalest_lag_seconds: number | null };
  consistency: { lifecycle_init_lag_seconds: number | null; lifecycle_cursor_position: string | null };
};

export async function getOperationalHealthSnapshot(
  organizationId: string,
  windowHours = 24 * 7,
): Promise<OperationalHealthSnapshot> {
  const now = new Date();
  const since = new Date(now.getTime() - windowHours * 60 * 60 * 1000).toISOString();

  // DLQ counts
  const [execFailed, projExhausted, modBlocked] = await Promise.all([
    ownedDbTable('listening_executions')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('execution_status', 'failed')
      .gt('created_at', since),
    ownedDbTable('projection_sync_state')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .gte('pending_retry_count', 5),
    ownedDbTable('moderation_decisions')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('outcome', 'blocked')
      .gt('created_at', since),
  ]);

  // Projection sync states
  const { data: projRows } = await ownedDbTable('projection_sync_state')
    .select('projection_kind, cursor_position, pending_retry_count, last_synced_at')
    .eq('organization_id', organizationId);

  const projectionRows = (projRows ?? []) as Array<{
    projection_kind: string;
    cursor_position: string | null;
    pending_retry_count: number;
    last_synced_at: string | null;
  }>;

  const projection_sync = projectionRows.map((r) => ({
    projection_kind: r.projection_kind,
    cursor_position: r.cursor_position,
    pending_retry_count: r.pending_retry_count,
    last_synced_at: r.last_synced_at,
    lag_seconds: r.last_synced_at ? Math.max(0, Math.floor((now.getTime() - new Date(r.last_synced_at).getTime()) / 1000)) : null,
  }));

  const stalest = projection_sync.reduce<{ kind: string | null; lag: number | null }>(
    (acc, r) => (r.lag_seconds != null && (acc.lag == null || r.lag_seconds > acc.lag) ? { kind: r.projection_kind, lag: r.lag_seconds } : acc),
    { kind: null, lag: null },
  );

  // Execution health
  const { data: execStatuses } = await ownedDbTable('listening_executions')
    .select('execution_status, ingestion_stats')
    .eq('organization_id', organizationId)
    .gt('created_at', since);
  let completed = 0;
  let partial = 0;
  let failed = 0;
  let rateLimitedRuns = 0;
  for (const e of (execStatuses ?? []) as Array<{ execution_status: string; ingestion_stats: Record<string, number> | null }>) {
    if (e.execution_status === 'completed') completed += 1;
    if (e.execution_status === 'partial') partial += 1;
    if (e.execution_status === 'failed') failed += 1;
    const rl = Number(e.ingestion_stats?.rate_limit_pauses ?? 0);
    if (rl > 0) rateLimitedRuns += 1;
  }

  // Degraded sources — latest health snapshot per source ∈ {degraded, unstable}
  const { data: healthRows } = await ownedDbTable('source_health_states')
    .select('listening_source_id, health_state, computed_at')
    .eq('organization_id', organizationId)
    .order('computed_at', { ascending: false })
    .limit(2000);
  const seenSources = new Set<string>();
  let degradedSources = 0;
  for (const r of (healthRows ?? []) as Array<{ listening_source_id: string; health_state: string }>) {
    if (seenSources.has(r.listening_source_id)) continue;
    seenSources.add(r.listening_source_id);
    if (r.health_state === 'degraded' || r.health_state === 'unstable') degradedSources += 1;
  }

  // Consistency: did lifecycle init lag? Compare latest opportunity_feed_item
  // created_at to the lifecycle cursor.
  const { data: lastOpp } = await ownedDbTable('opportunity_feed_items')
    .select('created_at')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const lifecycleSyncRow = projection_sync.find((r) => r.projection_kind === 'lifecycle');
  let lifecycleInitLag: number | null = null;
  if (lastOpp && (lastOpp as { created_at?: string }).created_at && lifecycleSyncRow?.cursor_position) {
    const oppAt = new Date((lastOpp as { created_at: string }).created_at).getTime();
    const cursorAt = new Date(lifecycleSyncRow.cursor_position).getTime();
    if (Number.isFinite(oppAt) && Number.isFinite(cursorAt)) {
      lifecycleInitLag = Math.max(0, Math.floor((oppAt - cursorAt) / 1000));
    }
  }

  return {
    organization_id: organizationId,
    generated_at: now.toISOString(),
    window_hours: windowHours,
    dlq_counts: {
      execution_failure: Number((execFailed as unknown as { count?: number } | null)?.count ?? 0),
      projection: Number((projExhausted as unknown as { count?: number } | null)?.count ?? 0),
      moderation_block: Number((modBlocked as unknown as { count?: number } | null)?.count ?? 0),
    },
    projection_sync,
    execution_health: { completed, partial, failed },
    connector_degradation: { rate_limited_runs: rateLimitedRuns, degraded_sources: degradedSources },
    replay_drift: { stalest_projection_kind: stalest.kind, stalest_lag_seconds: stalest.lag },
    consistency: {
      lifecycle_init_lag_seconds: lifecycleInitLag,
      lifecycle_cursor_position: lifecycleSyncRow?.cursor_position ?? null,
    },
  };
}
