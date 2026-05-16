/**
 * Phase 4 — Community quality scoring.
 *
 * Bounded deterministic heuristics. Computes four scores per community
 * from observed execution + signal data. NO self-tuning loop yet — every
 * score is a pure function of the inputs.
 *
 * Inputs come from:
 *   - listening_executions (signal_stats, moderation_status)
 *   - opportunity_feed_items (intent / urgency / score distribution)
 *   - moderation_decisions (block / flag counts)
 *
 * Outputs:
 *   - quality_score      — overall signal quality (0–1)
 *   - noise_score        — moderation block + dedup rate (0–1; higher = noisier)
 *   - intent_density_score — fraction of persisted signals classified as buyer_intent (0–1)
 *   - strategic_value_score — composite of quality + intent − noise (0–1)
 */

import { ownedDbTable } from '../db/writeOwner';

export type CommunityQualityScores = {
  source_type: string;
  source_identifier: string;
  quality_score: number;
  noise_score: number;
  intent_density_score: number;
  strategic_value_score: number;
  inputs: {
    executions_examined: number;
    signals_persisted: number;
    signals_blocked: number;
    signals_deduplicated: number;
    opportunity_buying_intent_count: number;
    opportunity_total_count: number;
  };
};

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export async function computeCommunityQualityScores(args: {
  organizationId: string;
  source_type: string;
  source_identifier: string;
  windowHours?: number;
}): Promise<CommunityQualityScores> {
  const windowHours = args.windowHours ?? 24 * 30;
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();

  // Find the listening_source row(s) matching the (org, source_type,
  // source_identifier). One row in normal usage.
  const { data: sources } = await ownedDbTable('listening_sources')
    .select('id')
    .eq('organization_id', args.organizationId)
    .eq('source_type', args.source_type)
    .eq('source_identifier', args.source_identifier);
  const sourceIds = (sources ?? []).map((r: { id: string }) => r.id);

  // Aggregate ingestion stats across the rolling window.
  let executions: Array<{
    signal_stats: Record<string, number> | null;
    moderation_status: string | null;
  }> = [];
  if (sourceIds.length > 0) {
    const { data } = await ownedDbTable('listening_executions')
      .select('signal_stats, moderation_status')
      .eq('organization_id', args.organizationId)
      .in('listening_source_id', sourceIds)
      .gt('created_at', since)
      .in('execution_status', ['completed', 'partial']);
    executions = (data ?? []) as typeof executions;
  }

  let persisted = 0;
  let blocked = 0;
  let deduped = 0;
  for (const e of executions) {
    const s = e.signal_stats ?? {};
    persisted += Number(s.signals_persisted ?? 0);
    blocked += Number(s.signals_moderation_blocked ?? 0);
    deduped += Number(s.signals_deduplicated ?? 0);
  }
  const totalObserved = persisted + blocked + deduped;

  // Opportunity-type breakdown for this source.
  const { data: feed } = await ownedDbTable('opportunity_feed_items')
    .select('opportunity_type')
    .eq('organization_id', args.organizationId)
    .eq('source_identifier', args.source_identifier)
    .gt('created_at', since);
  const feedItems = (feed ?? []) as Array<{ opportunity_type: string }>;
  const buyingIntentCount = feedItems.filter((f) => f.opportunity_type === 'buying_intent').length;
  const opportunityTotal = feedItems.length;

  // Score derivations.
  const moderationRatio = totalObserved > 0 ? blocked / totalObserved : 0;
  const dedupRatio = totalObserved > 0 ? deduped / totalObserved : 0;
  const noise = clamp01(moderationRatio * 0.7 + dedupRatio * 0.3);

  const persistedRatio = totalObserved > 0 ? persisted / totalObserved : 0;
  const quality = clamp01(persistedRatio * 0.8 + (1 - noise) * 0.2);

  const intentDensity = opportunityTotal > 0
    ? clamp01(buyingIntentCount / opportunityTotal)
    : 0;

  const strategic = clamp01(quality * 0.5 + intentDensity * 0.4 - noise * 0.2);

  return {
    source_type: args.source_type,
    source_identifier: args.source_identifier,
    quality_score: Number(quality.toFixed(3)),
    noise_score: Number(noise.toFixed(3)),
    intent_density_score: Number(intentDensity.toFixed(3)),
    strategic_value_score: Number(strategic.toFixed(3)),
    inputs: {
      executions_examined: executions.length,
      signals_persisted: persisted,
      signals_blocked: blocked,
      signals_deduplicated: deduped,
      opportunity_buying_intent_count: buyingIntentCount,
      opportunity_total_count: opportunityTotal,
    },
  };
}
