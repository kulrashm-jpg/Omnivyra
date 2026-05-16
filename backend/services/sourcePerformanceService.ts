/**
 * Phase 5 — Source performance intelligence.
 *
 * Per-source profile combining Phase 1 quality scores with execution
 * efficiency, ROI, opportunity yield, and engagement quality metrics.
 *
 * Pure derivation over existing tables. Deterministic. The output is
 * computed on demand, not materialised (callers cache as they see fit).
 */

import { ownedDbTable } from '../db/writeOwner';
import { computeCommunityQualityScores } from './communityQualityScoringService';

export type SourcePerformanceProfile = {
  listening_source_id: string;
  source_type: string;
  source_identifier: string;
  display_name: string;
  status: string;
  platform: string | null;
  execution_count: number;
  partial_count: number;
  failed_count: number;
  total_credits_spent: number;
  signals_persisted: number;
  signals_blocked: number;
  signals_deduplicated: number;
  opportunity_count: number;
  buying_intent_count: number;
  /** quality / noise / intent_density / strategic_value from Phase 1 */
  quality_scores: {
    quality_score: number;
    noise_score: number;
    intent_density_score: number;
    strategic_value_score: number;
  };
  /** Derived */
  cost_per_opportunity: number | null;
  cost_per_signal: number | null;
  health: 'strong' | 'moderate' | 'weak' | 'unhealthy';
};

function clampHealth(args: {
  strategic: number;
  noise: number;
  yield_: number;
  failureRate: number;
}): SourcePerformanceProfile['health'] {
  if (args.failureRate >= 0.5 || args.noise >= 0.6) return 'unhealthy';
  if (args.strategic >= 0.6 && args.yield_ >= 1 && args.noise < 0.35) return 'strong';
  if (args.strategic >= 0.4 || args.yield_ >= 0.5) return 'moderate';
  return 'weak';
}

export async function getSourcePerformanceProfile(
  organizationId: string,
  listeningSourceId: string,
  windowHours = 24 * 30,
): Promise<SourcePerformanceProfile | null> {
  const { data: source } = await ownedDbTable('listening_sources')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('id', listeningSourceId)
    .maybeSingle();
  if (!source) return null;
  const src = source as {
    id: string;
    source_type: string;
    source_identifier: string;
    display_name: string;
    status: string;
    metadata?: { platform?: string };
  };

  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();

  const { data: execs } = await ownedDbTable('listening_executions')
    .select('execution_status, actual_credit_cost, signal_stats')
    .eq('organization_id', organizationId)
    .eq('listening_source_id', listeningSourceId)
    .gt('created_at', since);
  type ExecRow = {
    execution_status: string;
    actual_credit_cost: number;
    signal_stats: Record<string, number> | null;
  };
  const rows = (execs ?? []) as ExecRow[];

  let executionCount = 0;
  let partial = 0;
  let failed = 0;
  let credits = 0;
  let persisted = 0;
  let blocked = 0;
  let deduped = 0;
  for (const r of rows) {
    executionCount += 1;
    if (r.execution_status === 'partial') partial += 1;
    if (r.execution_status === 'failed') failed += 1;
    credits += Number(r.actual_credit_cost ?? 0);
    const s = r.signal_stats ?? {};
    persisted += Number(s.signals_persisted ?? 0);
    blocked += Number(s.signals_moderation_blocked ?? 0);
    deduped += Number(s.signals_deduplicated ?? 0);
  }

  const { data: opps } = await ownedDbTable('opportunity_feed_items')
    .select('opportunity_type')
    .eq('organization_id', organizationId)
    .eq('source_identifier', src.source_identifier)
    .gt('created_at', since);
  const oppRows = (opps ?? []) as Array<{ opportunity_type: string }>;
  const opportunityCount = oppRows.length;
  const buyingIntent = oppRows.filter((o) => o.opportunity_type === 'buying_intent').length;

  const quality = await computeCommunityQualityScores({
    organizationId,
    source_type: src.source_type,
    source_identifier: src.source_identifier,
    windowHours,
  });

  const failureRate = executionCount > 0 ? failed / executionCount : 0;
  const yieldRatio = executionCount > 0 ? persisted / executionCount : 0;

  return {
    listening_source_id: listeningSourceId,
    source_type: src.source_type,
    source_identifier: src.source_identifier,
    display_name: src.display_name,
    status: src.status,
    platform: src.metadata?.platform ?? null,
    execution_count: executionCount,
    partial_count: partial,
    failed_count: failed,
    total_credits_spent: credits,
    signals_persisted: persisted,
    signals_blocked: blocked,
    signals_deduplicated: deduped,
    opportunity_count: opportunityCount,
    buying_intent_count: buyingIntent,
    quality_scores: {
      quality_score: quality.quality_score,
      noise_score: quality.noise_score,
      intent_density_score: quality.intent_density_score,
      strategic_value_score: quality.strategic_value_score,
    },
    cost_per_opportunity: opportunityCount > 0 ? Number((credits / opportunityCount).toFixed(2)) : null,
    cost_per_signal: persisted > 0 ? Number((credits / persisted).toFixed(2)) : null,
    health: clampHealth({
      strategic: quality.strategic_value_score,
      noise: quality.noise_score,
      yield_: yieldRatio,
      failureRate,
    }),
  };
}

export async function listSourcePerformanceForOrg(
  organizationId: string,
  windowHours = 24 * 30,
): Promise<SourcePerformanceProfile[]> {
  const { data: sources } = await ownedDbTable('listening_sources')
    .select('id')
    .eq('organization_id', organizationId)
    .in('status', ['approved', 'active', 'paused']);
  const ids = (sources ?? []).map((r: { id: string }) => r.id);
  const profiles: SourcePerformanceProfile[] = [];
  for (const id of ids) {
    const p = await getSourcePerformanceProfile(organizationId, id, windowHours);
    if (p) profiles.push(p);
  }
  return profiles.sort((a, b) => b.quality_scores.strategic_value_score - a.quality_scores.strategic_value_score);
}
