/**
 * Market Pulse job processor v1.
 * Routes by insight_source: api (DB aggregation only), llm (per-region LLM), hybrid (both).
 */

import { supabase } from '../db/supabaseClient';
import { generateMarketPulseForRegion, type MarketPulseContextPayload } from './opportunityGenerators';
import { consolidateMarketPulseResults } from './marketPulseConsolidator';
import { aggregateMarketPulseFromDb, type AggregatedPulseSignal } from './marketPulseAggregationService';
import type { ConsolidatedPulseOutput } from './marketPulseConsolidator';

type JobRow = {
  id: string;
  company_id: string;
  status: string;
  regions: string[];
  context_payload?: (MarketPulseContextPayload & { insight_source?: 'api' | 'llm' | 'hybrid' }) | null;
};

function computeConfidenceIndex(consolidated: {
  global_topics: Array<{ momentum_score?: number }>;
  region_divergence_score?: number;
  localized_risk_pockets?: unknown[];
}, expiredRatio: number): number {
  let confidence = 0;
  const topicCount = consolidated.global_topics?.length ?? 0;

  if (topicCount >= 5) confidence += 20;
  if (topicCount > 0) {
    const topics = consolidated.global_topics;
    const avgMomentum = topics.reduce((s, t) => s + (t.momentum_score ?? 0), 0) / topics.length;
    if (avgMomentum > 0.5) confidence += 20;
  }
  const regionDivergence = consolidated.region_divergence_score ?? 0;
  if (regionDivergence < 0.3) confidence += 20;
  if (expiredRatio < 0.3) confidence += 20;
  const localizedRiskCount = Array.isArray(consolidated.localized_risk_pockets) ? consolidated.localized_risk_pockets.length : 0;
  if (localizedRiskCount < 2) confidence += 20;

  return Math.min(100, confidence);
}

function aggregatedToConsolidated(signals: AggregatedPulseSignal[]): ConsolidatedPulseOutput {
  const global_topics = signals.map((s) => ({
    topic: s.topic,
    spike_reason: s.spike_reason ?? 'Aggregated from intelligence',
    shelf_life_days: s.shelf_life_days ?? 7,
    risk_level: s.risk_level ?? 'LOW',
    priority_score: s.momentum_score,
    regions: s.region ? [s.region] : ['GLOBAL'],
    momentum_score: s.momentum_score,
    primary_category: s.primary_category,
    secondary_tags: s.secondary_tags,
  }));
  return {
    global_topics,
    region_specific_insights: [],
    risk_alerts: [],
    execution_priority_order: global_topics.map((t) => t.topic),
    strategic_summary: `Aggregated ${signals.length} signals from DB sources.`,
    region_divergence_score: 0,
    arbitrage_opportunities: [],
    localized_risk_pockets: [],
  };
}

export async function processMarketPulseJobV1(jobId: string): Promise<void> {
  const now = new Date().toISOString();

  const { data: job, error: fetchError } = await supabase
    .from('market_pulse_jobs_v1')
    .select('id, company_id, status, regions, context_payload')
    .eq('id', jobId)
    .single();

  if (fetchError || !job) {
    return;
  }

  const row = job as JobRow;
  if (row.status !== 'PENDING') {
    return;
  }

  const CANCELLED_ERROR = 'Cancelled by user';

  async function isCancelled(): Promise<boolean> {
    const { data: recheck } = await supabase
      .from('market_pulse_jobs_v1')
      .select('error')
      .eq('id', jobId)
      .single();
    return ((recheck?.error as string) ?? '').includes(CANCELLED_ERROR);
  }

  if (await isCancelled()) return;

  await supabase
    .from('market_pulse_jobs_v1')
    .update({ status: 'RUNNING', progress_stage: 'INITIALIZING' })
    .eq('id', jobId);

  const companyId = row.company_id;
  const regions = Array.isArray(row.regions) && row.regions.length > 0 ? row.regions : ['GLOBAL'];
  const contextPayload = row.context_payload ?? ({} as Record<string, unknown>);
  const insightSource = (contextPayload as { insight_source?: 'api' | 'llm' | 'hybrid' }).insight_source ?? 'hybrid';

  if (insightSource === 'api') {
    await supabase.from('market_pulse_jobs_v1').update({ progress_stage: 'SCANNING' }).eq('id', jobId);
    const signals = await aggregateMarketPulseFromDb(companyId, regions);
    const consolidated = aggregatedToConsolidated(signals);
    const confidenceIndex = computeConfidenceIndex(consolidated, 0);
    await supabase
      .from('market_pulse_jobs_v1')
      .update({
        progress_stage: 'FINISHED',
        status: 'COMPLETED',
        consolidated_result: consolidated,
        confidence_index: confidenceIndex,
        region_divergence_score: 0,
        arbitrage_opportunities: [],
        localized_risk_pockets: [],
        error: null,
        completed_at: now,
      })
      .eq('id', jobId);
    return;
  }

  const regionResults: Record<string, { topics: { topic: string; spike_reason: string; shelf_life_days: number; risk_level: string; priority_score: number; velocity_score?: number; momentum_score?: number; narrative_phase?: string }[] } | { error: true; message: string }> = {};

  for (const region of regions) {
    if (await isCancelled()) return;
    await supabase.from('market_pulse_jobs_v1').update({ progress_stage: 'SCANNING' }).eq('id', jobId);
    try {
      const result = await generateMarketPulseForRegion(companyId, region, contextPayload);
      regionResults[region] = { topics: result.topics };

      for (const t of result.topics) {
        await supabase.from('market_pulse_items_v1').insert({
          job_id: jobId,
          company_id: companyId,
          region,
          topic: t.topic,
          spike_reason: t.spike_reason,
          shelf_life_days: t.shelf_life_days,
          risk_level: t.risk_level,
          priority_score: t.priority_score,
          velocity_score: t.velocity_score ?? 0,
          momentum_score: t.momentum_score ?? 0,
          narrative_phase: t.narrative_phase ?? null,
        });
      }
    } catch (err) {
      regionResults[region] = { error: true, message: err instanceof Error ? err.message : 'Region analysis failed' };
    }
    await supabase.from('market_pulse_jobs_v1').update({ region_results: regionResults }).eq('id', jobId);
  }

  let consolidated: ConsolidatedPulseOutput;

  if (insightSource === 'hybrid') {
    const dbSignals = await aggregateMarketPulseFromDb(companyId, regions);
    const dbConsolidated = aggregatedToConsolidated(dbSignals);
    const successfulEntries = Object.entries(regionResults).filter(
      (e): e is [string, { topics: import('./opportunityGenerators').MarketPulseTopic[] }] =>
        !('error' in e[1]) && 'topics' in e[1]
    );
    const llmConsolidated =
      successfulEntries.length > 0
        ? consolidateMarketPulseResults(
            Object.fromEntries(successfulEntries.map(([r, v]) => [r, { topics: v.topics }]))
          )
        : { global_topics: [], region_specific_insights: [], risk_alerts: [], execution_priority_order: [], strategic_summary: '', region_divergence_score: 0, arbitrage_opportunities: [], localized_risk_pockets: [] };

    const seenTopics = new Set(dbConsolidated.global_topics.map((t) => t.topic.toLowerCase().trim()));
    for (const t of llmConsolidated.global_topics) {
      if (seenTopics.has(t.topic.toLowerCase().trim())) continue;
      if (dbConsolidated.global_topics.length >= 40) break;
      seenTopics.add(t.topic.toLowerCase().trim());
      dbConsolidated.global_topics.push({
        ...t,
        primary_category: 'MARKET_TREND',
        secondary_tags: [],
      });
    }
    dbConsolidated.global_topics.sort((a, b) => (b.priority_score ?? 0) - (a.priority_score ?? 0));
    consolidated = { ...dbConsolidated, strategic_summary: `Hybrid: ${dbSignals.length} DB + ${llmConsolidated.global_topics.length} LLM topics.` };
  } else {
    const successfulEntries = Object.entries(regionResults).filter(
      (e): e is [string, { topics: import('./opportunityGenerators').MarketPulseTopic[] }] =>
        !('error' in e[1]) && 'topics' in e[1]
    );
    if (successfulEntries.length === 0) {
      await supabase
        .from('market_pulse_jobs_v1')
        .update({
          progress_stage: 'FINISHED',
          status: 'FAILED',
          error: 'All regions failed.',
          completed_at: now,
        })
        .eq('id', jobId);
      return;
    }
    consolidated = consolidateMarketPulseResults(
      Object.fromEntries(successfulEntries.map(([r, v]) => [r, { topics: v.topics }]))
    );
  }

  const successfulEntries = Object.entries(regionResults).filter(
    (e) => !('error' in e[1]) && 'topics' in e[1]
  ) as Array<[string, { topics: { topic: string; spike_reason: string; shelf_life_days: number; risk_level: string; priority_score: number }[] }]>;
  const successCount = successfulEntries.length;
  const failCount = regions.length - successCount;
  const finalStatus =
    successCount === 0 ? 'FAILED' : failCount > 0 ? 'COMPLETED_WITH_WARNINGS' : 'COMPLETED';
  const finalError = successCount === 0 ? 'All regions failed.' : null;

  const confidenceIndex = computeConfidenceIndex(consolidated, 0);

  await supabase
    .from('market_pulse_jobs_v1')
    .update({
      progress_stage: 'FINISHED',
      status: finalStatus,
      consolidated_result: consolidated,
      confidence_index: confidenceIndex,
      region_divergence_score: consolidated.region_divergence_score ?? 0,
      arbitrage_opportunities: consolidated.arbitrage_opportunities ?? [],
      localized_risk_pockets: consolidated.localized_risk_pockets ?? [],
      error: finalError,
      completed_at: now,
    })
    .eq('id', jobId);
}
