/**
 * Phase 12 — SRE operations tooling.
 *
 * Deterministic, replayable health snapshots aimed at SREs:
 * runtime dependency health, queue saturation, projection lag / semantic
 * backlog / replay backlog heatmaps, connector degradation propagation.
 *
 * Hard guarantees:
 *   • Read-only over Phase 3-11 owned tables.
 *   • Operator-triggered (no background poller in this service).
 *   • Bounded telemetry windows: each snapshot is point-in-time.
 *   • Replay-safe: same upstream state → same snapshot row, including
 *     deterministic heatmap derivation.
 *   • Emits `sre.degradation_detected` when health is non-healthy.
 *   • Tenant-first.
 */

import { ownedDbTable } from '../db/writeOwner';
import {
  type HeatmapCell,
  type SreHealthSnapshot,
  type SreHealthState,
  type SreSnapshotKind,
} from '../types/sreOperations';
import { publishRealtime } from './realtimePublisherService';
import { publishSreDegradationDetected } from '../events/listeningEvents';

async function tableStatusCount(
  table: string,
  organizationId: string,
  status: string,
): Promise<number> {
  try {
    const { count } = await ownedDbTable(table)
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('status', status);
    return count ?? 0;
  } catch { return 0; }
}

function classify(measures: Record<string, number>, criticalKey: string, criticalThreshold: number, warnThreshold: number): SreHealthState {
  const observed = measures[criticalKey] ?? 0;
  if (observed >= criticalThreshold) return 'critical';
  if (observed >= warnThreshold) return 'degraded';
  return 'healthy';
}

async function buildSnapshot(
  organizationId: string,
  kind: SreSnapshotKind,
): Promise<{ measures: Record<string, number>; heatmap: HeatmapCell[]; state: SreHealthState; rationale: string }> {
  switch (kind) {
    case 'runtime_dependency_health': {
      const [exec_running, exec_failed, sem_running, sem_failed, replay_running, replay_failed] = await Promise.all([
        tableStatusCount('listening_executions', organizationId, 'running'),
        tableStatusCount('listening_executions', organizationId, 'failed'),
        tableStatusCount('semantic_indexing_partitions', organizationId, 'running'),
        tableStatusCount('semantic_indexing_partitions', organizationId, 'failed'),
        tableStatusCount('replay_partitions', organizationId, 'running'),
        tableStatusCount('replay_partitions', organizationId, 'failed'),
      ]);
      const measures = { exec_running, exec_failed, sem_running, sem_failed, replay_running, replay_failed, total_failed: exec_failed + sem_failed + replay_failed };
      const heatmap: HeatmapCell[] = [
        { label: 'listening_executions', value: exec_failed, state: exec_failed > 5 ? 'critical' : exec_failed > 0 ? 'degraded' : 'healthy' },
        { label: 'semantic_partitions', value: sem_failed, state: sem_failed > 5 ? 'critical' : sem_failed > 0 ? 'degraded' : 'healthy' },
        { label: 'replay_partitions', value: replay_failed, state: replay_failed > 5 ? 'critical' : replay_failed > 0 ? 'degraded' : 'healthy' },
      ];
      const state = classify(measures, 'total_failed', 15, 1);
      return { measures, heatmap, state, rationale: `aggregate failed=${measures.total_failed} across runtime dependencies` };
    }
    case 'queue_saturation': {
      const [exec_queued, sem_queued, replay_queued] = await Promise.all([
        tableStatusCount('listening_executions', organizationId, 'queued'),
        tableStatusCount('semantic_indexing_partitions', organizationId, 'queued'),
        tableStatusCount('replay_partitions', organizationId, 'queued'),
      ]);
      const total = exec_queued + sem_queued + replay_queued;
      const measures = { exec_queued, sem_queued, replay_queued, total };
      const heatmap: HeatmapCell[] = [
        { label: 'listening-executions', value: exec_queued, state: exec_queued > 200 ? 'critical' : exec_queued > 50 ? 'degraded' : 'healthy' },
        { label: 'semantic-indexing', value: sem_queued, state: sem_queued > 200 ? 'critical' : sem_queued > 50 ? 'degraded' : 'healthy' },
        { label: 'replay-partition', value: replay_queued, state: replay_queued > 200 ? 'critical' : replay_queued > 50 ? 'degraded' : 'healthy' },
      ];
      const state = classify(measures, 'total', 600, 100);
      return { measures, heatmap, state, rationale: `queued total=${total}` };
    }
    case 'projection_lag_heatmap': {
      const { data } = await ownedDbTable('projection_sync_state')
        .select('projection_kind, cursor_position, updated_at')
        .eq('organization_id', organizationId);
      const rows = (data as Array<{ projection_kind: string; cursor_position: string | null; updated_at: string }>) ?? [];
      const now = Date.now();
      const heatmap: HeatmapCell[] = rows.map((r) => {
        const ageMs = r.updated_at ? Math.max(0, now - new Date(r.updated_at).getTime()) : 0;
        const ageMin = Math.round(ageMs / 60_000);
        return { label: r.projection_kind, value: ageMin, state: ageMin > 60 ? 'critical' : ageMin > 15 ? 'degraded' : 'healthy', note: `lag=${ageMin}m` };
      });
      const worst = Math.max(0, ...heatmap.map((c) => c.value));
      const state: SreHealthState = worst > 60 ? 'critical' : worst > 15 ? 'degraded' : 'healthy';
      return { measures: { projections: rows.length, worst_lag_min: worst }, heatmap, state, rationale: `worst projection lag=${worst}m` };
    }
    case 'semantic_backlog_heatmap': {
      const [queued, running, failed] = await Promise.all([
        tableStatusCount('semantic_indexing_partitions', organizationId, 'queued'),
        tableStatusCount('semantic_indexing_partitions', organizationId, 'running'),
        tableStatusCount('semantic_indexing_partitions', organizationId, 'failed'),
      ]);
      const heatmap: HeatmapCell[] = [
        { label: 'queued', value: queued, state: queued > 200 ? 'critical' : queued > 50 ? 'degraded' : 'healthy' },
        { label: 'running', value: running, state: running > 30 ? 'critical' : running > 10 ? 'degraded' : 'healthy' },
        { label: 'failed', value: failed, state: failed > 5 ? 'critical' : failed > 0 ? 'degraded' : 'healthy' },
      ];
      const measures = { queued, running, failed, total: queued + running + failed };
      const state = classify(measures, 'queued', 200, 50);
      return { measures, heatmap, state, rationale: `semantic backlog=${queued}` };
    }
    case 'replay_backlog': {
      const [queued, running, failed] = await Promise.all([
        tableStatusCount('replay_partitions', organizationId, 'queued'),
        tableStatusCount('replay_partitions', organizationId, 'running'),
        tableStatusCount('replay_partitions', organizationId, 'failed'),
      ]);
      const heatmap: HeatmapCell[] = [
        { label: 'queued', value: queued, state: queued > 200 ? 'critical' : queued > 50 ? 'degraded' : 'healthy' },
        { label: 'running', value: running, state: running > 30 ? 'critical' : running > 10 ? 'degraded' : 'healthy' },
        { label: 'failed', value: failed, state: failed > 5 ? 'critical' : failed > 0 ? 'degraded' : 'healthy' },
      ];
      const measures = { queued, running, failed, total: queued + running + failed };
      const state = classify(measures, 'queued', 200, 50);
      return { measures, heatmap, state, rationale: `replay backlog=${queued}` };
    }
    case 'connector_degradation_map': {
      const { data } = await ownedDbTable('source_health_state')
        .select('listening_source_id, status, last_success_at, last_failure_reason')
        .eq('organization_id', organizationId)
        .limit(100);
      const rows = (data as Array<{ listening_source_id: string; status: string; last_success_at: string | null; last_failure_reason: string | null }>) ?? [];
      const heatmap: HeatmapCell[] = rows.map((r) => ({
        label: r.listening_source_id.slice(0, 18),
        value: r.last_failure_reason ? 1 : 0,
        state: r.status === 'healthy' ? 'healthy' : r.status === 'degraded' ? 'degraded' : r.status === 'failed' ? 'critical' : 'unknown',
        note: r.last_failure_reason ?? r.status,
      }));
      const degraded = heatmap.filter((c) => c.state !== 'healthy').length;
      const measures = { sources: rows.length, degraded };
      const state: SreHealthState = degraded === 0 ? 'healthy' : degraded > rows.length * 0.25 ? 'critical' : 'degraded';
      return { measures, heatmap, state, rationale: `${degraded}/${rows.length} sources non-healthy` };
    }
  }
}

export type GenerateSreSnapshotInput = {
  organizationId: string;
  snapshotKind: SreSnapshotKind;
  generatedBy: string | null;
  metadata?: Record<string, unknown>;
};

export async function generateSreSnapshot(input: GenerateSreSnapshotInput): Promise<SreHealthSnapshot> {
  const built = await buildSnapshot(input.organizationId, input.snapshotKind);
  const ins = await ownedDbTable('sre_health_snapshots')
    .insert({
      organization_id: input.organizationId,
      snapshot_kind: input.snapshotKind,
      health_state: built.state,
      measures: built.measures,
      heatmap: built.heatmap,
      derivation_explanation: built.rationale,
      generated_by: input.generatedBy,
      metadata: input.metadata ?? {},
    })
    .select('*')
    .single();
  if (ins.error || !ins.data) throw new Error(`sre_snapshot_insert_failed:${ins.error?.message ?? 'unknown'}`);
  const row = ins.data as SreHealthSnapshot;

  if (row.health_state !== 'healthy') {
    try {
      await publishSreDegradationDetected({
        organizationId: input.organizationId,
        snapshotId: row.id,
        snapshotKind: row.snapshot_kind,
        healthState: row.health_state,
      });
      void publishRealtime({
        organizationId: input.organizationId,
        topic: 'sre_operations',
        eventName: 'sre.degradation_detected',
        payload: { snapshot_id: row.id, snapshot_kind: row.snapshot_kind, health_state: row.health_state },
      });
    } catch { /* best effort */ }
  }
  return row;
}

export async function listSreSnapshots(
  organizationId: string,
  options?: { snapshotKind?: SreSnapshotKind; limit?: number },
): Promise<SreHealthSnapshot[]> {
  let q = ownedDbTable('sre_health_snapshots')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(Math.min(500, Math.max(1, options?.limit ?? 100)));
  if (options?.snapshotKind) q = q.eq('snapshot_kind', options.snapshotKind);
  const { data } = await q;
  return (data as SreHealthSnapshot[]) ?? [];
}
