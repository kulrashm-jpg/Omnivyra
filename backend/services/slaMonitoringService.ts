/**
 * Phase 8 — SLA monitoring.
 *
 * Deterministic computation over existing data (no autonomous monitor
 * loop). The service exposes two surfaces:
 *   • `computeSlaSnapshot` — read-only: derives observed values per SLA
 *     kind for the given rolling window. Returns the verdict per kind.
 *   • `recordSlaBreach` — operator-triggered: persists a breach row when
 *     a verdict exceeds the configured threshold.
 *
 * Hard guarantees:
 *   • Tenant-scoped, bounded window.
 *   • Thresholds are deterministic constants from the type module.
 *   • No autonomous "raise SLA breach" loop. The compute is called by
 *     the API; the operator decides whether to record the breach.
 */

import { ownedDbTable } from '../db/writeOwner';
import type { SlaBreach, SlaKind, SlaSeverity } from '../types/sla';
import { SLA_DEFAULT_THRESHOLDS, SLA_DEFAULT_WINDOW_HOURS } from '../types/sla';

export type SlaVerdict = {
  sla_kind: SlaKind;
  observed_value: number;
  warn_threshold: number;
  breach_threshold: number;
  unit: 'ms' | 'pct' | 'percent_complete';
  severity: 'ok' | SlaSeverity;
  rationale: string;
  window_start: string;
  window_end: string;
};

function avgDurationMs(rows: Array<{ from: string | null; to: string | null }>): number {
  let total = 0;
  let n = 0;
  for (const r of rows) {
    if (!r.from || !r.to) continue;
    const a = new Date(r.from).getTime();
    const b = new Date(r.to).getTime();
    if (Number.isFinite(a) && Number.isFinite(b) && b >= a) {
      total += (b - a);
      n += 1;
    }
  }
  return n > 0 ? Math.round(total / n) : 0;
}

function classify(kind: SlaKind, observed: number): SlaVerdict {
  const thr = SLA_DEFAULT_THRESHOLDS[kind];
  let severity: SlaVerdict['severity'] = 'ok';
  let rationale = `Observed ${observed} ${thr.unit}; warn ${thr.warn}; breach ${thr.breach}.`;
  if (thr.unit === 'percent_complete') {
    // Higher is better. observed in [0,1].
    if (observed < thr.breach) {
      severity = 'breach';
      rationale = `Reliability ${(observed * 100).toFixed(0)}% below breach threshold ${(thr.breach * 100).toFixed(0)}%.`;
    } else if (observed < thr.warn) {
      severity = 'warn';
      rationale = `Reliability ${(observed * 100).toFixed(0)}% below warn threshold ${(thr.warn * 100).toFixed(0)}%.`;
    }
  } else {
    // Lower is better.
    if (observed >= thr.breach) {
      severity = 'breach';
      rationale = `Observed ${observed}ms exceeds breach threshold ${thr.breach}ms.`;
    } else if (observed >= thr.warn) {
      severity = 'warn';
      rationale = `Observed ${observed}ms exceeds warn threshold ${thr.warn}ms.`;
    }
  }
  return {
    sla_kind: kind,
    observed_value: observed,
    warn_threshold: thr.warn,
    breach_threshold: thr.breach,
    unit: thr.unit,
    severity,
    rationale,
    window_start: '',
    window_end: '',
  };
}

export type SlaSnapshot = {
  organization_id: string;
  window_start: string;
  window_end: string;
  verdicts: SlaVerdict[];
};

export async function computeSlaSnapshot(
  organizationId: string,
  windowHours: number = SLA_DEFAULT_WINDOW_HOURS,
): Promise<SlaSnapshot> {
  const end = new Date();
  const start = new Date(end.getTime() - windowHours * 60 * 60 * 1000);
  const since = start.toISOString();
  const verdicts: SlaVerdict[] = [];

  // execution_latency: avg(completed_at - started_at) for listening_executions
  {
    const { data } = await ownedDbTable('listening_executions')
      .select('started_at, completed_at')
      .eq('organization_id', organizationId)
      .gt('created_at', since)
      .eq('execution_status', 'completed');
    const observed = avgDurationMs(
      ((data ?? []) as Array<{ started_at: string | null; completed_at: string | null }>).map(
        (r) => ({ from: r.started_at, to: r.completed_at })
      )
    );
    verdicts.push({ ...classify('execution_latency', observed), window_start: since, window_end: end.toISOString() });
  }

  // projection_latency: most-recent projection_sync_state.last_synced_at age (max)
  {
    const { data } = await ownedDbTable('projection_sync_state')
      .select('last_synced_at')
      .eq('organization_id', organizationId);
    let maxAge = 0;
    for (const r of (data ?? []) as Array<{ last_synced_at: string | null }>) {
      if (!r.last_synced_at) continue;
      const age = end.getTime() - new Date(r.last_synced_at).getTime();
      if (Number.isFinite(age) && age > maxAge) maxAge = age;
    }
    verdicts.push({ ...classify('projection_latency', maxAge), window_start: since, window_end: end.toISOString() });
  }

  // moderation_latency: ingestion_stats.fetch_duration_ms is a proxy (per-run); avg.
  {
    const { data } = await ownedDbTable('listening_executions')
      .select('ingestion_stats')
      .eq('organization_id', organizationId)
      .gt('created_at', since)
      .in('execution_status', ['completed', 'partial']);
    const arr = ((data ?? []) as Array<{ ingestion_stats: Record<string, number> | null }>).flatMap((r) =>
      r.ingestion_stats?.fetch_duration_ms != null ? [Number(r.ingestion_stats.fetch_duration_ms)] : [],
    );
    const observed = arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
    verdicts.push({ ...classify('moderation_latency', observed), window_start: since, window_end: end.toISOString() });
  }

  // replay_recovery_latency: median (preview_at - created_at) for completed replay_operations
  {
    const { data } = await ownedDbTable('replay_operations')
      .select('created_at, executed_at')
      .eq('organization_id', organizationId)
      .gt('created_at', since)
      .eq('status', 'complete');
    const rows = ((data ?? []) as Array<{ created_at: string; executed_at: string | null }>).map((r) => ({ from: r.created_at, to: r.executed_at }));
    const observed = avgDurationMs(rows);
    verdicts.push({ ...classify('replay_recovery_latency', observed), window_start: since, window_end: end.toISOString() });
  }

  // realtime_delivery_latency: Phase 8 lacks server-recorded delivery times.
  // Use the same projection-sync lag as a proxy until a future phase
  // records actual broadcast latency on the publisher side.
  verdicts.push({ ...classify('realtime_delivery_latency', verdicts[1]?.observed_value ?? 0), window_start: since, window_end: end.toISOString() });

  // connector_reliability: completed / (completed + failed) over the window.
  {
    const { data } = await ownedDbTable('listening_executions')
      .select('execution_status')
      .eq('organization_id', organizationId)
      .gt('created_at', since);
    let ok = 0; let fail = 0;
    for (const r of (data ?? []) as Array<{ execution_status: string }>) {
      if (r.execution_status === 'completed' || r.execution_status === 'partial') ok += 1;
      else if (r.execution_status === 'failed') fail += 1;
    }
    const total = ok + fail;
    const ratio = total === 0 ? 1 : ok / total;
    verdicts.push({ ...classify('connector_reliability', Number(ratio.toFixed(3))), window_start: since, window_end: end.toISOString() });
  }

  return {
    organization_id: organizationId,
    window_start: since,
    window_end: end.toISOString(),
    verdicts,
  };
}

export async function recordSlaBreach(input: {
  organizationId: string;
  verdict: SlaVerdict;
}): Promise<SlaBreach | null> {
  if (input.verdict.severity === 'ok') return null;
  const sevForRecord: SlaSeverity = input.verdict.severity === 'warn' ? 'warn' : 'breach';
  const { data, error } = await ownedDbTable('sla_breaches')
    .insert({
      organization_id: input.organizationId,
      sla_kind: input.verdict.sla_kind,
      severity: sevForRecord,
      observed_value: input.verdict.observed_value,
      threshold_value: sevForRecord === 'warn' ? input.verdict.warn_threshold : input.verdict.breach_threshold,
      window_start: input.verdict.window_start,
      window_end: input.verdict.window_end,
      rationale: input.verdict.rationale,
    })
    .select('*')
    .single();
  if (error || !data) throw new Error(`sla_breach_insert_failed:${error?.message ?? 'unknown'}`);
  return data as SlaBreach;
}

export async function listSlaBreaches(
  organizationId: string,
  options?: { kind?: SlaKind; limit?: number },
): Promise<SlaBreach[]> {
  let q = ownedDbTable('sla_breaches')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(Math.min(500, Math.max(1, options?.limit ?? 100)));
  if (options?.kind) q = q.eq('sla_kind', options.kind);
  const { data, error } = await q;
  if (error) throw new Error(`sla_breaches_list_failed:${error.message}`);
  return (data as SlaBreach[]) ?? [];
}
