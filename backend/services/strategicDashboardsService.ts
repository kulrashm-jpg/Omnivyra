/**
 * Phase 8 — Executive-grade strategic dashboards.
 *
 * Pure aggregation over existing Phase 0–7 data. Eight tile families:
 *   • opportunity_trends         — totals + type breakdown over the window
 *   • competitor_movement        — competitor_dissatisfaction time-series
 *   • source_roi                 — per-source persisted / opp / spend
 *   • escalation_trends          — open/resolved counts + SLA hits
 *   • conversion_trends          — opportunity → lifecycle conversion rate
 *   • source_degradation         — degraded/unstable source counts
 *   • intelligence_coverage      — distinct platforms / sources active
 *   • operational_health         — re-export from operationalResilienceService
 *
 * All computations are deterministic and bounded to the request window.
 */

import { ownedDbTable } from '../db/writeOwner';
import { getOperationalHealthSnapshot } from './operationalResilienceService';

export type DashboardWindow = { hours: number; since_iso: string; until_iso: string };

export type DashboardTile = {
  key: string;
  title: string;
  total?: number;
  breakdown?: Array<{ label: string; value: number }>;
  metadata?: Record<string, unknown>;
  window: DashboardWindow;
  rationale: string;
};

function makeWindow(windowHours: number): DashboardWindow {
  const until = new Date();
  const since = new Date(until.getTime() - windowHours * 60 * 60 * 1000);
  return {
    hours: windowHours,
    since_iso: since.toISOString(),
    until_iso: until.toISOString(),
  };
}

export async function getStrategicDashboardTiles(
  organizationId: string,
  windowHours = 24 * 30,
): Promise<DashboardTile[]> {
  const window = makeWindow(windowHours);
  const tiles: DashboardTile[] = [];

  // opportunity_trends
  {
    const { data } = await ownedDbTable('opportunity_feed_items')
      .select('opportunity_type')
      .eq('organization_id', organizationId)
      .gt('created_at', window.since_iso);
    const counts: Record<string, number> = {};
    for (const r of (data ?? []) as Array<{ opportunity_type: string }>) {
      counts[r.opportunity_type] = (counts[r.opportunity_type] ?? 0) + 1;
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    tiles.push({
      key: 'opportunity_trends',
      title: 'Opportunity trends',
      total,
      breakdown: Object.entries(counts).map(([k, v]) => ({ label: k, value: v })),
      window,
      rationale: `Counted opportunities created in the last ${windowHours}h, grouped by opportunity_type.`,
    });
  }

  // competitor_movement
  {
    const { data } = await ownedDbTable('opportunity_feed_items')
      .select('created_at, matched_keywords')
      .eq('organization_id', organizationId)
      .eq('opportunity_type', 'competitor_dissatisfaction')
      .gt('created_at', window.since_iso);
    const dailyBuckets: Record<string, number> = {};
    for (const r of (data ?? []) as Array<{ created_at: string }>) {
      const d = new Date(r.created_at).toISOString().slice(0, 10);
      dailyBuckets[d] = (dailyBuckets[d] ?? 0) + 1;
    }
    tiles.push({
      key: 'competitor_movement',
      title: 'Competitor movement',
      total: Object.values(dailyBuckets).reduce((a, b) => a + b, 0),
      breakdown: Object.entries(dailyBuckets).sort().map(([k, v]) => ({ label: k, value: v })),
      window,
      rationale: 'Competitor-dissatisfaction signals bucketed by day.',
    });
  }

  // source_roi
  {
    const { data: execs } = await ownedDbTable('listening_executions')
      .select('listening_source_id, actual_credit_cost, signal_stats')
      .eq('organization_id', organizationId)
      .gt('created_at', window.since_iso)
      .in('execution_status', ['completed', 'partial']);
    type Acc = { credits: number; persisted: number };
    const bySource = new Map<string, Acc>();
    for (const r of (execs ?? []) as Array<{ listening_source_id: string; actual_credit_cost: number; signal_stats: Record<string, number> | null }>) {
      const a = bySource.get(r.listening_source_id) ?? { credits: 0, persisted: 0 };
      a.credits += Number(r.actual_credit_cost ?? 0);
      a.persisted += Number(r.signal_stats?.signals_persisted ?? 0);
      bySource.set(r.listening_source_id, a);
    }
    const breakdown = [...bySource.entries()].map(([id, a]) => ({
      label: id,
      value: a.persisted,
      metadata: { credits: a.credits, cost_per_signal: a.persisted > 0 ? Number((a.credits / a.persisted).toFixed(2)) : null },
    }));
    tiles.push({
      key: 'source_roi',
      title: 'Source ROI',
      total: breakdown.reduce((acc, b) => acc + b.value, 0),
      breakdown: breakdown.map((b) => ({ label: b.label, value: b.value })),
      window,
      rationale: 'Per-source persisted signals over the window; metadata includes credits and $/signal.',
      metadata: { detailed: breakdown },
    });
  }

  // escalation_trends
  {
    const { data } = await ownedDbTable('escalations')
      .select('status')
      .eq('organization_id', organizationId)
      .gt('created_at', window.since_iso);
    const counts: Record<string, number> = {};
    for (const r of (data ?? []) as Array<{ status: string }>) {
      counts[r.status] = (counts[r.status] ?? 0) + 1;
    }
    tiles.push({
      key: 'escalation_trends',
      title: 'Escalation trends',
      total: Object.values(counts).reduce((a, b) => a + b, 0),
      breakdown: Object.entries(counts).map(([k, v]) => ({ label: k, value: v })),
      window,
      rationale: 'Escalation status distribution over the window.',
    });
  }

  // conversion_trends
  {
    const { data: opps } = await ownedDbTable('opportunity_feed_items')
      .select('id')
      .eq('organization_id', organizationId)
      .gt('created_at', window.since_iso);
    const oppIds = ((opps ?? []) as Array<{ id: string }>).map((r) => r.id);
    let qualified = 0;
    let converted = 0;
    if (oppIds.length > 0) {
      const { data: lifecycle } = await ownedDbTable('opportunity_lifecycle_states')
        .select('opportunity_feed_item_id, state, transitioned_at')
        .eq('organization_id', organizationId)
        .in('opportunity_feed_item_id', oppIds)
        .order('transitioned_at', { ascending: false });
      const seen = new Set<string>();
      for (const r of (lifecycle ?? []) as Array<{ opportunity_feed_item_id: string; state: string }>) {
        if (seen.has(r.opportunity_feed_item_id)) continue;
        seen.add(r.opportunity_feed_item_id);
        if (r.state === 'qualified' || r.state === 'monitoring' || r.state === 'outreach_planned' || r.state === 'converted') qualified += 1;
        if (r.state === 'converted') converted += 1;
      }
    }
    tiles.push({
      key: 'conversion_trends',
      title: 'Conversion trends',
      total: oppIds.length,
      breakdown: [
        { label: 'qualified_or_better', value: qualified },
        { label: 'converted', value: converted },
        { label: 'qualified_rate_pct', value: oppIds.length > 0 ? Math.round((qualified / oppIds.length) * 100) : 0 },
      ],
      window,
      rationale: 'Lifecycle progression for opportunities created in the window.',
    });
  }

  // source_degradation
  {
    const { data } = await ownedDbTable('source_health_states')
      .select('listening_source_id, health_state, computed_at')
      .eq('organization_id', organizationId)
      .order('computed_at', { ascending: false })
      .limit(2000);
    const seen = new Set<string>();
    const counts: Record<string, number> = { healthy: 0, degraded: 0, unstable: 0, silenced: 0 };
    for (const r of (data ?? []) as Array<{ listening_source_id: string; health_state: string }>) {
      if (seen.has(r.listening_source_id)) continue;
      seen.add(r.listening_source_id);
      counts[r.health_state] = (counts[r.health_state] ?? 0) + 1;
    }
    tiles.push({
      key: 'source_degradation',
      title: 'Source degradation',
      total: Object.values(counts).reduce((a, b) => a + b, 0),
      breakdown: Object.entries(counts).map(([k, v]) => ({ label: k, value: v })),
      window,
      rationale: 'Latest health verdict per listening source.',
    });
  }

  // intelligence_coverage
  {
    const { data: sources } = await ownedDbTable('listening_sources')
      .select('source_type, metadata')
      .eq('organization_id', organizationId)
      .in('status', ['approved', 'active', 'paused']);
    const platforms = new Set<string>();
    for (const r of (sources ?? []) as Array<{ metadata: { platform?: string } | null }>) {
      const platform = r.metadata?.platform;
      if (platform) platforms.add(platform);
    }
    tiles.push({
      key: 'intelligence_coverage',
      title: 'Intelligence coverage',
      total: (sources ?? []).length,
      breakdown: [...platforms].map((p) => ({ label: p, value: 1 })),
      window,
      rationale: 'Approved / active / paused listening sources and the platforms they touch.',
    });
  }

  // operational_health (re-export from Phase 7)
  try {
    const snapshot = await getOperationalHealthSnapshot(organizationId, windowHours);
    tiles.push({
      key: 'operational_health',
      title: 'Operational health',
      total: snapshot.execution_health.completed + snapshot.execution_health.partial + snapshot.execution_health.failed,
      breakdown: [
        { label: 'completed', value: snapshot.execution_health.completed },
        { label: 'partial', value: snapshot.execution_health.partial },
        { label: 'failed', value: snapshot.execution_health.failed },
        { label: 'rate_limited_runs', value: snapshot.connector_degradation.rate_limited_runs },
        { label: 'degraded_sources', value: snapshot.connector_degradation.degraded_sources },
      ],
      window,
      rationale: 'Phase 7 operational resilience snapshot — projection / DLQ / degradation.',
      metadata: { stalest_projection: snapshot.replay_drift.stalest_projection_kind, stalest_lag_seconds: snapshot.replay_drift.stalest_lag_seconds },
    });
  } catch {
    // best-effort
  }

  return tiles;
}
