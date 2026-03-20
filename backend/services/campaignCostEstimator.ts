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

import { CREDIT_COSTS, type CreditAction } from './creditDeductionService';

// ── Types ─────────────────────────────────────────────────────────────────────

export type CampaignCostPlan = {
  platforms: string[];
  posting_frequency: Record<string, number>;  // posts per week per platform
  duration_weeks: number;
  content_mix?: Record<string, number>;
  /** If true, AI generates content for every post (adds content_basic per post). */
  ai_content_generation?: boolean;
  /** If false, skip intelligence analysis costs. Default: true */
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

// ── Estimator ─────────────────────────────────────────────────────────────────

export function estimateCampaignCost(plan: CampaignCostPlan): CampaignCostEstimate {
  const {
    platforms,
    posting_frequency,
    duration_weeks,
    ai_content_generation = true,
    include_intelligence  = true,
  } = plan;

  const lineItems: CostLineItem[] = [];

  // ── Execution costs ───────────────────────────────────────────────────────

  let totalPosts = 0;
  for (const platform of platforms) {
    const freq = posting_frequency[platform] ?? 3;
    const posts = freq * duration_weeks;
    totalPosts += posts;

    lineItems.push({
      action:    'auto_post',
      label:     `Auto-post: ${platform}`,
      quantity:  posts,
      unit_cost: CREDIT_COSTS.auto_post,
      total:     posts * CREDIT_COSTS.auto_post,
    });
  }

  if (ai_content_generation && totalPosts > 0) {
    lineItems.push({
      action:    'content_basic',
      label:     'AI content generation (per post)',
      quantity:  totalPosts,
      unit_cost: CREDIT_COSTS.content_basic,
      total:     totalPosts * CREDIT_COSTS.content_basic,
    });
  }

  // ── Prediction cost (once at creation) ───────────────────────────────────

  lineItems.push({
    action:    'prediction',
    label:     'Campaign outcome prediction',
    quantity:  1,
    unit_cost: CREDIT_COSTS.prediction,
    total:     CREDIT_COSTS.prediction,
  });

  // ── Optimization scans (every 2 weeks) ───────────────────────────────────

  const optimizationRounds = Math.ceil(duration_weeks / 2);
  lineItems.push({
    action:    'campaign_optimization',
    label:     'Optimization scans (bi-weekly)',
    quantity:  optimizationRounds,
    unit_cost: CREDIT_COSTS.campaign_optimization,
    total:     optimizationRounds * CREDIT_COSTS.campaign_optimization,
  });

  // ── Intelligence analysis (one-off) ──────────────────────────────────────

  if (include_intelligence) {
    lineItems.push({
      action:    'insight_generation',
      label:     'Weekly insight generation',
      quantity:  duration_weeks,
      unit_cost: CREDIT_COSTS.insight_generation,
      total:     duration_weeks * CREDIT_COSTS.insight_generation,
    });

    const oneOffIntelligence: Array<{ action: CreditAction; label: string }> = [
      { action: 'pattern_detection',  label: 'Pattern detection scan'    },
      { action: 'competitor_signals', label: 'Competitor intelligence'   },
      { action: 'market_positioning', label: 'Market positioning analysis' },
    ];

    for (const { action, label } of oneOffIntelligence) {
      lineItems.push({
        action,
        label,
        quantity:  1,
        unit_cost: CREDIT_COSTS[action],
        total:     CREDIT_COSTS[action],
      });
    }
  }

  // ── Aggregate ─────────────────────────────────────────────────────────────

  const executionActions  = new Set<CreditAction>(['auto_post', 'content_basic', 'prediction']);
  const optimizationActions = new Set<CreditAction>(['campaign_optimization', 'optimization_loop']);

  const subtotals = { execution: 0, intelligence: 0, optimization: 0 };
  const breakdownByAction: Record<string, number> = {};

  for (const item of lineItems) {
    const key = item.action as string;
    breakdownByAction[key] = (breakdownByAction[key] ?? 0) + item.total;

    if (executionActions.has(item.action))    subtotals.execution    += item.total;
    else if (optimizationActions.has(item.action)) subtotals.optimization += item.total;
    else                                           subtotals.intelligence  += item.total;
  }

  const totalCredits = lineItems.reduce((sum, i) => sum + i.total, 0);

  return {
    line_items:          lineItems,
    subtotals,
    total_credits:       totalCredits,
    per_week_avg:        Math.round(totalCredits / Math.max(duration_weeks, 1)),
    breakdown_by_action: breakdownByAction,
  };
}
