/**
 * Credit Advisor — Phase 2: Attribution Coverage.
 *
 * Reports how much spend resolves to a real module vs "Other", a per-module
 * breakdown, and the top unresolved action gaps. Deterministic, READ-ONLY.
 */

import type { ConsumptionRow } from './consumptionMetricsService';
import { moduleForActionKey } from './creditAdvisorTaxonomy';
import type { AttributionCoverage, AttributionRow, TrendDirection } from './creditAdvisorTypes';

export function computeCoverage(rows: ConsumptionRow[]): AttributionCoverage {
  let total = 0;
  let attributed = 0;
  const moduleCredits: Record<string, number> = {};
  const gapCredits: Record<string, number> = {};

  for (const r of rows) {
    total += r.credits;
    const m = moduleForActionKey(r.action);
    moduleCredits[m] = (moduleCredits[m] ?? 0) + r.credits;
    if (m !== 'Other') attributed += r.credits;
    else gapCredits[r.action] = (gapCredits[r.action] ?? 0) + r.credits;
  }

  const by_module: AttributionRow[] = Object.entries(moduleCredits)
    .map(([key, credits]) => ({
      key,
      label: key,
      credits: Math.round(credits),
      percentage: total > 0 ? Math.round((credits / total) * 1000) / 10 : 0,
      trend: 'flat' as TrendDirection,
    }))
    .sort((a, b) => b.credits - a.credits);

  const top_gaps = Object.entries(gapCredits)
    .map(([action, credits]) => ({
      action,
      credits: Math.round(credits),
      percentage: total > 0 ? Math.round((credits / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.credits - a.credits)
    .slice(0, 5);

  const coverage_pct = total > 0 ? Math.round((attributed / total) * 1000) / 10 : 100;

  return {
    coverage_pct,
    other_pct: Math.round((100 - coverage_pct) * 10) / 10,
    by_module,
    top_gaps,
  };
}
