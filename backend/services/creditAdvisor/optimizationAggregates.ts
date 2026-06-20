/**
 * Credit Advisor — module aggregate helper (shared by the optimization layer).
 *
 * Computes, from raw consumption rows: per-module window credits, per-module
 * monthly-extrapolated credits, and the deep/heavy-variant share per module.
 * Pure, deterministic. READ-ONLY (operates on already-read rows).
 */

import type { ConsumptionRow } from './consumptionMetricsService';
import { moduleForActionKey, isDeepVariant } from './creditAdvisorTaxonomy';

export interface ModuleAggregates {
  /** module → credits within the analysis window. */
  windowCredits: Record<string, number>;
  /** module → monthly-extrapolated credits. */
  monthlyCredits: Record<string, number>;
  /** module → fraction (0..1) of that module's credits from deep/heavy variants. */
  deepShare: Record<string, number>;
  totalWindowCredits: number;
}

export function computeModuleAggregates(
  rows: ConsumptionRow[],
  windowDays: number,
): ModuleAggregates {
  const windowCredits: Record<string, number> = {};
  const deepCredits: Record<string, number> = {};
  let total = 0;

  for (const r of rows) {
    const m = moduleForActionKey(r.action);
    windowCredits[m] = (windowCredits[m] ?? 0) + r.credits;
    if (isDeepVariant(r.action)) deepCredits[m] = (deepCredits[m] ?? 0) + r.credits;
    total += r.credits;
  }

  const scale = windowDays > 0 ? 30 / windowDays : 1;
  const monthlyCredits: Record<string, number> = {};
  const deepShare: Record<string, number> = {};
  for (const m of Object.keys(windowCredits)) {
    monthlyCredits[m] = windowCredits[m] * scale;
    deepShare[m] = windowCredits[m] > 0 ? (deepCredits[m] ?? 0) / windowCredits[m] : 0;
  }

  return { windowCredits, monthlyCredits, deepShare, totalWindowCredits: total };
}
