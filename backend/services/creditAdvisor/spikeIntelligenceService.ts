/**
 * Credit Advisor — Phase 5: Spike Intelligence.
 *
 * Detects a recent consumption spike (recent rate vs baseline rate), its
 * magnitude/duration, the primary drivers (modules) behind it, and the
 * estimated runway impact. Deterministic, READ-ONLY.
 */

import type { ConsumptionRow } from './consumptionMetricsService';
import { moduleForActionKey } from './creditAdvisorTaxonomy';
import { runwayDays } from './creditForecastService';
import type { SpikeDriver, SpikeIntelligence } from './creditAdvisorTypes';

const DAY_MS = 86_400_000;
const RECENT_DAYS = 7;
const BASELINE_DAYS = 23; // days 8..30
const SPIKE_THRESHOLD = 1.25;

export function detectSpike(
  rows: ConsumptionRow[],
  remaining: number,
  now = new Date(),
): SpikeIntelligence {
  const t = now.getTime();
  const recentStart = t - RECENT_DAYS * DAY_MS;
  const baselineStart = t - 30 * DAY_MS;

  let recentCredits = 0;
  const recentByModule: Record<string, number> = {};
  let baselineCredits = 0;
  const activeRecentDays = new Set<string>();

  for (const r of rows) {
    const ts = new Date(r.created_at).getTime();
    if (ts >= recentStart) {
      recentCredits += r.credits;
      const m = moduleForActionKey(r.action);
      recentByModule[m] = (recentByModule[m] ?? 0) + r.credits;
      activeRecentDays.add(r.created_at.slice(0, 10));
    } else if (ts >= baselineStart) {
      baselineCredits += r.credits;
    }
  }

  const recent_daily = recentCredits / RECENT_DAYS;
  const baseline_daily = baselineCredits / BASELINE_DAYS;
  const magnitude = baseline_daily > 0.01 ? recent_daily / baseline_daily : recent_daily > 0 ? Infinity : 1;
  const detected = recent_daily > 0.5 && magnitude > SPIKE_THRESHOLD;

  const primary_drivers: SpikeDriver[] = Object.entries(recentByModule)
    .map(([label, credits]) => ({
      label,
      credits: Math.round(credits),
      percentage: recentCredits > 0 ? Math.round((credits / recentCredits) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.credits - a.credits)
    .slice(0, 3);

  // Impact = runway lost moving from the optimistic (30d-avg) to the recent rate.
  const burn30 = (baselineCredits + recentCredits) / 30;
  const optimistic = runwayDays(remaining, burn30);
  const recentRunway = runwayDays(remaining, recent_daily);
  const estimated_impact_days =
    detected && optimistic !== null && recentRunway !== null
      ? Math.round((optimistic - recentRunway) * 10) / 10
      : null;

  return {
    detected,
    magnitude: Number.isFinite(magnitude) ? Math.round(magnitude * 10) / 10 : magnitude,
    duration_days: activeRecentDays.size,
    baseline_daily: Math.round(baseline_daily * 100) / 100,
    recent_daily: Math.round(recent_daily * 100) / 100,
    primary_drivers,
    estimated_impact_days,
  };
}
