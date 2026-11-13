import { ownedDbTable } from '../db/writeOwner';
/**
 * Market Pulse job processor v1.
 * Routes by insight_source: api (DB aggregation only), llm (per-region LLM), hybrid (both).
 */

import { supabase } from '../db/supabaseClient';
import { generateMarketPulseForRegion, type MarketPulseContextPayload } from './opportunityGenerators';
import { consolidateMarketPulseResults } from './marketPulseConsolidator';
import { aggregateMarketPulseFromDb, type AggregatedPulseSignal } from './marketPulseAggregationService';
import type { ConsolidatedPulseOutput } from './marketPulseConsolidator';
import { BilledAiNotExecutedError } from './billing/runBilledAiCompletion';
import { emitAnomaly } from './billing/billingAuditEmitter';
import {
  describeMarketPulseShortfall,
  notifyMarketPulseSkipped,
  precheckMarketPulseScan,
  resolveMarketPulseBillingUser,
  type MarketPulseScanShortfall,
} from './marketPulse/regionCharging';

type JobRow = {
  id: string;
  company_id: string;
  status: string;
  regions: string[];
  region_results?: Record<string, unknown> | null;
  context_payload?: (MarketPulseContextPayload & { insight_source?: 'api' | 'llm' | 'hybrid'; triggered_by_user_id?: string | null }) | null;
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

  const { data: job, error: fetchError } = await ownedDbTable('market_pulse_jobs_v1')
    .select('id, company_id, status, regions, context_payload, region_results')
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
    const { data: recheck } = await ownedDbTable('market_pulse_jobs_v1')
      .select('error')
      .eq('id', jobId)
      .single();
    return ((recheck?.error as string) ?? '').includes(CANCELLED_ERROR);
  }

  if (await isCancelled()) return;

  await ownedDbTable('market_pulse_jobs_v1')
    .update({ status: 'RUNNING', progress_stage: 'INITIALIZING' })
    .eq('id', jobId);

  const companyId = row.company_id;
  const regions = Array.isArray(row.regions) && row.regions.length > 0 ? row.regions : ['GLOBAL'];
  const contextPayload = row.context_payload ?? ({} as Record<string, unknown>);
  const insightSource = (contextPayload as { insight_source?: 'api' | 'llm' | 'hybrid' }).insight_source ?? 'hybrid';

  if (insightSource === 'api') {
    await ownedDbTable('market_pulse_jobs_v1').update({ progress_stage: 'SCANNING' }).eq('id', jobId);
    const signals = await aggregateMarketPulseFromDb(companyId, regions);
    const consolidated = aggregatedToConsolidated(signals);
    const confidenceIndex = computeConfidenceIndex(consolidated, 0);
    await ownedDbTable('market_pulse_jobs_v1')
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

  // Owner ruling 2026-11-13: every region LLM call is charged (one insight_generation each). Whole-scan pre-check
  // first: if the company cannot cover every region at the floor price (or pricing cannot be resolved), the scan is
  // skipped - no LLM call, nothing charged - and the company admins are notified.
  const precheck = await precheckMarketPulseScan(companyId, regions.length);
  if (!precheck.ok) {
    const message = describeMarketPulseShortfall(precheck as MarketPulseScanShortfall);
    await notifyMarketPulseSkipped(companyId, message);
    await ownedDbTable('market_pulse_jobs_v1')
      .update({ progress_stage: 'FINISHED', status: 'FAILED', error: message, completed_at: now })
      .eq('id', jobId);
    return;
  }
  const billingUserId = resolveMarketPulseBillingUser(
    companyId,
    (contextPayload as { triggered_by_user_id?: unknown }).triggered_by_user_id,
  );

  type RegionError = { error: true; message: string; code?: 'INSUFFICIENT_CREDITS' | 'CHARGED_NO_OUTPUT' | 'ALREADY_RELEASED'; charged?: boolean };
  const regionResults: Record<string, { topics: { topic: string; spike_reason: string; shelf_life_days: number; risk_level: string; priority_score: number; velocity_score?: number; momentum_score?: number; narrative_phase?: string }[]; credits_charged?: number } | RegionError> = {};
  // Results already stored by an earlier attempt of this job (a retry after a crash): a region whose charge was
  // already confirmed keeps them instead of being overwritten (e1 review 2026-11-13).
  const priorResults = (row.region_results && typeof row.region_results === 'object' ? row.region_results : {}) as Record<string, unknown>;
  const chargedRegions: string[] = [];
  let creditStop: string | null = null;

  for (const region of regions) {
    if (await isCancelled()) return;
    if (creditStop) {
      // A region hold was refused: the remaining regions are not run (and not charged).
      regionResults[region] = { error: true, code: 'INSUFFICIENT_CREDITS', charged: false, message: creditStop };
      continue;
    }
    await ownedDbTable('market_pulse_jobs_v1').update({ progress_stage: 'SCANNING' }).eq('id', jobId);
    try {
      const result = await generateMarketPulseForRegion(
        companyId,
        region,
        contextPayload,
        { referenceType: 'opportunity_discovery', referenceId: jobId, parentActivityId: companyId },
        { userId: billingUserId, jobId },
      );
      regionResults[region] = { topics: result.topics, credits_charged: result.creditsCharged };
      chargedRegions.push(region);

      for (const t of result.topics) {
        await ownedDbTable('market_pulse_items_v1').insert({
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
      const prior = priorResults[region] as { topics?: unknown } | undefined;
      if (err instanceof BilledAiNotExecutedError && err.status === 'already_confirmed') {
        // This (job, region) was already CHARGED by an earlier attempt. Keep its stored output; if none was stored
        // the customer paid for nothing - record it explicitly and raise an ops-visible anomaly for refund / re-run.
        if (prior && Array.isArray(prior.topics)) {
          regionResults[region] = prior as (typeof regionResults)[string];
        } else {
          regionResults[region] = {
            error: true,
            charged: true,
            code: 'CHARGED_NO_OUTPUT',
            message: `Region ${region} was charged by an earlier attempt of this scan but its result was not saved; flagged for an operator to refund or re-run`,
          };
          emitAnomaly({
            organizationId: companyId,
            kind: 'charged_no_output',
            severity: 'critical',
            message: 'market_pulse_region_charged_without_output',
            metadata: { job_id: jobId, region, action: 'insight_generation' },
          });
        }
      } else if (err instanceof BilledAiNotExecutedError && err.status === 'already_released') {
        // An earlier attempt failed and its hold was released (nothing charged); the same key will not run again.
        regionResults[region] = {
          error: true,
          charged: false,
          code: 'ALREADY_RELEASED',
          message: `Region ${region} failed in an earlier attempt of this scan and was not charged; start a new scan to retry it`,
        };
      } else if (err instanceof BilledAiNotExecutedError) {
        // insufficient_credits / no_credit_account / org_control_blocked: stop the scan and tell the admins which
        // regions completed (and were charged) before the stop.
        const done = chargedRegions.length > 0 ? `completed and charged: ${chargedRegions.join(', ')}` : 'no region was completed or charged';
        creditStop = `${err.status}: Market Pulse stopped before region ${region} (${done}); remaining regions were not run or charged`;
        await notifyMarketPulseSkipped(companyId, creditStop);
        regionResults[region] = { error: true, code: 'INSUFFICIENT_CREDITS', charged: false, message: creditStop };
      } else {
        regionResults[region] = { error: true, message: err instanceof Error ? err.message : 'Region analysis failed' };
      }
    }
    await ownedDbTable('market_pulse_jobs_v1').update({ region_results: regionResults }).eq('id', jobId);
  }

  let consolidated: ConsolidatedPulseOutput;

  if (await isCancelled()) return;

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
      await ownedDbTable('market_pulse_jobs_v1')
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

  if (await isCancelled()) return;

  await ownedDbTable('market_pulse_jobs_v1')
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
