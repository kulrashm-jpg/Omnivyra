/**
 * Campaign Decision Engine
 *
 * Evaluates campaign performance and returns a structured decision:
 *   action          : CONTINUE | OPTIMIZE | PAUSE
 *   ad_recommendation: NOT_NEEDED | TEST | SCALE
 *   budget          : suggested budget range string
 *   platform_priority: platforms ranked by performance (best → worst)
 *
 * Called after each performance analysis cycle and stored in DB.
 * Used by the next planning cycle to shape platform allocation and budget.
 */

import { supabase } from '../db/supabaseClient';
import { aggregateCampaignPerformance } from './performanceFeedbackService';
import { rankPlatformsByPerformance } from './platformPerformanceRanker';
import { getDecisionConfig } from './configService';

export type CampaignDecisionAction = 'CONTINUE' | 'OPTIMIZE' | 'PAUSE';
export type AdRecommendation = 'NOT_NEEDED' | 'TEST' | 'SCALE';

export type CampaignDecision = {
  campaign_id: string;
  action: CampaignDecisionAction;
  ad_recommendation: AdRecommendation;
  budget: string;
  platform_priority: string[];
  reasoning: string[];
  evaluated_at: string;
};

export async function evaluateCampaignDecision(campaignId: string): Promise<CampaignDecision> {
  const now = new Date().toISOString();
  const reasoning: string[] = [];

  const [perf, platformRanking, cfg] = await Promise.all([
    aggregateCampaignPerformance(campaignId),
    rankPlatformsByPerformance(campaignId),
    getDecisionConfig(),
  ]);

  const engagementRate = perf?.engagement_rate ?? 0;
  const accuracyScore  = perf?.accuracy_score  ?? 0.5;
  const topPlatforms   = platformRanking.map((r) => r.platform);

  // ── Action decision (thresholds from DB config) ───────────────────────────
  let action: CampaignDecisionAction;
  if (engagementRate < cfg.min_engagement_threshold) {
    action = 'PAUSE';
    reasoning.push(`Engagement ${(engagementRate * 100).toFixed(2)}% is below ${(cfg.min_engagement_threshold * 100).toFixed(1)}% threshold`);
  } else if (engagementRate >= cfg.ad_scale_threshold && accuracyScore >= cfg.accuracy_good_threshold) {
    action = 'CONTINUE';
    reasoning.push(`Strong engagement ${(engagementRate * 100).toFixed(2)}% with high accuracy ${(accuracyScore * 100).toFixed(0)}%`);
  } else {
    action = 'OPTIMIZE';
    reasoning.push(`Moderate engagement ${(engagementRate * 100).toFixed(2)}% — content mix or platform allocation needs adjustment`);
  }

  // ── Ad recommendation (thresholds from DB config) ─────────────────────────
  let adRecommendation: AdRecommendation;
  let budget: string;
  if (action === 'PAUSE') {
    adRecommendation = 'NOT_NEEDED';
    budget = '$0 — pause before investing in paid';
    reasoning.push('No paid spend recommended while campaign is under-performing');
  } else if (action === 'CONTINUE' && engagementRate >= cfg.ad_scale_threshold) {
    adRecommendation = 'SCALE';
    const monthly = Math.round(perf?.impressions ?? 0 / 1000) * 10;
    budget = `$${Math.max(500, monthly)}–$${Math.max(2000, monthly * 3)}/month`;
    reasoning.push('Strong organic results — scale with paid amplification');
  } else if (engagementRate >= cfg.ad_test_threshold) {
    adRecommendation = 'TEST';
    budget = '$200–$500/month test budget';
    reasoning.push('Test paid on top-performing platform before scaling');
  } else {
    adRecommendation = 'NOT_NEEDED';
    budget = '$0 — improve organic performance first';
    reasoning.push('Engagement too low for paid — focus on content quality first');
  }

  if (topPlatforms.length > 0) {
    reasoning.push(`Top platform: ${topPlatforms[0]} — prioritise budget here`);
  }

  const decision: CampaignDecision = {
    campaign_id: campaignId,
    action,
    ad_recommendation: adRecommendation,
    budget,
    platform_priority: topPlatforms,
    reasoning,
    evaluated_at: now,
  };

  // Persist decision
  try {
    await supabase.from('campaign_decision_log').insert({
      campaign_id: campaignId,
      action,
      ad_recommendation: adRecommendation,
      budget,
      platform_priority: topPlatforms,
      reasoning,
      created_at: now,
    });
  } catch (_) { /* non-blocking */ }

  return decision;
}
