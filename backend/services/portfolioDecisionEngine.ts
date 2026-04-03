/**
 * Portfolio Decision Engine — Step 7
 *
 * Extends single-campaign decision making to multi-campaign optimization.
 * For a company running multiple concurrent campaigns, evaluates:
 *   - Budget reallocation (shift spend toward top performers)
 *   - Risk-adjusted scaling (conservative / balanced / aggressive modes)
 *   - Cross-campaign platform conflict resolution
 *
 * Persists decisions to `portfolio_decision_log`.
 */

import { supabase } from '../db/supabaseClient';
import { aggregateCampaignPerformance } from './performanceFeedbackService';
import { evaluateCampaignDecision } from './campaignDecisionEngine';
import { getAutonomousSettings } from './autonomousCampaignAgent';
import { logDecision } from './autonomousDecisionLogger';
import { deductCreditsAwaited as deductCredits } from './creditExecutionService';
import { archiveDecisionScope, createDecisionObjects, type PersistedDecisionObject } from './decisionObjectService';
import { loadNormalizedPortfolioInputs } from './normalizePortfolioInputsService';
import type { RiskTolerance } from './autonomousCampaignAgent';

export type CampaignPortfolioItem = {
  campaign_id: string;
  campaign_name: string;
  engagement_rate: number;
  action: string;
  ad_recommendation: string;
  current_budget_label: string;
  platform_priority: string[];
  performance_rank: number; // 1 = best
};

export type BudgetAllocation = {
  campaign_id: string;
  campaign_name: string;
  allocation_pct: number;
  reasoning: string;
};

export type RebalanceAction = {
  campaign_id: string;
  action_type: 'increase_budget' | 'decrease_budget' | 'maintain' | 'pause_campaign';
  magnitude: 'high' | 'medium' | 'low';
  reason: string;
};

export type PortfolioDecision = {
  company_id: string;
  campaigns: CampaignPortfolioItem[];
  budget_allocations: BudgetAllocation[];
  rebalance_actions: RebalanceAction[];
  reasoning: string[];
  total_budget_label: string;
  risk_mode: RiskTolerance;
};

// ── Risk-adjusted budget allocation weights ──────────────────────────────────
const RISK_ALLOCATION_WEIGHTS: Record<RiskTolerance, { top: number; mid: number; low: number }> = {
  aggressive:   { top: 0.70, mid: 0.25, low: 0.05 },
  balanced:     { top: 0.55, mid: 0.35, low: 0.10 },
  conservative: { top: 0.40, mid: 0.40, low: 0.20 },
};

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

export async function evaluatePortfolioDecision(companyId: string): Promise<PortfolioDecision | null> {
  const normalizedCampaigns = await loadNormalizedPortfolioInputs(companyId);
  if (!normalizedCampaigns?.length || normalizedCampaigns.length < 2) {
    return null; // Portfolio decisions need >= 2 campaigns
  }

  const activeCampaigns = normalizedCampaigns.map((row) => ({
    id: row.campaign_id,
    name: row.campaign_name,
  }));

  const settings = await getAutonomousSettings(companyId);
  const riskMode: RiskTolerance = settings?.risk_tolerance ?? 'balanced';
  const weights = RISK_ALLOCATION_WEIGHTS[riskMode];

  // ── Evaluate each campaign ────────────────────────────────────────────────
  const evaluations = await Promise.all(
    (activeCampaigns as Array<{ id: string; name: string }>).map(async c => {
      const [perf, decision] = await Promise.all([
        aggregateCampaignPerformance(c.id).catch(() => null),
        evaluateCampaignDecision(c.id).catch(() => null),
      ]);
      return {
        campaign_id:     c.id,
        campaign_name:   c.name,
        engagement_rate: perf?.engagement_rate ?? 0,
        action:          decision?.action ?? 'OPTIMIZE',
        ad_recommendation: decision?.ad_recommendation ?? 'NOT_NEEDED',
        current_budget_label: decision?.budget ?? '$0',
        platform_priority: decision?.platform_priority ?? [],
      };
    })
  );

  // ── Rank campaigns by engagement ──────────────────────────────────────────
  const ranked = [...evaluations].sort((a, b) => b.engagement_rate - a.engagement_rate);
  const portfolioItems: CampaignPortfolioItem[] = ranked.map((c, i) => ({
    ...c,
    performance_rank: i + 1,
  }));

  const n = portfolioItems.length;
  const topTier  = portfolioItems.slice(0, Math.ceil(n * 0.33));
  const midTier  = portfolioItems.slice(Math.ceil(n * 0.33), Math.ceil(n * 0.67));
  const lowTier  = portfolioItems.slice(Math.ceil(n * 0.67));

  const topShare = topTier.length > 0 ? weights.top / topTier.length : 0;
  const midShare = midTier.length > 0 ? weights.mid / midTier.length : 0;
  const lowShare = lowTier.length > 0 ? weights.low / lowTier.length : 0;

  // ── Budget allocations ────────────────────────────────────────────────────
  const budgetAllocations: BudgetAllocation[] = [
    ...topTier.map(c => ({
      campaign_id:    c.campaign_id,
      campaign_name:  c.campaign_name,
      allocation_pct: parseFloat((topShare * 100).toFixed(1)),
      reasoning:      `Top performer (rank ${c.performance_rank}) — ${riskMode} mode concentrates budget here`,
    })),
    ...midTier.map(c => ({
      campaign_id:    c.campaign_id,
      campaign_name:  c.campaign_name,
      allocation_pct: parseFloat((midShare * 100).toFixed(1)),
      reasoning:      `Mid performer (rank ${c.performance_rank}) — maintain and test`,
    })),
    ...lowTier.map(c => ({
      campaign_id:    c.campaign_id,
      campaign_name:  c.campaign_name,
      allocation_pct: parseFloat((lowShare * 100).toFixed(1)),
      reasoning:      `Low performer (rank ${c.performance_rank}) — minimal allocation until optimised`,
    })),
  ];

  // ── Rebalance actions ─────────────────────────────────────────────────────
  const rebalanceActions: RebalanceAction[] = portfolioItems.map(c => {
    if (c.performance_rank === 1) {
      return { campaign_id: c.campaign_id, action_type: 'increase_budget', magnitude: 'high', reason: `Top performer — concentrate ${riskMode} budget here` };
    }
    if (c.action === 'PAUSE') {
      return { campaign_id: c.campaign_id, action_type: 'pause_campaign', magnitude: 'high', reason: 'Decision engine recommends pause — free up budget for winners' };
    }
    if (c.performance_rank > Math.ceil(n * 0.67)) {
      return { campaign_id: c.campaign_id, action_type: 'decrease_budget', magnitude: 'medium', reason: 'Low performer — reduce spend until engagement improves' };
    }
    return { campaign_id: c.campaign_id, action_type: 'maintain', magnitude: 'low', reason: 'Stable performer — maintain current allocation' };
  });

  const reasoning: string[] = [
    `Portfolio of ${n} campaigns evaluated in ${riskMode} risk mode`,
    `Budget concentration: top ${(weights.top * 100).toFixed(0)}% / mid ${(weights.mid * 100).toFixed(0)}% / low ${(weights.low * 100).toFixed(0)}%`,
    `Top campaign: "${portfolioItems[0].campaign_name}" (${(portfolioItems[0].engagement_rate * 100).toFixed(2)}% engagement)`,
  ];

  if (rebalanceActions.some(a => a.action_type === 'pause_campaign')) {
    reasoning.push(`${rebalanceActions.filter(a => a.action_type === 'pause_campaign').length} campaign(s) flagged for pause — reallocate budget`);
  }

  // ── Persist decision ──────────────────────────────────────────────────────
  try {
    await supabase.from('portfolio_decision_log').insert({
      company_id:        companyId,
      campaign_ids:      portfolioItems.map(c => c.campaign_id),
      budget_allocations: budgetAllocations,
      rebalance_actions:  rebalanceActions,
      reasoning,
      created_at:        new Date().toISOString(),
    });
  } catch (_) { /* non-blocking */ }

  await logDecision({
    company_id:    companyId,
    decision_type: 'scale',
    reason:        `Portfolio rebalanced: ${n} campaigns, risk mode: ${riskMode}`,
    metrics_used:  {
      campaign_count: n,
      risk_mode:      riskMode,
      top_performer:  portfolioItems[0]?.campaign_name,
      pause_count:    rebalanceActions.filter(a => a.action_type === 'pause_campaign').length,
    },
  });

  await deductCredits(companyId, 'portfolio_decision', { note: `Portfolio rebalancing: ${rebalanceActions.length} actions` });

  return {
    company_id:         companyId,
    campaigns:          portfolioItems,
    budget_allocations: budgetAllocations,
    rebalance_actions:  rebalanceActions,
    reasoning,
    total_budget_label: 'See individual campaign ad recommendations',
    risk_mode:          riskMode,
  };
}

export async function generatePortfolioDecisionObjects(companyId: string): Promise<PersistedDecisionObject[]> {
  await archiveDecisionScope({
    company_id: companyId,
    report_tier: 'growth',
    source_service: 'portfolioDecisionEngine',
    entity_type: 'global',
    entity_id: null,
    changed_by: 'system',
  });

  const decision = await evaluatePortfolioDecision(companyId);
  if (!decision) return [];

  const topAllocation = decision.budget_allocations[0];
  const pauseCount = decision.rebalance_actions.filter((action) => action.action_type === 'pause_campaign').length;

  const drafts = [
    {
      company_id: companyId,
      report_tier: 'growth' as const,
      source_service: 'portfolioDecisionEngine',
      entity_type: 'global' as const,
      entity_id: null,
      issue_type: 'roi_inefficiency',
      title: 'Portfolio ROI efficiency can be improved through rebalancing',
      description: 'Current campaign mix can increase return by shifting allocation to stronger performers.',
      evidence: {
        risk_mode: decision.risk_mode,
        top_allocation: topAllocation,
        campaign_count: decision.campaigns.length,
      },
      impact_traffic: 24,
      impact_conversion: 52,
      impact_revenue: 58,
      priority_score: 66,
      effort_score: 26,
      confidence_score: 0.8,
      recommendation: 'Reallocate budget toward top-ranked performers while reducing low-performing spend.',
      action_type: 'adjust_strategy',
      action_payload: {
        optimization_focus: 'roi_inefficiency',
      },
      status: 'open' as const,
      last_changed_by: 'system' as const,
    },
    {
      company_id: companyId,
      report_tier: 'growth' as const,
      source_service: 'portfolioDecisionEngine',
      entity_type: 'global' as const,
      entity_id: null,
      issue_type: 'allocation_gap',
      title: 'Campaign allocation concentration differs from performance hierarchy',
      description: 'Portfolio weighting does not fully match measured campaign rank and engagement quality.',
      evidence: {
        budget_allocations: decision.budget_allocations,
        campaign_ranks: decision.campaigns.map((campaign) => ({
          campaign_id: campaign.campaign_id,
          rank: campaign.performance_rank,
          engagement_rate: campaign.engagement_rate,
        })),
      },
      impact_traffic: 18,
      impact_conversion: 48,
      impact_revenue: 54,
      priority_score: 63,
      effort_score: 22,
      confidence_score: 0.78,
      recommendation: 'Align allocation model to performance rank and update quarterly guardrails.',
      action_type: 'adjust_strategy',
      action_payload: {
        optimization_focus: 'allocation_gap',
      },
      status: 'open' as const,
      last_changed_by: 'system' as const,
    },
    {
      company_id: companyId,
      report_tier: 'growth' as const,
      source_service: 'portfolioDecisionEngine',
      entity_type: 'global' as const,
      entity_id: null,
      issue_type: 'spend_misalignment',
      title: 'Spend posture is misaligned with execution risk profile',
      description: 'Pause and reduce actions indicate current spending exceeds execution quality for parts of the portfolio.',
      evidence: {
        rebalance_actions: decision.rebalance_actions,
        pause_count: pauseCount,
      },
      impact_traffic: 14,
      impact_conversion: 44,
      impact_revenue: 50,
      priority_score: Math.max(52, Math.min(82, 58 + pauseCount * 5)),
      effort_score: 20,
      confidence_score: 0.76,
      recommendation: 'Constrain spend in campaigns with execution risk until reliability recovers.',
      action_type: 'adjust_strategy',
      action_payload: {
        optimization_focus: 'spend_misalignment',
      },
      status: 'open' as const,
      last_changed_by: 'system' as const,
    },
  ];

  return createDecisionObjects(drafts);
}
