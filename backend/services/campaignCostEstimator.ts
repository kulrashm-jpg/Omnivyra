/**
 * Campaign Cost Estimator — Step 7
 *
 * Estimates the total credit cost of running a campaign plan end-to-end,
 * broken down by action type. Used to show users a cost preview before
 * activating a campaign or committing to an autonomous run.
 *
 * Estimation model:
 *   - Posts per platform = posting_frequency[platform] × duration_weeks
 *   - Each post = 1× auto_post + optional content_basic (if AI-generated)
 *   - Per-platform prediction = 1× prediction on creation
 *   - Optimization scans = ceil(duration_weeks / 2) × 1× campaign_optimization
 *   - Weekly insight scan = duration_weeks × 1× insight_generation
 *   - One-off: pattern_detection + competitor_signals + market_positioning
 */

import { getCreditCost, type CreditAction } from './creditDeductionService';

export type CampaignCostPlan = {
  platforms: string[];
  posting_frequency: Record<string, number>;
  duration_weeks: number;
  content_mix?: Record<string, number>;
  ai_content_generation?: boolean;
  include_intelligence?: boolean;
};

export type CostLineItem = {
  action: CreditAction;
  label: string;
  quantity: number;
  unit_cost: number;
  total: number;
};

export type CampaignCostEstimate = {
  line_items: CostLineItem[];
  subtotals: {
    execution: number;
    intelligence: number;
    optimization: number;
  };
  total_credits: number;
  per_week_avg: number;
  breakdown_by_action: Record<string, number>;
};

export async function estimateCampaignCost(plan: CampaignCostPlan): Promise<CampaignCostEstimate> {
  const {
    platforms,
    posting_frequency,
    duration_weeks,
    ai_content_generation = true,
    include_intelligence = true,
  } = plan;

  const lineItems: CostLineItem[] = [];
  const [
    autoPostCost,
    contentBasicCost,
    predictionCost,
    campaignOptimizationCost,
    insightGenerationCost,
    patternDetectionCost,
    competitorSignalsCost,
    marketPositioningCost,
  ] = await Promise.all([
    getCreditCost('auto_post'),
    getCreditCost('content_basic'),
    getCreditCost('prediction'),
    getCreditCost('campaign_optimization'),
    getCreditCost('insight_generation'),
    getCreditCost('pattern_detection'),
    getCreditCost('competitor_signals'),
    getCreditCost('market_positioning'),
  ]);

  let totalPosts = 0;
  for (const platform of platforms) {
    const freq = posting_frequency[platform] ?? 3;
    const posts = freq * duration_weeks;
    totalPosts += posts;

    lineItems.push({
      action: 'auto_post',
      label: `Auto-post: ${platform}`,
      quantity: posts,
      unit_cost: autoPostCost,
      total: posts * autoPostCost,
    });
  }

  if (ai_content_generation && totalPosts > 0) {
    lineItems.push({
      action: 'content_basic',
      label: 'AI content generation (per post)',
      quantity: totalPosts,
      unit_cost: contentBasicCost,
      total: totalPosts * contentBasicCost,
    });
  }

  lineItems.push({
    action: 'prediction',
    label: 'Campaign outcome prediction',
    quantity: 1,
    unit_cost: predictionCost,
    total: predictionCost,
  });

  const optimizationRounds = Math.ceil(duration_weeks / 2);
  lineItems.push({
    action: 'campaign_optimization',
    label: 'Optimization scans (bi-weekly)',
    quantity: optimizationRounds,
    unit_cost: campaignOptimizationCost,
    total: optimizationRounds * campaignOptimizationCost,
  });

  if (include_intelligence) {
    lineItems.push({
      action: 'insight_generation',
      label: 'Weekly insight generation',
      quantity: duration_weeks,
      unit_cost: insightGenerationCost,
      total: duration_weeks * insightGenerationCost,
    });

    const oneOffIntelligence: Array<{ action: CreditAction; label: string; cost: number }> = [
      { action: 'pattern_detection', label: 'Pattern detection scan', cost: patternDetectionCost },
      { action: 'competitor_signals', label: 'Competitor intelligence', cost: competitorSignalsCost },
      { action: 'market_positioning', label: 'Market positioning analysis', cost: marketPositioningCost },
    ];

    for (const { action, label, cost } of oneOffIntelligence) {
      lineItems.push({
        action,
        label,
        quantity: 1,
        unit_cost: cost,
        total: cost,
      });
    }
  }

  const executionActions = new Set<CreditAction>(['auto_post', 'content_basic', 'prediction']);
  const optimizationActions = new Set<CreditAction>(['campaign_optimization', 'optimization_loop']);

  const subtotals = { execution: 0, intelligence: 0, optimization: 0 };
  const breakdownByAction: Record<string, number> = {};

  for (const item of lineItems) {
    breakdownByAction[item.action] = (breakdownByAction[item.action] ?? 0) + item.total;

    if (executionActions.has(item.action)) subtotals.execution += item.total;
    else if (optimizationActions.has(item.action)) subtotals.optimization += item.total;
    else subtotals.intelligence += item.total;
  }

  const totalCredits = lineItems.reduce((sum, item) => sum + item.total, 0);

  return {
    line_items: lineItems,
    subtotals,
    total_credits: totalCredits,
    per_week_avg: Math.round(totalCredits / Math.max(duration_weeks, 1)),
    breakdown_by_action: breakdownByAction,
  };
}
