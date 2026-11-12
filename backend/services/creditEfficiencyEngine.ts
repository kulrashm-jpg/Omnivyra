import { ownedDbTable } from '../db/writeOwner';
/**
 * Credit Efficiency Engine
 *
 * Analyzes a company's historical credits_per_outcome and applies
 * a compound optimization strategy:
 *   1. Content type pruning — reduce/stop low-ROI content types
 *   2. Pattern reuse      — inject winning patterns; skip re-detection if recent
 *   3. Prediction skip    — skip prediction when confidence already high (>0.8)
 *   4. Campaign compression — reduce duration/platforms when credits are low
 *   5. Efficiency tier upgrade — reduce credit costs for consistently efficient orgs
 *
 * Run after each campaign cycle or on-demand via API.
 */

import { supabase } from '../db/supabaseClient';
import { getCreditCost } from './creditDeductionService';
import { getCompanyOutcomeStats } from './outcomeTrackingService';
import { amplifyWinningPatterns } from './patternAmplificationService';

const TIER_THRESHOLDS = {
  elite: 5,
  optimized: 15,
  efficient: 30,
};

const TIER_DISCOUNTS: Record<string, number> = {
  elite: 0.6,
  optimized: 0.75,
  efficient: 0.88,
  standard: 1.0,
};

export type ContentTypeROI = {
  content_type: string;
  avg_outcome_score: number;
  avg_credits_per_outcome: number;
  sample_count: number;
  recommendation: 'amplify' | 'maintain' | 'reduce' | 'stop';
};

export type EfficiencyReport = {
  company_id: string;
  efficiency_tier: string;
  discount_multiplier: number;
  avg_credits_per_outcome: number;
  content_type_roi: ContentTypeROI[];
  actions_taken: string[];
  credits_saved_estimate: number;
  amplification_context: string;
  computed_at: string;
};

async function getContentTypeROI(companyId: string): Promise<ContentTypeROI[]> {
  // A failed read is not "no ROI data". Throw (the efficiency route / cron
  // reports the failure instead of an empty analysis).
  const { data, error } = await ownedDbTable('content_type_efficiency')
    .select('content_type, avg_outcome_score, avg_credits_per_outcome, sample_count, recommendation')
    .eq('company_id', companyId)
    .order('avg_credits_per_outcome', { ascending: true });
  if (error) throw new Error(`[creditEfficiency] content ROI read failed for ${companyId}: ${error.message}`);

  if (data?.length) return data as ContentTypeROI[];

  await ownedDbTable('performance_feedback')
    .select('content_type, engagement_rate')
    .eq(
      'campaign_id',
      ownedDbTable('campaigns').select('id').eq('company_id', companyId).limit(5) as any,
    );

  return [];
}

async function upsertEfficiencyTier(
  orgId: string,
  tier: string,
  discount: number,
  avgCPO: number,
  totalOutcomes: number,
  creditsSaved: number,
): Promise<void> {
  // best-effort: the computed tier is still returned to the caller; a failed
  // persist only leaves the stored score stale. Logged.
  const { error: upsertErr } = await ownedDbTable('credit_efficiency_scores').upsert(
    {
      organization_id: orgId,
      efficiency_tier: tier,
      discount_multiplier: discount,
      credits_per_outcome_avg: avgCPO,
      total_outcomes: totalOutcomes,
      credits_saved_total: creditsSaved,
      computed_at: new Date().toISOString(),
    },
    { onConflict: 'organization_id' },
  );
  if (upsertErr) console.error('[creditEfficiency] score persist failed:', orgId, upsertErr.message);
}

function determineTier(avgCPO: number, totalOutcomes: number): { tier: string; discount: number } {
  if (totalOutcomes < 3) return { tier: 'standard', discount: 1.0 };
  if (avgCPO <= TIER_THRESHOLDS.elite) return { tier: 'elite', discount: TIER_DISCOUNTS.elite };
  if (avgCPO <= TIER_THRESHOLDS.optimized) return { tier: 'optimized', discount: TIER_DISCOUNTS.optimized };
  if (avgCPO <= TIER_THRESHOLDS.efficient) return { tier: 'efficient', discount: TIER_DISCOUNTS.efficient };
  return { tier: 'standard', discount: TIER_DISCOUNTS.standard };
}

/**
 * PRICING (e9, 2026-11-12):
 *  - the tier is computed ONLY from campaigns with a real outcome (outcome_score
 *    > 0); empty campaigns (cpo = credits_used, a small number) used to earn
 *    ELITE (a 40% discount) after 3 of them. The 3-campaign floor applies to
 *    SCORED campaigns.
 *  - the price-bearing write (credit_efficiency_scores tier / discount) happens
 *    ONLY when `persistTier` is true - the server-side cron. A member-triggered
 *    run (POST /api/companies/:id/efficiency) computes a preview and writes
 *    nothing price-bearing.
 */
export async function optimizeCreditEfficiency(companyId: string, opts?: { persistTier?: boolean }): Promise<EfficiencyReport> {
  const persistTier = opts?.persistTier === true;
  const computedAt = new Date().toISOString();
  const actionsTaken: string[] = [];
  let creditsSavedEstimate = 0;
  const [contentBasicCost, patternDetectionCost, predictionCost] = await Promise.all([
    getCreditCost('content_basic'),
    getCreditCost('pattern_detection'),
    getCreditCost('prediction'),
  ]);

  const outcomeStats = await getCompanyOutcomeStats(companyId);
  const { avg_scored_credits_per_outcome: avgCPO, scored_outcomes: totalOutcomes } = outcomeStats;

  const { tier, discount } = determineTier(avgCPO, totalOutcomes);
  if (persistTier) await upsertEfficiencyTier(companyId, tier, discount, avgCPO, totalOutcomes, 0);

  if (tier !== 'standard') {
    const savedPct = Math.round((1 - discount) * 100);
    actionsTaken.push(`Upgraded to ${tier} tier — ${savedPct}% discount on intelligence actions`);
    creditsSavedEstimate += Math.round(60 * (1 - discount) * totalOutcomes);
  }

  const contentROI = await getContentTypeROI(companyId);
  const toStop = contentROI.filter((row) => row.recommendation === 'stop');
  const toReduce = contentROI.filter((row) => row.recommendation === 'reduce');

  for (const item of toStop) {
    actionsTaken.push(
      `STOP ${item.content_type}: avg ${item.avg_credits_per_outcome.toFixed(1)} credits/outcome — below threshold`,
    );
    creditsSavedEstimate += Math.round(contentBasicCost * 4);
  }

  for (const item of toReduce) {
    actionsTaken.push(`REDUCE ${item.content_type}: frequency cut 40%`);
    creditsSavedEstimate += Math.round(contentBasicCost * 2);
  }

  const amplificationResult = await amplifyWinningPatterns(companyId);

  if (amplificationResult.amplified.length > 0) {
    const types = amplificationResult.amplified.map((row) => row.content_type).join(', ');
    actionsTaken.push(`AMPLIFY patterns: ${types} — reusing across campaigns (skip re-detection)`);
    creditsSavedEstimate += patternDetectionCost;
  }

  if (totalOutcomes >= 5 && avgCPO < TIER_THRESHOLDS.efficient) {
    actionsTaken.push(
      `SKIP low-value predictions: confidence baseline established after ${totalOutcomes} campaigns`,
    );
    creditsSavedEstimate += predictionCost * 2;
  }

  // (2026-11-12) This was `void <builder>` - a supabase query builder is LAZY
  // and only executes when awaited / then-ed, so credits_saved_total was NEVER
  // written. Awaited now; best-effort (the report is returned either way), logged.
  if (persistTier) {
    const { error: savedErr } = await ownedDbTable('credit_efficiency_scores')
      .update({ credits_saved_total: creditsSavedEstimate, computed_at: computedAt })
      .eq('organization_id', companyId);
    if (savedErr) console.error('[creditEfficiency] credits-saved persist failed:', companyId, savedErr.message);
  }

  return {
    company_id: companyId,
    efficiency_tier: tier,
    discount_multiplier: discount,
    avg_credits_per_outcome: avgCPO,
    content_type_roi: contentROI,
    actions_taken: actionsTaken,
    credits_saved_estimate: creditsSavedEstimate,
    amplification_context: amplificationResult.prompt_context,
    computed_at: computedAt,
  };
}

export async function getEfficiencyDiscount(orgId: string): Promise<number> {
  // A failed read is not "no discount" - throw. (2026-11-12: the only consumer,
  // creditPriorityEngine.prioritizeActions, has no callers, so no charge uses
  // this today; it must still never price on an unread multiplier.)
  const { data, error } = await ownedDbTable('credit_efficiency_scores')
    .select('discount_multiplier')
    .eq('organization_id', orgId)
    .maybeSingle();
  if (error) throw new Error(`[creditEfficiency] discount read failed for ${orgId}: ${error.message}`);
  return (data as any)?.discount_multiplier ?? 1.0;
}

export async function getEfficiencyTier(orgId: string): Promise<string> {
  const { data, error } = await ownedDbTable('credit_efficiency_scores')
    .select('efficiency_tier')
    .eq('organization_id', orgId)
    .maybeSingle();
  if (error) throw new Error(`[creditEfficiency] tier read failed for ${orgId}: ${error.message}`);
  return (data as any)?.efficiency_tier ?? 'standard';
}
