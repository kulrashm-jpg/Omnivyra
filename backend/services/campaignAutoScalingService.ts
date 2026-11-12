import { ownedDbTable } from '../db/writeOwner';
/**
 * Campaign Auto-Scaling Service — Step 7
 *
 * When a campaign shows high engagement AND high prediction confidence, it SUGGESTS:
 *   1. An ad budget recommendation (stored in campaign_decision_log)
 *   2. Winning content patterns for duplication (written to campaign_learnings)
 *
 * It NEVER changes the customer's campaign (e9 ruling, 2026-11-12; owner: campaign health is
 * SUGGEST-ONLY). It used to raise campaigns.posting_frequency by 20% on EVERY healthy run, with no cap
 * and no once-per-period guard (about 2x a day at the 6-hourly cadence), and the schedulers read
 * posting_frequency. That write is removed; posting_frequency is only READ, for platform priority.
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
  /** Actions that were attempted and FAILED (unread-error pkg 2): never reported in `actions`. */
  failed_actions: string[];
  reason: string;
};

/*
 * unread-error pkg 2: PostgREST returns an error, never throws. Each read below used to turn a failure
 * into "no frequency" / "no company" (silently skipping the actions); each write used to report its
 * action as done whatever happened. Reads now throw (nothing has been written yet); a write that fails
 * is recorded in failed_actions.
 */

/** Load current posting frequency for a campaign from its strategy or campaigns table. */
async function getCurrentFrequency(campaignId: string): Promise<Record<string, number>> {
  const { data, error } = await ownedDbTable('campaigns')
    .select('posting_frequency')
    .eq('id', campaignId)
    .maybeSingle();
  if (error) throw new Error(`auto-scale: posting_frequency unreadable: ${error.message}`);
  return ((data as any)?.posting_frequency as Record<string, number>) ?? {};
}

/** Get company_id for a campaign. */
async function getCompanyId(campaignId: string): Promise<string | null> {
  const { data, error } = await ownedDbTable('campaigns')
    .select('company_id')
    .eq('id', campaignId)
    .maybeSingle();
  if (error) throw new Error(`auto-scale: company_id unreadable: ${error.message}`);
  return (data as any)?.company_id ?? null;
}

/**
 * Evaluate whether a campaign should be scaled and apply scaling actions.
 * Returns immediately if thresholds are not met.
 */
export async function tryAutoScale(campaignId: string): Promise<ScalingResult> {
  const result: ScalingResult = { campaign_id: campaignId, scaled: false, actions: [], failed_actions: [], reason: '' };

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

  // Read only (platform priority for the recommendation). SUGGEST-ONLY: posting_frequency is never
  // written here (e9 ruling, 2026-11-12).
  const currentFreq = await getCurrentFrequency(campaignId);

  // ── Suggestion 1: Log ad budget recommendation ───────────────────────────
  const impressions  = perf?.impressions ?? 0;
  const monthlyBasis = Math.round(impressions / 1000) * 10;
  const minBudget    = Math.max(500, monthlyBasis);
  const maxBudget    = Math.max(2000, monthlyBasis * 3);

  const { error: decisionLogError } = await ownedDbTable('campaign_decision_log').insert({
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
  if (decisionLogError) {
    result.failed_actions.push(`Ad budget recommendation not recorded: ${decisionLogError.message}`);
  } else {
    result.actions.push(`Ad budget recommendation: $${minBudget}–$${maxBudget}/month`);
  }

  // ── Suggestion 2: Flag winning content patterns ──────────────────────────
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
      outcome:       [...result.actions, ...result.failed_actions.map((f) => `FAILED: ${f}`)].join('; '),
    });
  }

  return result;
}
