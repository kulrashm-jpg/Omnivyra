/**
 * Credit Advisor — Phase 15: Consumption Driver Analysis.
 *
 * Identifies the top consumption drivers (by module) with credits, percentage,
 * trend, and monthly-projected impact. Deterministic; composes the existing
 * module attribution + module aggregates. READ-ONLY.
 */

import type { ModuleAggregates } from './optimizationAggregates';
import type {
  AttributionRow,
  ConsumptionDriver,
  ModuleLabel,
} from './creditAdvisorTypes';

export function analyzeDrivers(
  byModule: AttributionRow[],
  agg: ModuleAggregates,
): ConsumptionDriver[] {
  return byModule
    .map((row) => ({
      module: row.label as ModuleLabel,
      credits: row.credits,
      percentage: row.percentage,
      trend: row.trend,
      projected_monthly_credits: Math.round(agg.monthlyCredits[row.key] ?? 0),
    }))
    .sort((a, b) => b.credits - a.credits);
}
