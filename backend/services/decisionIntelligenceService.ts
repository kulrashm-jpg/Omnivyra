/**
 * Phase 6 — Decision intelligence overlays.
 *
 * Deterministic, explainable insights derived from existing data. No AI.
 * Every insight carries:
 *   • `code`     — stable identifier for client-side dedup
 *   • `headline` — one-line summary (the "WHY")
 *   • `evidence` — array of `{ label, value }` pairs that drove the insight
 *   • `severity` — informational severity
 *   • `window_hours` — how far back the inputs were aggregated
 *
 * Insights are NOT actions. They cannot trigger lifecycle transitions,
 * escalations, or outreach. They are advisory overlays for the analyst UI.
 */

import { ownedDbTable } from '../db/writeOwner';

export const DECISION_INSIGHT_CODES = [
  'high_intent_cluster_multi_source',
  'source_low_conversion_quality',
  'competitor_dissatisfaction_uptrend',
  'migration_signal_cluster_active',
  'execution_failure_uptrend',
  'moderation_spike',
] as const;
export type DecisionInsightCode = (typeof DECISION_INSIGHT_CODES)[number];

export type DecisionInsightSeverity = 'info' | 'attention' | 'warning';

export type DecisionInsightEvidence = {
  label: string;
  value: string | number;
};

export type DecisionInsight = {
  code: DecisionInsightCode;
  headline: string;
  severity: DecisionInsightSeverity;
  window_hours: number;
  evidence: DecisionInsightEvidence[];
  metadata: Record<string, unknown>;
};

const DEFAULT_WINDOW_HOURS = 24 * 7;

export async function computeDecisionInsights(
  organizationId: string,
  windowHours: number = DEFAULT_WINDOW_HOURS,
): Promise<DecisionInsight[]> {
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();
  const insights: DecisionInsight[] = [];

  // ---- High buying-intent cluster across multiple sources ----
  const { data: clusterRows } = await ownedDbTable('opportunity_feed_items')
    .select('cluster_id, source_identifier, opportunity_type')
    .eq('organization_id', organizationId)
    .eq('opportunity_type', 'buying_intent')
    .not('cluster_id', 'is', null)
    .gt('created_at', since);
  const sourcesByCluster = new Map<string, Set<string>>();
  for (const row of (clusterRows ?? []) as Array<{ cluster_id: string | null; source_identifier: string | null }>) {
    if (!row.cluster_id) continue;
    const set = sourcesByCluster.get(row.cluster_id) ?? new Set<string>();
    if (row.source_identifier) set.add(row.source_identifier);
    sourcesByCluster.set(row.cluster_id, set);
  }
  let multiSourceClusters = 0;
  for (const sources of sourcesByCluster.values()) {
    if (sources.size >= 2) multiSourceClusters += 1;
  }
  if (multiSourceClusters > 0) {
    insights.push({
      code: 'high_intent_cluster_multi_source',
      headline: `${multiSourceClusters} buying-intent cluster${multiSourceClusters === 1 ? '' : 's'} active across ≥2 sources`,
      severity: multiSourceClusters >= 3 ? 'warning' : 'attention',
      window_hours: windowHours,
      evidence: [
        { label: 'clusters', value: multiSourceClusters },
        { label: 'min_sources_per_cluster', value: 2 },
        { label: 'window_hours', value: windowHours },
      ],
      metadata: {},
    });
  }

  // ---- Source low conversion quality ----
  const { data: execs } = await ownedDbTable('listening_executions')
    .select('listening_source_id, signal_stats')
    .eq('organization_id', organizationId)
    .gt('created_at', since)
    .in('execution_status', ['completed', 'partial']);
  const persistedBySource = new Map<string, number>();
  for (const e of (execs ?? []) as Array<{ listening_source_id: string; signal_stats: Record<string, number> | null }>) {
    persistedBySource.set(
      e.listening_source_id,
      (persistedBySource.get(e.listening_source_id) ?? 0) + Number(e.signal_stats?.signals_persisted ?? 0),
    );
  }
  const lowYieldSources: string[] = [];
  for (const [sourceId, persisted] of persistedBySource.entries()) {
    if (persisted === 0) lowYieldSources.push(sourceId);
  }
  if (lowYieldSources.length > 0) {
    insights.push({
      code: 'source_low_conversion_quality',
      headline: `${lowYieldSources.length} listening source${lowYieldSources.length === 1 ? '' : 's'} produced zero signals in the last ${Math.round(windowHours / 24)} day${windowHours / 24 === 1 ? '' : 's'}`,
      severity: lowYieldSources.length >= 3 ? 'warning' : 'attention',
      window_hours: windowHours,
      evidence: [{ label: 'zero_yield_sources', value: lowYieldSources.length }],
      metadata: { listening_source_ids: lowYieldSources.slice(0, 20) },
    });
  }

  // ---- Competitor dissatisfaction uptrend ----
  const { count: compCount } = await ownedDbTable('opportunity_feed_items')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .eq('opportunity_type', 'competitor_dissatisfaction')
    .gt('created_at', since);
  const compTotal = (compCount as unknown as number | null) ?? 0;
  if (compTotal >= 3) {
    insights.push({
      code: 'competitor_dissatisfaction_uptrend',
      headline: `${compTotal} competitor-dissatisfaction signal${compTotal === 1 ? '' : 's'} surfaced in the last ${Math.round(windowHours / 24)} day${windowHours / 24 === 1 ? '' : 's'}`,
      severity: compTotal >= 10 ? 'warning' : 'attention',
      window_hours: windowHours,
      evidence: [{ label: 'count', value: compTotal }],
      metadata: {},
    });
  }

  // ---- Migration signal cluster active ----
  const { count: migCount } = await ownedDbTable('opportunity_feed_items')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .eq('opportunity_type', 'migration_signal')
    .gt('created_at', since);
  const migTotal = (migCount as unknown as number | null) ?? 0;
  if (migTotal >= 3) {
    insights.push({
      code: 'migration_signal_cluster_active',
      headline: `${migTotal} active migration signal${migTotal === 1 ? '' : 's'} — buyers actively switching vendors`,
      severity: migTotal >= 10 ? 'warning' : 'attention',
      window_hours: windowHours,
      evidence: [{ label: 'count', value: migTotal }],
      metadata: {},
    });
  }

  // ---- Execution failure uptrend ----
  const { count: failedCount } = await ownedDbTable('listening_executions')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .eq('execution_status', 'failed')
    .gt('created_at', since);
  const failedTotal = (failedCount as unknown as number | null) ?? 0;
  if (failedTotal >= 3) {
    insights.push({
      code: 'execution_failure_uptrend',
      headline: `${failedTotal} listening execution${failedTotal === 1 ? '' : 's'} failed in the last ${Math.round(windowHours / 24)} day${windowHours / 24 === 1 ? '' : 's'}`,
      severity: failedTotal >= 10 ? 'warning' : 'attention',
      window_hours: windowHours,
      evidence: [{ label: 'failed_executions', value: failedTotal }],
      metadata: {},
    });
  }

  // ---- Moderation spike ----
  const { count: blockedCount } = await ownedDbTable('moderation_decisions')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .eq('outcome', 'blocked')
    .gt('created_at', since);
  const blockedTotal = (blockedCount as unknown as number | null) ?? 0;
  if (blockedTotal >= 20) {
    insights.push({
      code: 'moderation_spike',
      headline: `${blockedTotal} blocked content events in the last ${Math.round(windowHours / 24)} day${windowHours / 24 === 1 ? '' : 's'}`,
      severity: blockedTotal >= 100 ? 'warning' : 'attention',
      window_hours: windowHours,
      evidence: [{ label: 'blocked', value: blockedTotal }],
      metadata: {},
    });
  }

  return insights;
}
