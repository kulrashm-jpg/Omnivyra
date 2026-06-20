/**
 * Credit Advisor — Phase 12: Automation Consumption Visibility.
 *
 * Builds an AutomationConsumptionReport from the deterministic automation
 * registry + ACTUAL observed module consumption (monthly-extrapolated). Each
 * automation's estimate = its module's observed monthly credits × its registry
 * weight, so it never invents spend the org isn't actually generating. READ-ONLY.
 */

import {
  AUTOMATION_REGISTRY,
  classifyMonthlyCredits,
} from './optimizationKnowledgeBase';
import type {
  AutomationConsumptionReport,
  AutomationConsumptionRow,
  AutomationStatus,
  ModuleLabel,
} from './creditAdvisorTypes';

/**
 * @param moduleMonthlyCredits  module → monthly-extrapolated observed credits
 * @param creditRateUsd         USD per credit (from wallet)
 * @param windowDays            analysis window the monthly figures were derived from
 */
export function buildAutomationReport(
  moduleMonthlyCredits: Record<string, number>,
  creditRateUsd: number,
  windowDays: number,
): AutomationConsumptionReport {
  const rows: AutomationConsumptionRow[] = AUTOMATION_REGISTRY.map((def) => {
    const moduleMonthly = moduleMonthlyCredits[def.module] ?? 0;
    const estimated = Math.round(moduleMonthly * def.module_weight);

    let status: AutomationStatus;
    if (def.default_off) status = 'disabled_by_default';
    else status = estimated > 0 ? 'active' : 'idle';

    return {
      id: def.id,
      name: def.name,
      module: def.module as ModuleLabel,
      status,
      cadence_label: def.cadence_label,
      estimated_monthly_credits: estimated,
      estimated_monthly_cost_usd: Math.round(estimated * creditRateUsd * 100) / 100,
      classification: classifyMonthlyCredits(estimated),
    };
  }).sort((a, b) => b.estimated_monthly_credits - a.estimated_monthly_credits);

  const total_monthly_credits = rows.reduce((s, r) => s + r.estimated_monthly_credits, 0);

  return {
    rows,
    total_monthly_credits,
    total_monthly_cost_usd: Math.round(total_monthly_credits * creditRateUsd * 100) / 100,
    window_days: windowDays,
  };
}
