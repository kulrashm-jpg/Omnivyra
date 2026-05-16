/**
 * Phase 12 — Final observability convergence layer.
 *
 * Unified deterministic projection over runtime + rollout + SLA +
 * semantic + replay + safeguard + governance signals. Produces a
 * single timeline of unified health states and a `drift_detected`
 * flag for the requested window.
 *
 * Hard guarantees:
 *   • Operator-triggered.
 *   • Bounded window (default 24h, max 30d).
 *   • Deterministic aggregation: same inputs → same projection.
 *   • Read-only over Phase 3-11 owned tables.
 *   • Tenant-first.
 */

import { ownedDbTable } from '../db/writeOwner';
import {
  OBSERVABILITY_DEFAULT_WINDOW_HOURS,
  OBSERVABILITY_MAX_WINDOW_HOURS,
  type ConvergenceTimelinePoint,
  type ObservabilityConvergenceProjection,
  type ObservabilityProjectionKind,
  type ObservabilityUnifiedHealthState,
  type ResilienceOverlay,
} from '../types/observabilityConvergence';
import { publishRealtime } from './realtimePublisherService';
import { publishObservabilityConvergenceUpdated } from '../events/listeningEvents';

function bounds(start?: string, end?: string): { start: string; end: string } {
  const endD = end ? new Date(end) : new Date();
  let startD = start ? new Date(start) : new Date(endD.getTime() - OBSERVABILITY_DEFAULT_WINDOW_HOURS * 3600_000);
  const maxStart = new Date(endD.getTime() - OBSERVABILITY_MAX_WINDOW_HOURS * 3600_000);
  if (startD < maxStart) startD = maxStart;
  return { start: startD.toISOString(), end: endD.toISOString() };
}

async function gatherTimelinePoints(
  organizationId: string,
  kind: ObservabilityProjectionKind,
  start: string,
  end: string,
): Promise<ConvergenceTimelinePoint[]> {
  switch (kind) {
    case 'runtime':
    case 'unified': {
      const { data } = await ownedDbTable('deployment_telemetry_snapshots')
        .select('created_at, snapshot_kind, health_state, derivation_explanation')
        .eq('organization_id', organizationId)
        .gte('created_at', start)
        .lt('created_at', end)
        .order('created_at', { ascending: true })
        .limit(200);
      const rows = (data as Array<{ created_at: string; snapshot_kind: string; health_state: ObservabilityUnifiedHealthState; derivation_explanation: string | null }>) ?? [];
      return rows.map((r) => ({ bucket: r.created_at, state: r.health_state, detail: `${r.snapshot_kind}: ${r.derivation_explanation ?? ''}` }));
    }
    case 'rollout': {
      const { data } = await ownedDbTable('production_rollout_plans')
        .select('updated_at, plan_name, status')
        .eq('organization_id', organizationId)
        .gte('updated_at', start)
        .lt('updated_at', end)
        .order('updated_at', { ascending: true })
        .limit(200);
      const rows = (data as Array<{ updated_at: string; plan_name: string; status: string }>) ?? [];
      return rows.map((r) => ({
        bucket: r.updated_at,
        state: r.status === 'complete' ? 'healthy' : r.status === 'failed' || r.status === 'rolled_back' ? 'critical' : r.status === 'executing' ? 'degraded' : 'unknown',
        detail: `${r.plan_name}: ${r.status}`,
      }));
    }
    case 'sla': {
      const { data } = await ownedDbTable('sla_breach_events')
        .select('created_at, metric_kind, severity')
        .eq('organization_id', organizationId)
        .gte('created_at', start)
        .lt('created_at', end)
        .order('created_at', { ascending: true })
        .limit(200);
      const rows = (data as Array<{ created_at: string; metric_kind: string; severity: string | null }>) ?? [];
      return rows.map((r) => ({ bucket: r.created_at, state: 'degraded' as ObservabilityUnifiedHealthState, detail: `SLA breach ${r.metric_kind} (${r.severity ?? '—'})` }));
    }
    case 'semantic': {
      const { data } = await ownedDbTable('semantic_indexing_partitions')
        .select('updated_at, status, failure_reason')
        .eq('organization_id', organizationId)
        .gte('updated_at', start)
        .lt('updated_at', end)
        .order('updated_at', { ascending: true })
        .limit(200);
      const rows = (data as Array<{ updated_at: string; status: string; failure_reason: string | null }>) ?? [];
      return rows.map((r) => ({ bucket: r.updated_at, state: r.status === 'failed' ? 'critical' : r.status === 'complete' ? 'healthy' : 'degraded', detail: `semantic: ${r.status}${r.failure_reason ? ` (${r.failure_reason})` : ''}` }));
    }
    case 'replay': {
      const { data } = await ownedDbTable('replay_partitions')
        .select('updated_at, status, failure_reason')
        .eq('organization_id', organizationId)
        .gte('updated_at', start)
        .lt('updated_at', end)
        .order('updated_at', { ascending: true })
        .limit(200);
      const rows = (data as Array<{ updated_at: string; status: string; failure_reason: string | null }>) ?? [];
      return rows.map((r) => ({ bucket: r.updated_at, state: r.status === 'failed' ? 'critical' : r.status === 'complete' ? 'healthy' : 'degraded', detail: `replay: ${r.status}${r.failure_reason ? ` (${r.failure_reason})` : ''}` }));
    }
    case 'safeguards': {
      const { data } = await ownedDbTable('operational_safety_rail_events')
        .select('created_at, rail_id, event_kind, new_state')
        .eq('organization_id', organizationId)
        .gte('created_at', start)
        .lt('created_at', end)
        .order('created_at', { ascending: true })
        .limit(200);
      const rows = (data as Array<{ created_at: string; event_kind: string; new_state: string }>) ?? [];
      return rows.map((r) => ({
        bucket: r.created_at,
        state: r.new_state === 'green' ? 'healthy' : r.new_state === 'triggered' || r.new_state === 'frozen' ? 'critical' : 'degraded',
        detail: `${r.event_kind} → ${r.new_state}`,
      }));
    }
    case 'governance': {
      const { data } = await ownedDbTable('governance_convergence_scores')
        .select('created_at, scope_kind, convergence_score, drift_score')
        .eq('organization_id', organizationId)
        .gte('created_at', start)
        .lt('created_at', end)
        .order('created_at', { ascending: true })
        .limit(200);
      const rows = (data as Array<{ created_at: string; scope_kind: string; convergence_score: number; drift_score: number }>) ?? [];
      return rows.map((r) => ({
        bucket: r.created_at,
        state: r.drift_score > 0.5 ? 'critical' : r.drift_score > 0.25 ? 'degraded' : 'healthy',
        detail: `${r.scope_kind}: conv=${r.convergence_score.toFixed(2)} drift=${r.drift_score.toFixed(2)}`,
      }));
    }
  }
}

function deriveUnifiedState(points: ConvergenceTimelinePoint[]): { state: ObservabilityUnifiedHealthState; drift: boolean } {
  if (points.length === 0) return { state: 'unknown', drift: false };
  const recent = points.slice(-25);
  const critical = recent.filter((p) => p.state === 'critical').length;
  const degraded = recent.filter((p) => p.state === 'degraded').length;
  const ratio = (critical + degraded) / recent.length;
  let state: ObservabilityUnifiedHealthState;
  if (critical / recent.length > 0.25) state = 'critical';
  else if (ratio > 0.25) state = 'degraded';
  else state = 'healthy';
  // Drift heuristic: state in the second half is worse than the first half.
  const half = Math.floor(recent.length / 2);
  if (half === 0) return { state, drift: false };
  const firstBad = recent.slice(0, half).filter((p) => p.state === 'critical' || p.state === 'degraded').length;
  const lastBad = recent.slice(half).filter((p) => p.state === 'critical' || p.state === 'degraded').length;
  const drift = lastBad > firstBad * 1.5;
  return { state, drift };
}

async function gatherResilienceOverlays(organizationId: string): Promise<ResilienceOverlay[]> {
  const overlays: ResilienceOverlay[] = [];
  try {
    const sg = await ownedDbTable('operational_safety_rails')
      .select('rail_kind, state')
      .eq('organization_id', organizationId)
      .neq('state', 'green');
    for (const r of (sg.data as Array<{ rail_kind: string; state: string }>) ?? []) {
      overlays.push({
        overlay_kind: `safety_rail_${r.rail_kind}`,
        severity: r.state === 'triggered' || r.state === 'frozen' ? 'critical' : 'warn',
        detail: `rail ${r.rail_kind} in state ${r.state}`,
      });
    }
    const sw = await ownedDbTable('platform_stabilization_windows')
      .select('window_name, freeze_scope')
      .eq('organization_id', organizationId)
      .eq('state', 'active')
      .limit(5);
    for (const r of (sw.data as Array<{ window_name: string; freeze_scope: string }>) ?? []) {
      overlays.push({ overlay_kind: 'stabilization_active', severity: 'warn', detail: `${r.window_name} scope=${r.freeze_scope}` });
    }
  } catch { /* best effort */ }
  return overlays;
}

export type GenerateObservabilityProjectionInput = {
  organizationId: string;
  projectionKind: ObservabilityProjectionKind;
  windowStart?: string;
  windowEnd?: string;
  generatedBy: string | null;
  metadata?: Record<string, unknown>;
};

export async function generateObservabilityProjection(
  input: GenerateObservabilityProjectionInput,
): Promise<ObservabilityConvergenceProjection> {
  const { start, end } = bounds(input.windowStart, input.windowEnd);
  const points = await gatherTimelinePoints(input.organizationId, input.projectionKind, start, end);
  const { state, drift } = deriveUnifiedState(points);
  const overlays = await gatherResilienceOverlays(input.organizationId);
  const rationale = `kind=${input.projectionKind}; points=${points.length}; unified_state=${state}; drift=${drift}; deterministic=true`;

  const ins = await ownedDbTable('observability_convergence_projections')
    .insert({
      organization_id: input.organizationId,
      projection_kind: input.projectionKind,
      unified_health_state: state,
      timeline: points,
      drift_detected: drift,
      resilience_overlays: overlays,
      derivation_explanation: rationale,
      bounded_window_start: start,
      bounded_window_end: end,
      generated_by: input.generatedBy,
      metadata: input.metadata ?? {},
    })
    .select('*')
    .single();
  if (ins.error || !ins.data) throw new Error(`observability_projection_insert_failed:${ins.error?.message ?? 'unknown'}`);
  const row = ins.data as ObservabilityConvergenceProjection;

  try {
    await publishObservabilityConvergenceUpdated({
      organizationId: input.organizationId,
      projectionId: row.id,
      projectionKind: row.projection_kind,
      unifiedHealthState: row.unified_health_state,
      driftDetected: row.drift_detected,
    });
    void publishRealtime({
      organizationId: input.organizationId,
      topic: 'observability_convergence',
      eventName: 'observability.convergence_updated',
      payload: { projection_kind: row.projection_kind, unified_health_state: row.unified_health_state, drift_detected: row.drift_detected },
    });
  } catch { /* best effort */ }
  return row;
}

export async function listObservabilityProjections(
  organizationId: string,
  options?: { projectionKind?: ObservabilityProjectionKind; limit?: number },
): Promise<ObservabilityConvergenceProjection[]> {
  let q = ownedDbTable('observability_convergence_projections')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(Math.min(500, Math.max(1, options?.limit ?? 100)));
  if (options?.projectionKind) q = q.eq('projection_kind', options.projectionKind);
  const { data } = await q;
  return (data as ObservabilityConvergenceProjection[]) ?? [];
}
