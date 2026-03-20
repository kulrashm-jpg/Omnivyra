/**
 * Campaign Auto-Scaling Service — Step 7
 *
 * When a campaign shows high engagement AND high prediction confidence,
 * applies three scaling actions:
 *   1. Increase ad budget recommendation (stored in campaign_decision_log)
 *   2. Increase posting frequency (updates campaigns table)
 *   3. Flag winning content patterns for duplication (written to campaign_learnings)
 *
 * Thresholds: loaded from decision_engine_config (admin-tunable).
 */

import { supabase } from '../db/supabaseClient';
import { getDecisionConfig } from './configService';
import { aggregateCampaignPerformance } from './performanceFeedbackService';
import { logDecision } from './autonomousDecisionLogger';
import { upsertLearning } from './campaignLearningsStore';

export type ScalingResult = {
  campaign_id: string;
  scaled: boolean;
  actions: string[];
  reason: string;
};

/** Load current posting frequency for a campaign from its strategy or campaigns table. */
async function getCurrentFrequency(campaignId: string): Promise<Record<string, number>> {
  const { data } = await supabase
    .from('campaigns')
    .select('posting_frequency')
    .eq('id', campaignId)
    .maybeSingle();
  return ((data as any)?.posting_frequency as Record<string, number>) ?? {};
}

/** Get company_id for a campaign. */
async function getCompanyId(campaignId: string): Promise<string | null> {
  const { data } = await supabase
    .from('campaigns')
    .select('company_id')
    .eq('id', campaignId)
    .maybeSingle();
  return (data as any)?.company_id ?? null;
}

/**
 * Evaluate whether a campaign should be scaled and apply scaling actions.
 * Returns immediately if thresholds are not met.
 */
export async function tryAutoScale(campaignId: string): Promise<ScalingResult> {
  const result: ScalingResult = { campaign_id: campaignId, scaled: false, actions: [], reason: '' };

  const [perf, cfg, companyId] = await Promise.all([
    aggregateCampaignPerformance(campaignId),
    getDecisionConfig(),
    getCompanyId(campaignId),
  ]);

  const engagementRate = perf?.engagement_rate ?? 0;
  const accuracyScore  = perf?.accuracy_score  ?? 0;

  const highEngagement = engagementRate >= cfg.ad_scale_threshold;
  const highConfidence = accuracyScore >= cfg.accuracy_good_threshold;

  if (!highEngagement || !highConfidence) {
    result.reason = `Scale conditions not met: engagement=${(engagementRate * 100).toFixed(2)}% (need ${(cfg.ad_scale_threshold * 100).toFixed(1)}%), accuracy=${(accuracyScore * 100).toFixed(0)}% (need ${(cfg.accuracy_good_threshold * 100).toFixed(0)}%)`;
    return result;
  }

  result.scaled = true;

  // ── Action 1: Increase posting frequency by 20% ───────────────────────────
  const currentFreq = await getCurrentFrequency(campaignId);
  const boostedFreq: Record<string, number> = {};
  for (const [p, freq] of Object.entries(currentFreq)) {
    boostedFreq[p] = Math.round(freq * 1.2);
  }

  if (Object.keys(boostedFreq).length > 0) {
    await supabase.from('campaigns')
      .update({ posting_frequency: boostedFreq, updated_at: new Date().toISOString() })
      .eq('id', campaignId);
    result.actions.push(`Increased posting frequency +20%: ${JSON.stringify(boostedFreq)}`);
  }

  // ── Action 2: Log ad budget recommendation ───────────────────────────────
  const impressions  = perf?.impressions ?? 0;
  const monthlyBasis = Math.round(impressions / 1000) * 10;
  const minBudget    = Math.max(500, monthlyBasis);
  const maxBudget    = Math.max(2000, monthlyBasis * 3);

  await supabase.from('campaign_decision_log').insert({
    campaign_id:       campaignId,
    action:            'CONTINUE',
    ad_recommendation: 'SCALE',
    budget:            `$${minBudget}–$${maxBudget}/month`,
    platform_priority: Object.keys(currentFreq),
    reasoning:         [
      `High engagement (${(engagementRate * 100).toFixed(2)}%) — auto-scale triggered`,
      'Increase ad spend to amplify organic momentum',
    ],
    created_at: new Date().toISOString(),
  });
  result.actions.push(`Ad budget recommendation: $${minBudget}–$${maxBudget}/month`);

  // ── Action 3: Flag winning content patterns ───────────────────────────────
  if (companyId) {
    await upsertLearning({
      company_id:       companyId,
      campaign_id:      campaignId,
      learning_type:    'success',
      pattern:          `Campaign achieved ${(engagementRate * 100).toFixed(2)}% engagement — duplicate this content pattern`,
      engagement_impact: engagementRate,
      confidence:       Math.min(1, accuracyScore),
      sample_size:      Math.max(1, Math.round((perf?.impressions ?? 0) / 100)),
      metadata:         { engagement_rate: engagementRate, accuracy_score: accuracyScore, impressions },
    });
    result.actions.push('Winning content pattern saved to campaign learnings');
  }

  result.reason = `Auto-scaled: engagement ${(engagementRate * 100).toFixed(2)}% exceeds ${(cfg.ad_scale_threshold * 100).toFixed(1)}% threshold with ${(accuracyScore * 100).toFixed(0)}% confidence`;

  if (companyId) {
    await logDecision({
      company_id:    companyId,
      campaign_id:   campaignId,
      decision_type: 'scale',
      reason:        result.reason,
      metrics_used:  { engagement_rate: engagementRate, accuracy_score: accuracyScore },
      outcome:       result.actions.join('; '),
    });
  }

  return result;
}
