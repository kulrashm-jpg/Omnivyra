/**
 * Market Pulse job processor v1.
 * Per-region pulse generation, fail-soft, consolidation, confidence index.
 */

import { supabase } from '../db/supabaseClient';
import { generateMarketPulseForRegion, type MarketPulseContextPayload } from './opportunityGenerators';
import { consolidateMarketPulseResults } from './marketPulseConsolidator';

type JobRow = {
  id: string;
  company_id: string;
  status: string;
  regions: string[];
  context_payload?: MarketPulseContextPayload | null;
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

  await supabase
    .from('market_pulse_jobs_v1')
    .update({ status: 'RUNNING', progress_stage: 'INITIALIZING' })
    .eq('id', jobId);

  const companyId = row.company_id;
  const regions = Array.isArray(row.regions) && row.regions.length > 0 ? row.regions : ['GLOBAL'];

  const regionResults: Record<string, { topics: { topic: string; spike_reason: string; shelf_life_days: number; risk_level: string; priority_score: number; velocity_score?: number; momentum_score?: number; narrative_phase?: string }[] } | { error: true; message: string }> = {};

  const contextPayload = row.context_payload ?? null;

  for (const region of regions) {
    await supabase.from('market_pulse_jobs_v1').update({ progress_stage: 'SCANNING' }).eq('id', jobId);
    try {
      const result = await generateMarketPulseForRegion(companyId, region, contextPayload);
      regionResults[region] = { topics: result.topics };

      const spikeCount = result.topics.length;
      const avgShelf = spikeCount > 0
        ? result.topics.reduce((s, t) => s + (t.shelf_life_days ?? 7), 0) / spikeCount
        : 0;

      console.info({ jobId, region, spikeCount, avgShelfLife: avgShelf });

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
      const message = err instanceof Error ? err.message : 'Region analysis failed';
      regionResults[region] = { error: true, message };
    }

    await supabase
      .from('market_pulse_jobs_v1')
      .update({ region_results: regionResults })
      .eq('id', jobId);
  }

  const successfulEntries = Object.entries(regionResults).filter(
    (e): e is [string, { topics: { topic: string; spike_reason: string; shelf_life_days: number; risk_level: string; priority_score: number }[] }] =>
      !('error' in e[1]) && 'topics' in e[1]
  );
  const successCount = successfulEntries.length;
  const failCount = regions.length - successCount;

  let finalStatus: 'COMPLETED' | 'COMPLETED_WITH_WARNINGS' | 'FAILED';
  let finalError: string | null = null;

  if (successCount === 0) {
    finalStatus = 'FAILED';
    finalError = 'All regions failed.';
  } else if (failCount > 0) {
    finalStatus = 'COMPLETED_WITH_WARNINGS';
  } else {
    finalStatus = 'COMPLETED';
  }

  const successfulResults = Object.fromEntries(
    successfulEntries.map(([r, v]) => [r, { topics: v.topics }])
  ) as Record<string, { topics: import('./opportunityGenerators').MarketPulseTopic[] }>;
  await supabase.from('market_pulse_jobs_v1').update({ progress_stage: 'CONSOLIDATING' }).eq('id', jobId);
  const consolidated = consolidateMarketPulseResults(successfulResults);
  const expiredRatio = 0;
  const confidenceIndex = computeConfidenceIndex(consolidated, expiredRatio);

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
