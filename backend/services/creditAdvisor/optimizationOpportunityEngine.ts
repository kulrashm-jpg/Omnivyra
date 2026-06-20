/**
 * Credit Advisor — Phase 13: Optimization Opportunity Engine.
 *
 * DETERMINISTIC, RULES-ONLY. NO LLM, NO AI, NO generative recommendations.
 * Applies the fixed OPTIMIZATION_LEVERS (Campaign / Market Pulse / Active Leads
 * / Creator / Content) to ACTUAL observed module consumption, computing
 * estimated savings per opportunity.
 */

import {
  OPTIMIZATION_LEVERS,
  priorityForSavings,
} from './optimizationKnowledgeBase';
import { estimateSavings } from './consumptionSavingsEstimator';
import type { ModuleAggregates } from './optimizationAggregates';
import type { ModuleLabel, OptimizationOpportunity } from './creditAdvisorTypes';

export function generateOpportunities(agg: ModuleAggregates): OptimizationOpportunity[] {
  const opportunities: OptimizationOpportunity[] = [];

  for (const lever of OPTIMIZATION_LEVERS) {
    const moduleMonthly = agg.monthlyCredits[lever.module] ?? 0;
    if (moduleMonthly < lever.min_monthly_credits) continue;

    const deepShare = agg.deepShare[lever.module] ?? 0;
    if (lever.requires_deep && deepShare <= 0) continue;

    // Target spend the lever acts on: the deep portion for deep-gated levers,
    // else the whole module's monthly spend.
    const targetMonthly = lever.requires_deep ? moduleMonthly * deepShare : moduleMonthly;
    if (targetMonthly < 1) continue;

    const savings = estimateSavings(targetMonthly, lever.savings_ratio);
    if (savings.potential_monthly_savings_credits < 1) continue;

    opportunities.push({
      rule: lever.rule,
      module: lever.module as ModuleLabel,
      category: lever.category,
      title: lever.title,
      detail: lever.detail,
      recommendation: lever.recommendation,
      priority: priorityForSavings(savings.potential_monthly_savings_credits),
      savings,
    });
  }

  return opportunities.sort(
    (a, b) => b.savings.potential_monthly_savings_credits - a.savings.potential_monthly_savings_credits,
  );
}
